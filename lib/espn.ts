import { AppError } from './security';
import type { LeagueSnapshot, Player, Team } from './types';

const ESPN_API = 'https://lm-api-reads.fantasy.espn.com';
const ESPN_METADATA_VIEWS = ['mSettings', 'mTeam', 'mRoster', 'mStatus'];
const ESPN_SCOREBOARD_VIEWS = ['mMatchupScore', 'mScoreboard'];
const REQUEST_TIMEOUT_MS = 15_000;

type JsonObject = Record<string, unknown>;

const POSITION_NAMES: Record<number, string> = {
  1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'D/ST',
};

const SLOT_NAMES: Record<number, string> = {
  0: 'QB', 1: 'TQB', 2: 'RB', 3: 'RB/WR', 4: 'WR', 5: 'WR/TE', 6: 'TE',
  7: 'OP', 8: 'DT', 9: 'DE', 10: 'LB', 11: 'DL', 12: 'CB', 13: 'S', 14: 'DB',
  15: 'DP', 16: 'D/ST', 17: 'K', 18: 'P', 19: 'HC', 20: 'BE', 21: 'IR',
  23: 'FLEX', 24: 'ER', 25: 'Rookie',
};

const STAT_NAMES: Record<number, string> = {
  0: 'Passing attempts', 1: 'Passing completions', 2: 'Passing incompletions', 3: 'Passing yards',
  4: 'Passing touchdowns', 20: 'Passing interceptions', 23: 'Rushing attempts', 24: 'Rushing yards',
  25: 'Rushing touchdowns', 41: 'Receiving receptions', 42: 'Receiving yards', 43: 'Receiving touchdowns',
  58: 'Receiving targets', 59: 'Receiving yards after catch', 68: 'Fumbles', 72: 'Lost fumbles',
  83: 'Made field goals', 86: 'Made extra points', 94: 'Defensive touchdowns', 95: 'Defensive interceptions',
  96: 'Defensive fumbles', 97: 'Defensive blocked kicks', 98: 'Defensive safeties', 99: 'Defensive sacks',
};

function object(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null;
}

function array(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter((item): item is JsonObject => !!object(item)) : [];
}

