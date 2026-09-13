import 'server-only';
import type { User } from '@supabase/supabase-js';
import { AppError, seal, unseal } from './security';
import type { State } from './store';
import type { Provider } from './types';
import { fetchEspnLeague } from './espn';
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
export async function fetchLeague(owner:string,state:State,provider:Provider,id:string,season:number,yahooToken?:Promise<string>) {
  const connection = state.connections?.[provider];
  if(!connection) throw new AppError(`Connect ${provider === 'espn' ? 'ESPN' : 'Yahoo'} first.`);
  try {
    const snapshot = provider === 'espn'
      ? await fetchEspnLeague(unseal(connection.secret,`${owner}:espn`),id,season)
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
