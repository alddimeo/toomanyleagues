import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { requireUser } from '@/lib/auth';
import { AppError, appUrl, body, checkOrigin, leagueInput, provider, verifyOAuthState, seal, unseal } from '@/lib/security';
import { json, failure } from '@/lib/http';
import { readState, withState } from '@/lib/store';
import { dashboard, fetchLeague, yahooAccess } from '@/lib/dashboard';
import { startEspnBrowser, finishEspnBrowser, stopEspnBrowser } from '@/lib/browserbase';
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
    if(path==='yahoo/callback' || path==='yahoo/connect') return Response.redirect(`${appUrl()}/dashboard?error=yahoo_connection`);
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
      if(state.nextBrowserAt && state.nextBrowserAt>Date.now()) throw new AppError('Wait before opening another login window.',429,Math.ceil((state.nextBrowserAt-Date.now())/1000));
      if(state.browser) { await stopEspnBrowser(unseal<{sessionId:string}>(state.browser.secret,`${user.id}:browser`).sessionId); delete state.browser; }
      // Validate encryption before starting a billable browser.
      seal({},`${user.id}:browser`);
      state.nextBrowserAt=Date.now()+60000;
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
        const credentials=await finishEspnBrowser(sessionId);
        state.connections={...state.connections,espn:{secret:seal(credentials,`${user.id}:espn`),status:'connected'}};
      } finally { delete state.browser; }
      return {ok:true};
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
      delete state.connections?.[selected];
      state.leagues=state.leagues?.filter(x=>x.provider!==selected);
      return dashboard(user,state);
    }));
  } catch(error) { return failure(error); }
}