function number(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function integer(value: unknown): number | null {
  const result = number(value);
  return result !== null && Number.isInteger(result) ? result : null;
}

function text(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function id(value: unknown): string | null {
  const result = text(value);
  return result && result.length <= 64 ? result : null;
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const result = number(value);
    if (result !== null) return result;
  }
  return null;
}

function firstObject(...values: unknown[]): JsonObject | null {
  for (const value of values) {
    const result = object(value);
    if (result) return result;
  }
  return null;
}

function currentWeek(data: JsonObject): number {
  const status = object(data.status);
  const settings = object(data.settings);
  const schedule = object(settings?.scheduleSettings);
  for (const value of [
    status?.currentMatchupPeriod,
    data.currentMatchupPeriod,
    schedule?.currentMatchupPeriod,
  ]) {
    const result = integer(value);
    if (result !== null && result > 0) return result;
  }
  return 0;
}

function scoringPeriod(data: JsonObject): number {
  const status = object(data.status);
  for (const value of [
    data.scoringPeriodId,
    status?.currentScoringPeriod,
    status?.latestScoringPeriod,
    data.currentScoringPeriod,
  ]) {
    const result = integer(value) ?? integer(object(value)?.id);
    if (result !== null && result > 0) return result;
  }
  return 0;
}

function teamName(team: JsonObject): string {
  const direct = text(team.name);
  if (direct) return direct;
  const composed = [text(team.location), text(team.nickname)].filter((value): value is string => !!value).join(' ');
  return composed || text(team.abbrev) || '';
}

function playerObject(entry: JsonObject): JsonObject {
  const pool = object(entry.playerPoolEntry);
  return firstObject(pool?.player, entry.player) || {};
}

function statIsActual(stat: JsonObject): boolean {
  const source = integer(stat.statSourceId);
  const type = integer(stat.statTypeId);
  return (source === null || source === 0) && (type === null || type === 0);
}

function statEntry(value: unknown, season: number, scoring: number): JsonObject | null {
  const entries = array(value);
  const actual = entries.filter(statIsActual);
  if (!scoring) return null;
  return actual.find((entry) => integer(entry.seasonId) === season && integer(entry.scoringPeriodId) === scoring) || null;
}

function statSources(entry: JsonObject, season: number, scoring: number): JsonObject[] {
  const pool = object(entry.playerPoolEntry);
  const player = playerObject(entry);
  const sources = [pool?.stats, player.stats, entry.stats];
  const result: JsonObject[] = [];
  for (const source of sources) {
    const selected = statEntry(source, season, scoring);
    if (selected && !result.includes(selected)) result.push(selected);
  }
  return result;
}

function copyStats(target: Record<string, string | number>, value: unknown): void {
  const source = object(value);
  if (!source) return;
  for (const [key, item] of Object.entries(source)) {
    const label = /^\d+$/.test(key) ? STAT_NAMES[Number(key)] || `ESPN stat ${key}` : key;
    if (typeof item === 'string' || (typeof item === 'number' && Number.isFinite(item))) target[label] = item;
  }
}

function playerStats(entry: JsonObject, season: number, scoring: number, scoped: boolean): Record<string, string | number> {
  const result: Record<string, string | number> = {};
  if (!scoped) return result;
  const pool = object(entry.playerPoolEntry);
  const player = playerObject(entry);
  for (const stat of statSources(entry, season, scoring)) {
    copyStats(result, stat.stats);
  }
  if (!Object.keys(result).length) {
    copyStats(result, pool?.stats);
    copyStats(result, player.stats);
    copyStats(result, entry.stats);
  }
  return result;
}

function playerPoints(entry: JsonObject, season: number, scoring: number, scoped: boolean): number | null {
  if (!scoped) return null;
  const pool = object(entry.playerPoolEntry);
  const player = playerObject(entry);
  const direct = firstNumber(pool?.appliedStatTotal, entry.appliedStatTotal, player.appliedStatTotal);
  if (direct !== null) return direct;
  for (const stat of statSources(entry, season, scoring)) {
    const applied = firstNumber(stat.appliedStatTotal, stat.appliedTotal);
    if (applied !== null) return applied;
  }
  return null;
}

function player(entry: JsonObject, season: number, scoring: number, scoped: boolean): Player | null {
  const playerData = playerObject(entry);
  const playerId = id(entry.playerId) || id(playerData.id) || id(object(entry.playerPoolEntry)?.id);
  if (!playerId) return null;
  const positionId = integer(playerData.defaultPositionId);
  const slotId = integer(entry.lineupSlotId);
  const fullName = text(playerData.fullName) || [text(playerData.firstName), text(playerData.lastName)]
    .filter((value): value is string => !!value).join(' ');
  return {
    id: playerId,
    name: fullName,
    position: positionId === null ? '' : POSITION_NAMES[positionId] || String(positionId),
    slot: slotId === null ? '' : SLOT_NAMES[slotId] || String(slotId),
    points: playerPoints(entry, season, scoring, scoped),
    stats: playerStats(entry, season, scoring, scoped),
  };
}

function rosterEntries(team: JsonObject): JsonObject[] {
  const roster = object(team.roster);
  return array(roster?.entries || team.roster);
}

function sideRoster(side: JsonObject | undefined): JsonObject[] {
  if (!side) return [];
  const roster = object(side.rosterForCurrentScoringPeriod);
  return array(roster?.entries);
}

function entryPlayerId(entry: JsonObject): string | null {
  const playerData = playerObject(entry);
  return id(entry.playerId) || id(playerData.id) || id(object(entry.playerPoolEntry)?.id);
}

function mergeEntry(base: JsonObject, current: JsonObject): JsonObject {
  const basePool = object(base.playerPoolEntry);
  const currentPool = object(current.playerPoolEntry);
  const basePlayer = playerObject(base);
  const currentPlayer = playerObject(current);
  const mergedPlayer = { ...basePlayer, ...currentPlayer };
  const mergedPool: JsonObject = { ...basePool, ...currentPool, player: mergedPlayer };
  if (!currentPool || !Object.prototype.hasOwnProperty.call(currentPool, 'appliedStatTotal')) delete mergedPool.appliedStatTotal;
  if (!currentPool || !Object.prototype.hasOwnProperty.call(currentPool, 'stats')) delete mergedPool.stats;
  if (!currentPlayer || !Object.prototype.hasOwnProperty.call(currentPlayer, 'appliedStatTotal')) delete mergedPlayer.appliedStatTotal;
  if (!currentPlayer || !Object.prototype.hasOwnProperty.call(currentPlayer, 'stats')) delete mergedPlayer.stats;
  const merged: JsonObject = { ...base, ...current, playerPoolEntry: mergedPool };
  if (!Object.prototype.hasOwnProperty.call(current, 'appliedStatTotal')) delete merged.appliedStatTotal;
  if (!Object.prototype.hasOwnProperty.call(current, 'stats')) delete merged.stats;
  return merged;
}

function currentSides(data: JsonObject, week: number): Map<string, JsonObject> {
  const result = new Map<string, JsonObject>();
  for (const matchup of array(data.schedule)) {
    if (integer(matchup.matchupPeriodId) !== week) continue;
    for (const sideName of ['home', 'away']) {
      const side = object(matchup[sideName]);
      const teamId = id(side?.teamId);
      if (side && teamId && !result.has(teamId)) result.set(teamId, side);
    }
  }
  return result;
}

function teamPoints(side: JsonObject | undefined): number | null {
  const sideRosterData = firstObject(side?.rosterForMatchupPeriod, side?.rosterForCurrentScoringPeriod);
  return firstNumber(
    side?.totalPoints,
    sideRosterData?.appliedStatTotal,
    side?.appliedStatTotal,
  );
}

function teamSnapshot(team: JsonObject, side: JsonObject | undefined, season: number, scoring: number): Team | null {
  const teamId = id(team.id) || id(side?.teamId);
  if (!teamId) return null;
  const baseEntries = rosterEntries(team);
  const liveEntries = sideRoster(side);
  const liveById = new Map<string, JsonObject>();
  for (const entry of liveEntries) {
    const playerId = entryPlayerId(entry);
    if (playerId) liveById.set(playerId, entry);
  }
  const entries = baseEntries.map((entry) => {
    const playerId = entryPlayerId(entry);
    return playerId && liveById.has(playerId) ? mergeEntry(entry, liveById.get(playerId) as JsonObject) : entry;
  });
  const known = new Set(entries.map(entryPlayerId).filter((value): value is string => !!value));
  entries.push(...liveEntries.filter((entry) => {
    const playerId = entryPlayerId(entry);
    return !!playerId && !known.has(playerId);
  }));
  return {
    id: teamId,
    name: teamName(team),
    points: teamPoints(side),
    players: entries.map((entry) => player(entry, season, scoring, liveById.has(entryPlayerId(entry) || '')))
      .filter((value): value is Player => !!value),
  };
}

function matchupSnapshot(data: JsonObject, week: number): { home: string; away: string | null }[] {
  if (!week) return [];
  const result: { home: string; away: string | null }[] = [];
  for (const matchup of array(data.schedule)) {
    if (integer(matchup.matchupPeriodId) !== week) continue;
    const home = id(object(matchup.home)?.teamId);
    if (!home) continue;
    result.push({ home, away: id(object(matchup.away)?.teamId) });
  }
  return result;
}

export function parseEspnLeague(value: unknown, leagueId: string, season: number): LeagueSnapshot {
  const data = object(value);
  if (!data || !Array.isArray(data.teams) || !Array.isArray(data.schedule)) {
    throw new AppError('ESPN returned an invalid league response.', 502);
  }
  const week = currentWeek(data);
  const scoring = scoringPeriod(data);
  const sides = currentSides(data, week);
  const teams = array(data.teams).map((team) => {
    const teamId = id(team.id);
    return teamSnapshot(team, teamId ? sides.get(teamId) : undefined, season, scoring);
  }).filter((team): team is Team => !!team);
  const settings = object(data.settings);
  return {
    id: id(data.id) || leagueId,
    provider: 'espn',
    name: text(settings?.name) || text(data.name) || '',
    season,
    week,
    fetchedAt: new Date().toISOString(),
    teams,
    matchups: matchupSnapshot(data, week),
  };
}

function validateLeague(leagueId: string, season: number): void {
  if (!/^\d{1,12}$/.test(leagueId)) throw new AppError('Enter a valid ESPN league ID.');
  if (!Number.isInteger(season) || season < 2018 || season > new Date().getFullYear() + 1) {
    throw new AppError('Enter a valid ESPN season.');
  }
}

function cookieValue(name: string, value: unknown): string {
  if (typeof value !== 'string' || !value || /[\u0000-\u001f\u007f;]/.test(value)) {
    throw new AppError(`Invalid ESPN ${name} cookie.`);
  }
  return value;
}

function retryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, Math.ceil((date - Date.now()) / 1000));
  return undefined;
}

