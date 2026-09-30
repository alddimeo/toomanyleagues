import { isBench } from './projections';
import type { LeagueSnapshot, Player, Team } from './types';

export type MatchupFilter = 'all' | 'close' | 'behind' | 'favored';
export type MatchupSort = 'attention' | 'closest' | 'league';
export type ExposureMode = 'starts' | 'over' | 'under' | 'combined';
export type PersonalMatchup = {
  key: string;
  league: LeagueSnapshot;
  userTeam: Team;
  opponent?: Team;
  currentMargin?: number;
  projectedMargin?: number;
};
export type PlayerExposure = {
  key: string;
  player: Player;
  name: string;
  position: string;
  nflTeam?: string;
  leagues: number;
  started: number;
  benched: number;
  against: number;
};

export function exposurePerformance(item: PlayerExposure) {
  const baseline = item.player.pregameProjection ?? item.player.projection;
  return typeof item.player.points === 'number' && Number.isFinite(item.player.points) && typeof baseline === 'number' && Number.isFinite(baseline)
    ? item.player.points - baseline
    : undefined;
}

export function featuredPlayerExposure(exposure: PlayerExposure[], mode: ExposureMode) {
  if (mode === 'starts') return [...exposure].sort((left, right) => right.started - left.started || right.leagues - left.leagues || right.against - left.against || left.name.localeCompare(right.name)).slice(0, 8);
  const ranked = exposure.flatMap((item) => {
    const performance = exposurePerformance(item);
    return performance === undefined || performance === 0 ? [] : [{ item, performance }];
  });
  const over = ranked.filter(({ performance }) => performance > 0).sort((left, right) => right.performance - left.performance || left.item.name.localeCompare(right.item.name)).map(({ item }) => item);
  const under = ranked.filter(({ performance }) => performance < 0).sort((left, right) => left.performance - right.performance || left.item.name.localeCompare(right.item.name)).map(({ item }) => item);
  return mode === 'over' ? over.slice(0, 8) : mode === 'under' ? under.slice(0, 8) : [...over.slice(0, 4), ...under.slice(0, 4)];
}

function finiteMargin(left: number | null | undefined, right: number | null | undefined) {
  return typeof left === 'number' && Number.isFinite(left) && typeof right === 'number' && Number.isFinite(right) ? left - right : undefined;
}

export function personalMatchups(leagues: LeagueSnapshot[]): PersonalMatchup[] {
  return leagues.flatMap((league) => {
    const userTeam = league.teams.find((team) => team.isUserTeam);
    if (!userTeam) return [];
    const matchup = league.matchups.find((item) => item.home === userTeam.id || item.away === userTeam.id);
    if (!matchup) return [];
    const opponentId = matchup.home === userTeam.id ? matchup.away : matchup.home;
    const opponent = opponentId ? league.teams.find((team) => team.id === opponentId) : undefined;
    return [{
      key: `${league.provider}:${league.id}:${league.season}`,
      league,
      userTeam,
      opponent,
      currentMargin: opponent ? finiteMargin(userTeam.points, opponent.points) : undefined,
      projectedMargin: opponent ? finiteMargin(userTeam.projection, opponent.projection) : undefined,
    }];
  });
}

function signalMargin(matchup: PersonalMatchup) {
  return matchup.projectedMargin ?? matchup.currentMargin;
}

function attentionRank(matchup: PersonalMatchup) {
  if (!matchup.opponent) return 4;
  const signal = signalMargin(matchup);
  if (matchup.currentMargin !== undefined && matchup.projectedMargin !== undefined && Math.sign(matchup.currentMargin) !== Math.sign(matchup.projectedMargin)) return 0;
  if (signal !== undefined && Math.abs(signal) <= 10) return 1;
  if (signal !== undefined && signal < 0) return 2;
  return 3;
}

export function filterPersonalMatchups(matchups: PersonalMatchup[], filter: MatchupFilter) {
  if (filter === 'all') return matchups;
  return matchups.filter((matchup) => {
    const margin = signalMargin(matchup);
    if (margin === undefined || !matchup.opponent) return false;
    if (filter === 'close') return Math.abs(margin) <= 10;
    return filter === 'behind' ? margin < 0 : margin >= 0;
  });
}

export function sortPersonalMatchups(matchups: PersonalMatchup[], sort: MatchupSort) {
  return [...matchups].sort((left, right) => {
    if (sort === 'league') return left.league.name.localeCompare(right.league.name);
    const distance = Math.abs(signalMargin(left) ?? Number.POSITIVE_INFINITY) - Math.abs(signalMargin(right) ?? Number.POSITIVE_INFINITY);
    if (sort === 'closest') return distance || left.league.name.localeCompare(right.league.name);
    return attentionRank(left) - attentionRank(right) || distance || left.league.name.localeCompare(right.league.name);
  });
}

export function matchupSignal(matchup: PersonalMatchup) {
  if (!matchup.opponent) return { label: 'Bye week', detail: 'No opponent this week', tone: 'quiet' as const };
  const current = matchup.currentMargin;
  const projected = matchup.projectedMargin;
  if (current !== undefined && projected !== undefined && Math.sign(current) !== Math.sign(projected)) {
    return { label: 'Lead may flip', detail: `Now ${current >= 0 ? 'up' : 'down'} ${Math.abs(current).toFixed(1)} · projected ${projected >= 0 ? 'up' : 'down'} ${Math.abs(projected).toFixed(1)}`, tone: 'urgent' as const };
  }
  const margin = projected ?? current;
  if (margin === undefined) return { label: 'Waiting for scores', detail: 'No matchup margin yet', tone: 'quiet' as const };
  const basis = projected === undefined ? 'Current margin' : 'Projected margin';
  if (Math.abs(margin) <= 10) return { label: 'Close matchup', detail: `${basis}: ${margin >= 0 ? '+' : '−'}${Math.abs(margin).toFixed(1)}`, tone: 'close' as const };
  return { label: margin < 0 ? 'Chasing' : 'In control', detail: `${basis}: ${margin >= 0 ? '+' : '−'}${Math.abs(margin).toFixed(1)}`, tone: margin < 0 ? 'urgent' as const : 'good' as const };
}

function playerKey(player: Player) {
  // ponytail: name matching is enough for two providers; use a licensed cross-provider player ID map when collisions appear.
  return player.name.normalize('NFKD').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

export function playerExposure(leagues: LeagueSnapshot[]): PlayerExposure[] {
  const exposure = new Map<string, PlayerExposure & { leagueKeys: Set<string> }>();
  const add = (player: Player, leagueKey: string, role: 'started' | 'benched' | 'against') => {
    const key = playerKey(player);
    if (!key) return;
    const item = exposure.get(key) ?? { key, player, name: player.name, position: player.position, nflTeam: player.nflTeam, leagues: 0, started: 0, benched: 0, against: 0, leagueKeys: new Set<string>() };
    item[role]++;
    item.leagueKeys.add(leagueKey);
    exposure.set(key, item);
  };
  for (const matchup of personalMatchups(leagues)) {
    for (const player of matchup.userTeam.players) add(player, matchup.key, isBench(player) ? 'benched' : 'started');
    for (const player of matchup.opponent?.players ?? []) if (!isBench(player)) add(player, matchup.key, 'against');
  }
  return [...exposure.values()].map(({ leagueKeys, ...item }) => ({ ...item, leagues: leagueKeys.size }))
    .sort((left, right) => (right.started + right.against) - (left.started + left.against) || right.leagues - left.leagues || left.name.localeCompare(right.name));
}
