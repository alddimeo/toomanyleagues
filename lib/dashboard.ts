import 'server-only';
import type { User } from '@supabase/supabase-js';
import { AppError, unseal } from './security';
import type { State } from './store';
import type { Provider } from './types';
import { espnTeamLogoProxyPath, fetchEspnLeague, type EspnLeagueOption } from './espn';
import { fetchYahooLeague, type YahooCredentials } from './yahoo';
import { fetchNflScoreboard } from './nfl';
import { carryPregame, holdUpcomingYahooProjections } from './projections';
import type { LeagueSnapshot } from './types';

export async function prepareLeagueSnapshot(fresh: LeagueSnapshot, old?: LeagueSnapshot): Promise<LeagueSnapshot> {
  if (old?.week === fresh.week && old.pregameClosed) return carryPregame(fresh, old);
  let beforeKickoff = false;
  try {
    const games = await fetchNflScoreboard(fresh.season, fresh.week);
    beforeKickoff = games.length > 0 && games.every((game) => game.state === 'scheduled' &&
      game.date && Date.parse(game.date) > Date.now());
    return holdUpcomingYahooProjections(carryPregame(fresh, old, beforeKickoff), games);
  } catch { return carryPregame(fresh, old, !!old?.pregameCapturedAt && old.week === fresh.week); }
}

export function dashboard(user:User,state:State) {
  const leagues = (state.leagues || []).map(league => league.provider === 'espn' ? {
    ...league,
    teams: league.teams.map(team => {
      const logo = espnTeamLogoProxyPath(team.logo);
      return logo ? { ...team, logo } : team;
    }),
  } : league);
  return {user:{email:user.email || ''},connections:Object.entries(state.connections || {}).map(([provider,value])=>({provider,status:value.status})),leagues,configured:{espn:!!process.env.CREDENTIAL_ENCRYPTION_KEY,yahoo:!!process.env.CREDENTIAL_ENCRYPTION_KEY}};
}
export function yahooAccess(owner:string,state:State) {
  const connection = state.connections?.yahoo;
  if(!connection) throw new AppError('Connect Yahoo first.');
  return unseal<YahooCredentials>(connection.secret,`${owner}:yahoo`);
}
export function espnAccess(owner:string,state:State) {
  const connection = state.connections?.espn;
  if(!connection) throw new AppError('Connect ESPN first.');
  return unseal<{espn_s2:string;SWID:string}>(connection.secret,`${owner}:espn`);
}
export async function importSelectedLeagues(owner:string,state:State,provider:Provider,leagues:EspnLeagueOption[]) {
  let imported=0;
  const failed:{id:string;name:string;season:number;error:string}[]=[];
  for(const league of leagues) {
    const existing=state.leagues?.some(x=>x.provider===provider && x.id===league.id && x.season===league.season);
    if(!existing && (state.leagues?.length || 0)>=10) {
      failed.push({...league,error:'This account already has ten leagues.'});
      continue;
    }
    try {
      const snapshot=await fetchLeague(owner,state,provider,league.id,league.season);
      const previous=state.leagues?.find(x=>x.provider===provider && x.id===snapshot.id && x.season===snapshot.season);
      state.leagues=[...(state.leagues || []).filter(x=>!(x.provider===provider && x.id===snapshot.id && x.season===snapshot.season)),await prepareLeagueSnapshot(snapshot,previous)];
      imported+=1;
    } catch(error) {
      if(error instanceof AppError && (error.status===409 || error.status===429)) throw error;
      failed.push({...league,error:error instanceof AppError ? error.message : `Could not load this ${provider === 'espn' ? 'ESPN' : 'Yahoo'} league.`});
    }
  }
  return {imported,failed};
}
export async function fetchLeague(owner:string,state:State,provider:Provider,id:string,season:number,yahooCredentials?:YahooCredentials,previous?:LeagueSnapshot) {
  const connection = state.connections?.[provider];
  if(!connection) throw new AppError(`Connect ${provider === 'espn' ? 'ESPN' : 'Yahoo'} first.`);
  try {
    const snapshot = provider === 'espn'
      ? await fetchEspnLeague(espnAccess(owner,state),id,season)
      : await fetchYahooLeague(yahooCredentials || yahooAccess(owner,state),id,season,previous);
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