function endpoint(season: number, leagueId: string, views: string[], scoring?: number): URL {
  const url = new URL(`/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${leagueId}`, ESPN_API);
  views.forEach((view) => url.searchParams.append('view', view));
  if (scoring && scoring > 0) url.searchParams.set('scoringPeriodId', String(scoring));
  return url;
}

function timeoutSignal(): AbortSignal | undefined {
  return typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(REQUEST_TIMEOUT_MS) : undefined;
}

function isTimeout(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'name' in error && ['AbortError', 'TimeoutError'].includes(String((error as { name?: unknown }).name));
}

export async function fetchEspnLeague(
  credentials: { espn_s2: string; SWID: string },
  leagueId: string,
  season: number,
): Promise<LeagueSnapshot> {
  validateLeague(leagueId, season);
  const espnS2 = cookieValue('espn_s2', credentials?.espn_s2);
  const swid = cookieValue('SWID', credentials?.SWID);
  const cookie = `espn_s2=${espnS2}; SWID=${swid}`;
  const request = async (url: URL, filter?: JsonObject): Promise<unknown> => {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          Cookie: cookie,
          ...(filter ? { 'X-Fantasy-Filter': JSON.stringify(filter) } : {}),
        },
        cache: 'no-store',
        redirect: 'error',
        signal: timeoutSignal(),
      });
    } catch (error) {
      if (isTimeout(error)) throw new AppError('ESPN request timed out.', 502);
      throw new AppError('ESPN is unavailable right now.', 502);
    }
    if (response.status === 401) throw new AppError('ESPN authentication expired. Reconnect your ESPN account.', 401);
    if (response.status === 403) throw new AppError('ESPN denied access to this league.', 403);
    if (response.status === 404) throw new AppError('ESPN league was not found.', 404);
    if (response.status === 429) throw new AppError('ESPN is rate-limiting requests. Try again later.', 429, retryAfter(response.headers.get('Retry-After')));
    if (!response.ok) throw new AppError('ESPN is unavailable right now.', 502);
    try {
      return await response.json();
    } catch {
      throw new AppError('ESPN returned an invalid response.', 502);
    }
  };

  const metadata = object(await request(endpoint(season, leagueId, ESPN_METADATA_VIEWS)));
  if (!metadata || !Array.isArray(metadata.teams)) throw new AppError('ESPN returned an invalid league response.', 502);
  const week = currentWeek(metadata);
  const scoring = scoringPeriod(metadata);
  const filter = week > 0 ? { schedule: { filterMatchupPeriodIds: { value: [week] } } } : undefined;
  const scoreboard = object(await request(endpoint(season, leagueId, ESPN_SCOREBOARD_VIEWS, scoring), filter));
  if (!scoreboard || !Array.isArray(scoreboard.schedule)) throw new AppError('ESPN returned an invalid scoreboard response.', 502);
  const combined: JsonObject = {
    ...metadata,
    ...scoreboard,
    status: { ...object(metadata.status), ...object(scoreboard.status) },
    settings: { ...object(metadata.settings), ...object(scoreboard.settings) },
    teams: metadata.teams,
  };
  return parseEspnLeague(combined, leagueId, season);
}

export const ESPN_API_BASE = ESPN_API;
