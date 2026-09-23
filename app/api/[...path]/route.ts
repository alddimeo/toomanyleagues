import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { requireUser } from '@/lib/auth';
import { AppError, appUrl, body, checkOrigin, leagueInput, provider, verifyOAuthState, seal, unseal } from '@/lib/security';
import { json, failure } from '@/lib/http';
import { readState, withState } from '@/lib/store';
import { dashboard, espnAccess, fetchLeague, importEspnLeagues, yahooAccess } from '@/lib/dashboard';
import { startEspnBrowser, finishEspnBrowser, stopEspnBrowser } from '@/lib/browserbase';
import { discoverEspnLeagues } from '@/lib/espn';
import { yahooAuthorizeUrl, exchangeYahooCode, discoverYahooLeagues } from '@/lib/yahoo';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=120;
type Context = {params:Promise<{path:string[]}>};
export async function GET(request:Request,context:Context) {
  const path=(await context.params).path.join('/');
  try {
    const user=await requireUser();
    if(path==='dashboard') return json(dashboard(user,await readState(user.id)));
    if(path==='yahoo/connect') {
      const site=request.headers.get('sec-fetch-site');
      if(site && !['same-origin','none'].includes(site)) throw new AppError('Request origin rejected.',403);
      const nonce=randomBytes(32).toString('hex');
      seal({},`${user.id}:yahoo`);
      const url=yahooAuthorizeUrl(nonce);
      await withState(user.id,async state=>{state.yahooState={nonce,expiresAt:new Date(Date.now()+600000).toISOString()};});
      (await cookies()).set('yahoo_oauth_state',nonce,{httpOnly:true,secure:appUrl().startsWith('https:'),sameSite:'lax',path:'/api/yahoo',maxAge:600});
      return Response.redirect(url);
    }
    if(path==='yahoo/callback') {
      const url=new URL(request.url), received=url.searchParams.get('state') || '';
      const jar=await cookies(), browserNonce=jar.get('yahoo_oauth_state')?.value || '';
      jar.delete({name:'yahoo_oauth_state',path:'/api/yahoo'});
      await withState(user.id,async state=>{
        const pending=state.yahooState;
        delete state.yahooState;
        verifyOAuthState(received,browserNonce,pending);
        const code=url.searchParams.get('code');
        if(!code || url.searchParams.has('error')) throw new AppError('Yahoo authorization was cancelled.');
        const tokens=await exchangeYahooCode(code);
        state.connections={...state.connections,yahoo:{secret:seal(tokens,`${user.id}:yahoo`),status:'connected'}};
        // Connection is retained if discovery fails; league-key import remains available.
        try {
          const leagues=await discoverYahooLeagues(tokens.accessToken);
          // ponytail: import one league during OAuth; the discovery picker imports the rest without a long callback.
          for(const league of leagues.slice(0,1)) {
            const snapshot=await fetchLeague(user.id,state,'yahoo',league.id,league.season);
            state.leagues=[...(state.leagues || []).filter(x=>!(x.provider==='yahoo' && x.id===snapshot.id && x.season===snapshot.season)),snapshot];
          }
        } catch { /* Keep the connection and last successful snapshot; manual import can be retried. */ }
      });
      return Response.redirect(`${appUrl()}/dashboard`);
    }
    return json({error:'Not found.'},404);
  } catch(error) {
    if(path==='yahoo/callback' || path==='yahoo/connect') {
      const yahooError = path==='yahoo/callback' ? new URL(request.url).searchParams.get('error') : null;
      return Response.redirect(`${appUrl()}/dashboard?error=${yahooError === 'invalid_scope' ? 'yahoo_scope' : 'yahoo_connection'}`);
    }
    return failure(error);
  }
}
export async function POST(request:Request,context:Context) {
  try {
    checkOrigin(request);
    const user=await requireUser(),path=(await context.params).path.join('/');
    if(path==='espn/start') {
      let createdSession:string | undefined;
      try { return json(await withState(user.id,async state=>{
      if(state.browser) { await stopEspnBrowser(unseal<{sessionId:string}>(state.browser.secret,`${user.id}:browser`).sessionId); delete state.browser; }
      // Validate encryption before starting a billable browser.
      seal({},`${user.id}:browser`);
      const browser=await startEspnBrowser();
      createdSession=browser.sessionId;
      state.browser={secret:seal({sessionId:browser.sessionId},`${user.id}:browser`),expiresAt:browser.expiresAt};
      return {liveUrl:browser.liveUrl,expiresAt:browser.expiresAt};
      })); } catch(error) {
        if(createdSession) { try { await stopEspnBrowser(createdSession); } catch { /* Provider timeout remains the final cleanup if release is unavailable. */ } }
        throw error;
      }
    }
    if(path==='espn/complete' || path==='espn/cancel') return json(await withState(user.id,async state=>{
      const pending=state.browser;
      if(!pending) throw new AppError('Open an ESPN connection window first.');
      const {sessionId}=unseal<{sessionId:string}>(pending.secret,`${user.id}:browser`);
      if(path==='espn/cancel' || Date.parse(pending.expiresAt)<Date.now()) {
        await stopEspnBrowser(sessionId); delete state.browser;
        if(path==='espn/complete') throw new AppError('The connection window expired. Open a new one.');
        return {ok:true};
      }
      try {
        const { leagues: pageLeagues, ...credentials }=await finishEspnBrowser(sessionId);
        state.connections={...state.connections,espn:{secret:seal(credentials,`${user.id}:espn`),status:'connected'}};
        let leagues=pageLeagues;
        try {
          const found=await discoverEspnLeagues(credentials);
          if(found.length) leagues=found;
        } catch { /* Keep the connection if ESPN's account list is unavailable. */ }
        state.espnDiscovery={leagues,expiresAt:new Date(Date.now()+600000).toISOString()};
        return {ok:true,discovered:leagues.length,leagues};
      } finally { delete state.browser; }
    }));
    if(path==='leagues') {
      const input=leagueInput(await body(request));
      return json(await withState(user.id,async state=>{
        if(state.nextRefreshAt && state.nextRefreshAt>Date.now()) throw new AppError('Wait before refreshing again.',429,Math.ceil((state.nextRefreshAt-Date.now())/1000));
        if((state.leagues?.length || 0)>=10 && !state.leagues?.some(x=>x.id===input.id && x.provider===input.provider && x.season===input.season)) throw new AppError('This prototype supports ten imported leagues per account.');
        state.nextRefreshAt=Date.now()+4000;
        const snapshot=await fetchLeague(user.id,state,input.provider,input.id,input.season);
        state.leagues=[...(state.leagues || []).filter(x=>!(x.id===snapshot.id && x.provider===snapshot.provider && x.season===snapshot.season)),snapshot];
        return dashboard(user,state);
      }));
    }
    if(path==='refresh') return json(await withState(user.id,async state=>{
      if(state.nextRefreshAt && state.nextRefreshAt>Date.now()) throw new AppError('Wait before refreshing again.',429,Math.ceil((state.nextRefreshAt-Date.now())/1000));
      state.nextRefreshAt=Date.now()+4000;
      const token=state.leagues?.some(x=>x.provider==='yahoo') ? yahooAccess(user.id,state) : undefined;
      const results=await Promise.allSettled((state.leagues || []).map(async old=>{
        const fresh=await fetchLeague(user.id,state,old.provider,old.id,old.season,token);
        state.leagues=state.leagues!.map(x=>x.id===old.id && x.provider===old.provider && x.season===old.season ? fresh : x);
      }));
      const failed=results.find(x=>x.status==='rejected');
      if(failed?.status==='rejected') throw failed.reason;
      return dashboard(user,state);
    }));
    if(path==='espn/import') {
      const input=await body(request), raw=input.leagues;
      if(!Array.isArray(raw) || raw.length>10) throw new AppError('Choose up to ten ESPN leagues.');
      const selections=raw.map(value=>{
        if(!value || typeof value!=='object' || Array.isArray(value)) throw new AppError('Choose leagues from the ESPN list.');
        const item=value as Record<string,unknown>, id=String(item.id || ''), season=Number(item.season);
        if(!/^\d{1,12}$/.test(id) || !Number.isInteger(season) || season<2018 || season>new Date().getFullYear()+1) throw new AppError('Choose leagues from the ESPN list.');
        return {id,season};
      });
      if(new Set(selections.map(item=>`${item.id}:${item.season}`)).size!==selections.length) throw new AppError('Choose each ESPN league only once.');
      return json(await withState(user.id,async state=>{
        const pending=state.espnDiscovery;
        if(!pending || Date.parse(pending.expiresAt)<Date.now()) { delete state.espnDiscovery; throw new AppError('The ESPN league list expired. Connect ESPN again.',409); }
        const allowed=new Map(pending.leagues.map(league=>[`${league.id}:${league.season}`,league]));
        const selected=selections.map(item=>allowed.get(`${item.id}:${item.season}`));
        if(selected.some(item=>!item)) throw new AppError('Choose leagues from the ESPN list.');
        const result=await importEspnLeagues(user.id,state,selected.filter((item): item is NonNullable<typeof item>=>Boolean(item)));
        if(!result.failed.length) delete state.espnDiscovery;
        return {...dashboard(user,state),...result};
      }));
    }
    if(path==='espn/discover') return json(await withState(user.id,async state=>{
      if(state.espnDiscovery?.leagues.length && Date.parse(state.espnDiscovery.expiresAt)>=Date.now()) return {...dashboard(user,state),availableLeagues:state.espnDiscovery.leagues};
      delete state.espnDiscovery;
      if(state.nextDiscoveryAt && state.nextDiscoveryAt>Date.now()) throw new AppError('Wait before discovering again.',429,Math.ceil((state.nextDiscoveryAt-Date.now())/1000));
      state.nextDiscoveryAt=Date.now()+10000;
      try {
        const leagues=await discoverEspnLeagues(espnAccess(user.id,state));
        state.espnDiscovery={leagues,expiresAt:new Date(Date.now()+600000).toISOString()};
        return {...dashboard(user,state),availableLeagues:leagues};
      } catch(error) {
        if(error instanceof AppError && error.status===401 && state.connections?.espn) {
          state.connections.espn.status='reconnect';
          throw new AppError('ESPN authorization expired. Reconnect that account.',409);
        }
        if(error instanceof AppError && error.status===429) state.nextDiscoveryAt=Date.now()+Math.max(error.retryAfter || 60,10)*1000;
        throw error;
      }
    }));
    if(path==='yahoo/discover') return json(await withState(user.id,async state=>{
      if(state.nextDiscoveryAt && state.nextDiscoveryAt>Date.now()) throw new AppError('Wait before discovering again.',429,Math.ceil((state.nextDiscoveryAt-Date.now())/1000));
      state.nextDiscoveryAt=Date.now()+10000;
      try { return {leagues:await discoverYahooLeagues(await yahooAccess(user.id,state))}; }
      catch(error) {
        if(error instanceof AppError && error.status===401 && state.connections?.yahoo) {
          state.connections.yahoo.status='reconnect';
          throw new AppError('Yahoo authorization expired. Reconnect that account.',409);
        }
        if(error instanceof AppError && error.status===429) state.nextDiscoveryAt=Date.now()+Math.max(error.retryAfter || 60,10)*1000;
        throw error;
      }
    }));
    return json({error:'Not found.'},404);
  } catch(error) { return failure(error); }
}
export async function DELETE(request:Request,context:Context) {
  try {
    checkOrigin(request);
    const user=await requireUser(),path=(await context.params).path.join('/');
    if(path!=='connections') return json({error:'Not found.'},404);
    const selected=provider((await body(request)).provider);
    return json(await withState(user.id,async state=>{
      if(selected==='espn' && state.browser) { await stopEspnBrowser(unseal<{sessionId:string}>(state.browser.secret,`${user.id}:browser`).sessionId); delete state.browser; }
      if(selected==='yahoo') delete state.yahooState;
      if(selected==='espn') delete state.espnDiscovery;
      delete state.connections?.[selected];
      state.leagues=state.leagues?.filter(x=>x.provider!==selected);
      return dashboard(user,state);
    }));
  } catch(error) { return failure(error); }
}
