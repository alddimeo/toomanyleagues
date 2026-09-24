import { AppError, appUrl } from './security';
import type { LeagueSnapshot, Player, Team } from './types';
import { withTeamProjection } from './projections';

const ESPN_API = 'https://lm-api-reads.fantasy.espn.com';
const ESPN_FAN_API = 'https://fan.api.espn.com';
const ESPN_IMAGE_API = 'https://mystique-api.fantasy.espn.com';
const ESPN_IMAGE_PATH = /^\/apis\/v1\/domains\/lm\/images\/([\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12})$/i;
const ESPN_PROXY_PATH = /^\/api\/espn\/team-logo\/([\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12})$/i;
const MAX_TEAM_LOGO_BYTES = 2 * 1024 * 1024;
const ESPN_METADATA_VIEWS = ['mSettings', 'mTeam', 'mRoster', 'mStatus'];
const ESPN_SCOREBOARD_VIEWS = ['mMatchupScore', 'mScoreboard'];
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_DISCOVERY_NODES = 10_000;

type JsonObject = Record<string, unknown>;
export type EspnLeagueOption = { id: string; name: string; season: number };

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

const NFL_TEAM_NAMES: Record<number, string> = {
  1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL', 7: 'DEN', 8: 'DET', 9: 'GB',
  10: 'TEN', 11: 'IND', 12: 'KC', 13: 'LV', 14: 'LAR', 15: 'MIA', 16: 'MIN', 17: 'NE',
  18: 'NO', 19: 'NYG', 20: 'NYJ', 21: 'PHI', 22: 'ARI', 23: 'PIT', 24: 'LAC', 25: 'SF',
  26: 'SEA', 27: 'TB', 28: 'WAS', 29: 'CAR', 30: 'JAX', 33: 'BAL', 34: 'HOU',
};

const NFL_TEAM_IDS_BY_NAME: Record<string, number> = {
  falcons: 1, bills: 2, bears: 3, bengals: 4, browns: 5, cowboys: 6, broncos: 7, lions: 8,
  packers: 9, titans: 10, colts: 11, chiefs: 12, raiders: 13, rams: 14, dolphins: 15,
  vikings: 16, patriots: 17, saints: 18, giants: 19, jets: 20, eagles: 21, cardinals: 22,
  steelers: 23, chargers: 24, '49ers': 25, seahawks: 26, buccaneers: 27, commanders: 28,
  panthers: 29, jaguars: 30, ravens: 33, texans: 34,
};

function nflTeamIdFromName(value: string): number | null {
  const normalized = value.toLowerCase();
  return Object.entries(NFL_TEAM_IDS_BY_NAME).find(([name]) => normalized.includes(name))?.[1] ?? null;
}

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

function mediaUrl(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length <= 2048) {
    const url = value.trim();
    if (/^https?:\/\//i.test(url)) return url;
    if (url.startsWith('//')) return `https:${url}`;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const result = mediaUrl(item);
      if (result) return result;
    }
    return undefined;
  }
  const record = object(value);
  if (!record) return undefined;
  for (const item of Object.values(record)) {
    const result = mediaUrl(item);
    if (result) return result;
  }
  return undefined;
}

export function espnTeamLogoId(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) return undefined;
    const match = url.origin === ESPN_IMAGE_API
      ? ESPN_IMAGE_PATH.exec(url.pathname)
      : url.origin === appUrl() ? ESPN_PROXY_PATH.exec(url.pathname) : null;
    return match?.[1];
  } catch {
    try {
      const url = new URL(value, appUrl());
      return url.origin === appUrl() && !url.search && !url.hash && !url.username && !url.password
        ? ESPN_PROXY_PATH.exec(url.pathname)?.[1]
        : undefined;
    } catch {
      return undefined;
    }
  }
}

export function espnTeamLogoProxyPath(value: unknown): string | undefined {
  const logoId = espnTeamLogoId(value);
  return logoId ? `/api/espn/team-logo/${logoId}` : undefined;
}

