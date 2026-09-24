import { requireUser } from '@/lib/auth';
import { AppError, body, checkOrigin, leagueInput, provider, seal, sessionCookie } from '@/lib/security';
import { json, failure } from '@/lib/http';
import { readState, withState } from '@/lib/store';
import { dashboard, espnAccess, fetchLeague, importSelectedLeagues, prepareLeagueSnapshot, yahooAccess } from '@/lib/dashboard';
import { discoverEspnLeagues } from '@/lib/espn';
import { discoverYahooLeagues } from '@/lib/yahoo';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=120;
type Context = {params:Promise<{path:string[]}>};
export async function GET(request:Request,context:Context) {
  const path=(await context.params).path.join('/');
  try {
    const user=await requireUser();
    if(path==='dashboard') return json(dashboard(user,await readState(user.id)));
    return json({error:'Not found.'},404);
  } catch(error) { return failure(error); }
}
export async function POST(request:Request,context:Context) {
  try {
    checkOrigin(request);
    const user=await requireUser(),path=(await context.params).path.join('/');
    if(path==='espn/extension' || path==='yahoo/extension') {
      const input=await body(request);
      if(path.startsWith('espn')) {
        const credentials={espn_s2:sessionCookie(input.espn_s2,'ESPN'),SWID:sessionCookie(input.SWID,'ESPN')};
        const leagues=await discoverEspnLeagues(credentials);
        return json(await withState(user.id,async state=>{
          state.connections={...state.connections,espn:{secret:seal(credentials,`${user.id}:espn`),status:'connected'}};
          state.espnDiscovery={leagues,expiresAt:new Date(Date.now()+600000).toISOString()};
          return {ok:true,leagues};
        }));
      }
      const credentials={Y:sessionCookie(input.Y,'Yahoo'),T:sessionCookie(input.T,'Yahoo')};
      const leagues=await discoverYahooLeagues(credentials);
      return json(await withState(user.id,async state=>{
        state.connections={...state.connections,yahoo:{secret:seal(credentials,`${user.id}:yahoo`),status:'connected'}};
        return {ok:true,leagues};
      }));
    }
    if(path==='refresh') return json(await withState(user.id,async state=>{
      if(state.nextRefreshAt && state.nextRefreshAt>Date.now()) throw new AppError('Wait before refreshing again.',429,Math.ceil((state.nextRefreshAt-Date.now())/1000));
      state.nextRefreshAt=Date.now()+4000;
      const yahooCredentials=state.leagues?.some(x=>x.provider==='yahoo') ? yahooAccess(user.id,state) : undefined;
      const results=await Promise.allSettled((state.leagues || []).map(async old=>{
        const fresh=await fetchLeague(user.id,state,old.provider,old.id,old.season,yahooCredentials,old);
        const prepared=await prepareLeagueSnapshot(fresh,old);
        state.leagues=state.leagues!.map(x=>x.id===old.id && x.provider===old.provider && x.season===old.season ? prepared : x);
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
        const result=await importSelectedLeagues(user.id,state,'espn',selected.filter((item): item is NonNullable<typeof item>=>Boolean(item)));
        if(!result.failed.length) delete state.espnDiscovery;
        return {...dashboard(user,state),...result};
      }));
    }
    if(path==='yahoo/import') {
      const raw=(await body(request)).leagues;
      if(!Array.isArray(raw) || !raw.length || raw.length>10) throw new AppError('Choose up to ten Yahoo leagues.');
      const selected=raw.map(value=>{
        if(!value || typeof value!=='object' || Array.isArray(value)) throw new AppError('Choose leagues from the Yahoo list.');
        const item=value as Record<string,unknown>;
        const input=leagueInput({provider:'yahoo',leagueId:item.id,season:item.season});
        if(typeof item.name!=='string' || !item.name.trim() || item.name.length>160) throw new AppError('Choose leagues from the Yahoo list.');
        return {...input,name:item.name};
      });
      if(new Set(selected.map(item=>`${item.id}:${item.season}`)).size!==selected.length) throw new AppError('Choose each Yahoo league only once.');
      return json(await withState(user.id,async state=>{
        const result=await importSelectedLeagues(user.id,state,'yahoo',selected);
        return {...dashboard(user,state),...result};
      }));
    }
    if(path==='espn/discover') return json(await withState(user.id,async state=>{
      if(state.espnDiscovery?.leagues.length && Date.parse(state.espnDiscovery.expiresAt)>=Date.now()) return {...dashboard(user,state),availableLeagues:state.espnDiscovery.leagues};
      delete state.espnDiscovery;
      if(state.nextEspnDiscoveryAt && state.nextEspnDiscoveryAt>Date.now()) throw new AppError('Wait before discovering again.',429,Math.ceil((state.nextEspnDiscoveryAt-Date.now())/1000));
      state.nextEspnDiscoveryAt=Date.now()+10000;
      try {
        const leagues=await discoverEspnLeagues(espnAccess(user.id,state));
        state.espnDiscovery={leagues,expiresAt:new Date(Date.now()+600000).toISOString()};
        return {...dashboard(user,state),availableLeagues:leagues};
      } catch(error) {
        if(error instanceof AppError && error.status===401 && state.connections?.espn) {
          state.connections.espn.status='reconnect';
          throw new AppError('ESPN authorization expired. Reconnect that account.',409);
        }
        if(error instanceof AppError && error.status===429) state.nextEspnDiscoveryAt=Date.now()+Math.max(error.retryAfter || 60,10)*1000;
        throw error;
      }
    }));
    if(path==='yahoo/discover') return json(await withState(user.id,async state=>{
      if(state.nextYahooDiscoveryAt && state.nextYahooDiscoveryAt>Date.now()) throw new AppError('Wait before discovering again.',429,Math.ceil((state.nextYahooDiscoveryAt-Date.now())/1000));
      state.nextYahooDiscoveryAt=Date.now()+10000;
      try { return {leagues:await discoverYahooLeagues(yahooAccess(user.id,state))}; }
      catch(error) {
        if(error instanceof AppError && error.status===401 && state.connections?.yahoo) {
          state.connections.yahoo.status='reconnect';
          throw new AppError('Yahoo authorization expired. Reconnect that account.',409);
        }
        if(error instanceof AppError && error.status===429) state.nextYahooDiscoveryAt=Date.now()+Math.max(error.retryAfter || 60,10)*1000;
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
      if(selected==='espn') delete state.espnDiscovery;
      delete state.connections?.[selected];
      state.leagues=state.leagues?.filter(x=>x.provider!==selected);
      return dashboard(user,state);
    }));
  } catch(error) { return failure(error); }
}
