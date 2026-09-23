import 'server-only';
import type { User } from '@supabase/supabase-js';
import { AppError, seal, unseal } from './security';
import type { State } from './store';
import type { Provider } from './types';
import { fetchEspnLeague, type EspnLeagueOption } from './espn';
import { fetchYahooLeague, refreshYahooTokens, type YahooTokens } from './yahoo';

export function dashboard(user:User,state:State) {
  return {user:{email:user.email || ''},connections:Object.entries(state.connections || {}).map(([provider,value])=>({provider,status:value.status})),leagues:state.leagues || [],configured:{espn:!!(process.env.BROWSERBASE_API_KEY && process.env.BROWSERBASE_PROJECT_ID && process.env.CREDENTIAL_ENCRYPTION_KEY),yahoo:!!(process.env.YAHOO_CLIENT_ID && process.env.YAHOO_CLIENT_SECRET && process.env.CREDENTIAL_ENCRYPTION_KEY)}};
}
export async function yahooAccess(owner:string,state:State) {
  const connection = state.connections?.yahoo;
  if(!connection) throw new AppError('Connect Yahoo first.');
  let tokens = unseal<YahooTokens>(connection.secret,`${owner}:yahoo`);
  if(new Date(tokens.expiresAt).getTime() < Date.now()+60000) {
    try { tokens = await refreshYahooTokens(tokens.refreshToken); }
    catch(error) {
      if(error instanceof AppError && error.status === 401) {
        connection.status='reconnect';
        throw new AppError('Yahoo authorization expired. Reconnect that account.',409);
      }
      throw error;
    }
    connection.secret=seal(tokens,`${owner}:yahoo`);
  }
  return tokens.accessToken;
}
export function espnAccess(owner:string,state:State) {
  const connection = state.connections?.espn;
  if(!connection) throw new AppError('Connect ESPN first.');
  return unseal<{espn_s2:string;SWID:string}>(connection.secret,`${owner}:espn`);
}
export async function importEspnLeagues(owner:string,state:State,leagues:EspnLeagueOption[]) {
  let imported=0;
  const failed:{id:string;name:string;season:number;error:string}[]=[];
  for(const league of leagues) {
    const existing=state.leagues?.some(x=>x.provider==='espn' && x.id===league.id && x.season===league.season);
    if(!existing && (state.leagues?.length || 0)>=10) {
      failed.push({...league,error:'This account already has ten leagues.'});
      continue;
    }
    try {
      const snapshot=await fetchLeague(owner,state,'espn',league.id,league.season);
      state.leagues=[...(state.leagues || []).filter(x=>!(x.provider==='espn' && x.id===snapshot.id && x.season===snapshot.season)),snapshot];
      imported+=1;
    } catch(error) {
      if(error instanceof AppError && (error.status===409 || error.status===429)) throw error;
      failed.push({...league,error:error instanceof AppError ? error.message : 'Could not load this ESPN league.'});
    }
  }
  return {imported,failed};
}
export async function fetchLeague(owner:string,state:State,provider:Provider,id:string,season:number,yahooToken?:Promise<string>) {
  const connection = state.connections?.[provider];
  if(!connection) throw new AppError(`Connect ${provider === 'espn' ? 'ESPN' : 'Yahoo'} first.`);
  try {
    const snapshot = provider === 'espn'
      ? await fetchEspnLeague(espnAccess(owner,state),id,season)
      : await fetchYahooLeague(await (yahooToken || yahooAccess(owner,state)),id,season);
    connection.status='connected';
    return snapshot;
  } catch(error) {
    if(error instanceof AppError && error.status === 401) {
      connection.status='reconnect';
      throw new AppError(`${provider === 'espn' ? 'ESPN' : 'Yahoo'} authorization expired. Reconnect that account.`,409);
    }
    if(error instanceof AppError && error.status === 429) state.nextRefreshAt=Date.now()+Math.max(error.retryAfter || 60,4)*1000;
    throw error;
  }
}