function validImage(type: string, bytes: Uint8Array): boolean {
  if (type === 'image/jpeg' || type === 'image/jpg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === 'image/png') return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value);
  if (type === 'image/gif') return ['GIF87a', 'GIF89a'].includes(String.fromCharCode(...bytes.subarray(0, 6)));
  return type === 'image/webp' && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP';
}

async function readTeamLogo(response: Response): Promise<Uint8Array> {
  const length = Number(response.headers.get('Content-Length'));
  if (Number.isFinite(length) && length > MAX_TEAM_LOGO_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new AppError('ESPN returned an invalid team logo.', 502);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new AppError('ESPN returned an invalid team logo.', 502);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_TEAM_LOGO_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new AppError('ESPN returned an invalid team logo.', 502);
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function fetchEspnTeamLogo(
  credentials: { espn_s2: string; SWID: string },
  logoId: string,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  if (!ESPN_IMAGE_PATH.test(`/apis/v1/domains/lm/images/${logoId}`)) throw new AppError('ESPN team logo was not found.', 404);
  const espnS2 = cookieValue('espn_s2', credentials?.espn_s2);
  const swid = cookieValue('SWID', credentials?.SWID);
  let response: Response;
  try {
    response = await fetch(new URL(`/apis/v1/domains/lm/images/${logoId}`, ESPN_IMAGE_API), {
      headers: { Accept: 'image/*', Cookie: `espn_s2=${espnS2}; SWID=${swid}` },
      cache: 'no-store',
      redirect: 'manual',
      signal: timeoutSignal(),
    });
  } catch {
    throw new AppError('ESPN team logo is unavailable right now.', 502);
  }
  if (response.status === 401) throw new AppError('ESPN authentication expired. Reconnect your ESPN account.', 401);
  if (!response.ok) throw new AppError('ESPN team logo is unavailable right now.', 502);
  const contentType = response.headers.get('Content-Type')?.split(';', 1)[0].trim().toLowerCase();
  if (!contentType || !['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'].includes(contentType)) {
    await response.body?.cancel().catch(() => undefined);
    throw new AppError('ESPN returned an invalid team logo.', 502);
  }
  const bytes = await readTeamLogo(response);
  if (!validImage(contentType, bytes)) throw new AppError('ESPN returned an invalid team logo.', 502);
  return { bytes, contentType: contentType === 'image/jpg' ? 'image/jpeg' : contentType };
}

function firstMediaUrl(...values: unknown[]): string | undefined {
  for (const value of values) {
    const result = mediaUrl(value);
    if (result) return result;
  }
  return undefined;
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

function ownerMatches(value: unknown, ownerId: string): boolean {
  const left = text(value)?.replace(/[{}]/g, '').toLowerCase();
  const right = ownerId.replace(/[{}]/g, '').toLowerCase();
  return Boolean(left && right && left === right);
}

function ownedBy(team: JsonObject, ownerId: string | undefined): boolean {
  if (!ownerId) return false;
  const owners = Array.isArray(team.owners) ? team.owners : [];
  return [team.owner, team.primaryOwner, ...owners].some((value) => ownerMatches(value, ownerId));
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

function playerProjection(entry: JsonObject, season: number, scoring: number): number | undefined {
  const pool = object(entry.playerPoolEntry);
  const player = playerObject(entry);
  const direct = firstNumber(pool?.projectedPoints, entry.projectedPoints, player.projectedPoints);
  if (direct !== null) return direct;
  for (const source of [pool?.stats, player.stats, entry.stats]) {
    const projected = array(source).find((stat) => integer(stat.statSourceId) === 1 &&
      integer(stat.seasonId) === season && integer(stat.scoringPeriodId) === scoring);
    const points = firstNumber(projected?.appliedStatTotal, projected?.appliedTotal);
    if (points !== null) return points;
  }
  return undefined;
}

function player(entry: JsonObject, season: number, scoring: number, scoped: boolean): Player | null {
  const playerData = playerObject(entry);
  const playerId = id(entry.playerId) || id(playerData.id) || id(object(entry.playerPoolEntry)?.id);
  if (!playerId) return null;
  const positionId = integer(playerData.defaultPositionId);
  const slotId = integer(entry.lineupSlotId);
  const fullName = text(playerData.fullName) || [text(playerData.firstName), text(playerData.lastName)]
    .filter((value): value is string => !!value).join(' ');
  const headshot = firstMediaUrl(
    playerData.headshot,
    playerData.headshotURL,
    playerData.imageUrl,
    playerData.image,
  ) || (/^\d+$/.test(playerId) ? `https://a.espncdn.com/i/headshots/nfl/players/full/${playerId}.png` : undefined);
  const proTeamId = integer(playerData.proTeamId);
  const inferredProTeamId = proTeamId !== null && NFL_TEAM_NAMES[proTeamId]
    ? proTeamId
    : (positionId === 16 || slotId === 16 ? nflTeamIdFromName(fullName) : null);
  const nflTeam = text(playerData.proTeamAbbreviation) || text(playerData.editorialTeamAbbr) ||
    text(playerData.proTeamName) || (inferredProTeamId === null ? null : NFL_TEAM_NAMES[inferredProTeamId] || null);
  const nflTeamLogo = firstMediaUrl(
    playerData.proTeamLogo,
    playerData.editorialTeamLogo,
    object(playerData.proTeam)?.logo,
    inferredProTeamId && NFL_TEAM_NAMES[inferredProTeamId] ? `https://a.espncdn.com/i/teamlogos/nfl/500/${inferredProTeamId}.png` : undefined,
  );
  return {
    id: playerId,
    name: fullName,
    position: positionId === null ? '' : POSITION_NAMES[positionId] || String(positionId),
    slot: slotId === null ? '' : SLOT_NAMES[slotId] || String(slotId),
    points: playerPoints(entry, season, scoring, scoped),
    projection: playerProjection(entry, season, scoring),
    stats: playerStats(entry, season, scoring, scoped),
    ...(headshot ? { headshot } : {}),
    ...(nflTeam ? { nflTeam } : {}),
    ...(nflTeamLogo ? { nflTeamLogo } : {}),
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
  for (const [target, previous, live] of [[mergedPool, basePool, currentPool], [mergedPlayer, basePlayer, currentPlayer], [merged, base, current]] as const) {
    const projections = array(previous?.stats).filter((stat) => integer(stat.statSourceId) === 1);
    if (projections.length) target.stats = [...array(live?.stats), ...projections];
  }
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
  const live = firstNumber(side?.totalPointsLive);
  const total = firstNumber(side?.totalPoints);
  if (live !== null && live > 0) return live;
  if (total !== null && total > 0) return total;
  return firstNumber(sideRosterData?.appliedStatTotal, side?.appliedStatTotal, live, total);
}

function teamSnapshot(team: JsonObject, side: JsonObject | undefined, season: number, scoring: number, ownerId?: string): Team | null {
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
  return withTeamProjection({
    id: teamId,
    name: teamName(team),
    logo: firstMediaUrl(team.logo, team.logoUrl, team.teamLogo, team.logos),
    ...(ownedBy(team, ownerId) ? { isUserTeam: true } : {}),
    points: teamPoints(side),
    projection: firstNumber(side?.totalProjectedPoints, side?.projectedPoints, object(side?.rosterForCurrentScoringPeriod)?.projectedPoints) ?? undefined,
    players: entries.map((entry) => player(entry, season, scoring, liveById.has(entryPlayerId(entry) || '')))
      .filter((value): value is Player => !!value),
  });
}

function matchupSnapshot(data: JsonObject, week: number): LeagueSnapshot['matchups'] {
  if (!week) return [];
  const result: LeagueSnapshot['matchups'] = [];
  for (const matchup of array(data.schedule)) {
    if (integer(matchup.matchupPeriodId) !== week) continue;
    const home = id(object(matchup.home)?.teamId);
    if (!home) continue;
    const probability = firstNumber(object(matchup.home)?.winProbability, object(matchup.home)?.winningPercentage);
    result.push({ home, away: id(object(matchup.away)?.teamId), ...(probability !== null && probability >= 0 && probability <= 1 ? { homeWinProbability: probability * 100 } : {}) });
  }
  return result;
}

export function parseEspnLeague(value: unknown, leagueId: string, season: number, ownerId?: string): LeagueSnapshot {
  const data = object(value);
  if (!data || !Array.isArray(data.teams) || !Array.isArray(data.schedule)) {
    throw new AppError('ESPN returned an invalid league response.', 502);
  }
  const week = currentWeek(data);
  const scoring = scoringPeriod(data);
  const sides = currentSides(data, week);
  const teams = array(data.teams).map((team) => {
    const teamId = id(team.id);
    return teamSnapshot(team, teamId ? sides.get(teamId) : undefined, season, scoring, ownerId);
  }).filter((team): team is Team => !!team);
  const settings = object(data.settings);
  return {
    id: id(data.id) || leagueId,
    provider: 'espn',
    name: text(settings?.name) || text(data.name) || '',
    logo: firstMediaUrl(data.logo, data.logoUrl, data.leagueLogo, settings?.logo, settings?.logoUrl, settings?.leagueLogo),
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

function discoveryId(value: unknown): string | null {
  const result = text(value)?.trim() || '';
  return /^\d{1,12}$/.test(result) ? result : null;
}

function discoveryName(value: JsonObject): string {
  for (const key of ['leagueName', 'groupName', 'displayName', 'name', 'title']) {
    const result = text(value[key])?.replace(/\s+/g, ' ').trim().slice(0, 120);
    if (result) return result;
  }
  return '';
}

function discoverySeason(value: JsonObject, fallback: number): number {
  for (const key of ['seasonId', 'season', 'seasonYear', 'year']) {
    const candidate = integer(value[key]) ?? integer(object(value[key])?.id) ?? integer(object(value[key])?.year);
    if (candidate !== null && candidate >= 2018 && candidate <= new Date().getFullYear() + 1) return candidate;
  }
  return fallback;
}

function discoverySport(value: unknown): string {
  const direct = text(value);
  if (direct) return direct;
  const nested = object(value);
  return text(nested?.name) || text(nested?.abbreviation) || text(nested?.code) || '';
}

function nonFootballSport(value: string): boolean {
  return /basket|baseball|hockey|soccer|basketball|fba|flb|fhl|futbol/i.test(value) && !/football|ffl/i.test(value);
}

export function parseEspnProfile(value: unknown, fallbackSeason: number): EspnLeagueOption[] {
  const options = new Map<string, EspnLeagueOption>();
  let nodes = 0;
  const add = (record: JsonObject, parentKey: string, sport: string, inheritedName: string, season: number) => {
    const leagueIdField = Object.entries(record).find(([key]) => /^(?:league|group)[_-]?id$/i.test(key))?.[1];
    const id = discoveryId(leagueIdField ?? (/league/i.test(parentKey) ? record.id : undefined));
    if (!id || nonFootballSport(sport)) return;
    const recordName = discoveryName(record);
    const name = recordName || inheritedName || `ESPN League ${id}`;
    const recordSeason = discoverySeason(record, season);
    const key = `${id}:${recordSeason}`;
    const existing = options.get(key);
    if (!existing || (existing.name.startsWith('ESPN League ') && recordName)) options.set(key, { id, name, season: recordSeason });
  };
  const walk = (current: unknown, parentKey: string, sport: string, inheritedName: string, season: number, depth: number): void => {
    if (nodes++ >= MAX_DISCOVERY_NODES || depth > 8) return;
    if (Array.isArray(current)) {
      for (const item of current) walk(item, parentKey, sport, inheritedName, season, depth + 1);
      return;
    }
    const record = object(current);
    if (!record) return;
    const localSport = discoverySport(record.sport || record.sportName || record.gameCode || record.gameAbbrev || record.gameName || (Array.isArray(record.groups) ? record.name : undefined)) || sport;
    const localSeason = discoverySeason(record, season);
    const recordName = discoveryName(record);
    const hasLeagueName = Object.keys(record).some((key) => /^league[_-]?name$/i.test(key));
    add(record, parentKey, localSport, inheritedName, localSeason);
    for (const [key, child] of Object.entries(record)) {
      if (!Array.isArray(child) && !object(child)) continue;
      walk(child, key, localSport, hasLeagueName ? recordName : '', localSeason, depth + 1);
    }
  };
  walk(value, '', '', '', fallbackSeason, 0);
  return [...options.values()].slice(0, 10);
}

export async function discoverEspnLeagues(
  credentials: { espn_s2: string; SWID: string },
  fallbackSeason = new Date().getFullYear(),
): Promise<EspnLeagueOption[]> {
  const espnS2 = cookieValue('espn_s2', credentials?.espn_s2);
  const swid = cookieValue('SWID', credentials?.SWID);
  const url = new URL(`/apis/v2/fans/${encodeURIComponent(swid)}`, ESPN_FAN_API);
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json', Cookie: `SWID=${swid}; espn_s2=${espnS2}` },
      cache: 'no-store',
      redirect: 'manual',
      signal: timeoutSignal(),
    });
  } catch (error) {
    if (isTimeout(error)) throw new AppError('ESPN league discovery timed out.', 502);
    throw new AppError('ESPN league discovery is unavailable right now.', 502);
  }
  if (response.status === 401) throw new AppError('ESPN authentication expired. Reconnect your ESPN account.', 401);
  if (response.status === 403) throw new AppError('ESPN denied access to your leagues.', 403);
  if (response.status === 429) throw new AppError('ESPN is rate-limiting requests. Try again later.', 429, retryAfter(response.headers.get('Retry-After')));
  if (!response.ok) throw new AppError('ESPN league discovery is unavailable right now.', 502);
  const length = Number(response.headers.get('Content-Length'));
  if (Number.isFinite(length) && length > 1_000_000) throw new AppError('ESPN returned an invalid league list.', 502);
  try {
    return parseEspnProfile(await response.json(), fallbackSeason);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('ESPN returned an invalid league list.', 502);
  }
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
        redirect: 'manual',
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
  return parseEspnLeague(combined, leagueId, season, swid);
}

export const ESPN_API_BASE = ESPN_API;
export const ESPN_FAN_API_BASE = ESPN_FAN_API;
