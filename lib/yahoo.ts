import { AppError } from './security';
import { nflTeamLogoUrl, normalizeNflTeam } from './nfl';
import type { LeagueSnapshot, Player, Team } from './types';
import { withTeamProjection } from './projections';

const YAHOO_API_URL = 'https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2';
const YAHOO_REDZONE_URL = 'https://pub-api.fantasysports.yahoo.com/fantasy/v3/redzone/nfl';
const REQUEST_TIMEOUT_MS = 10_000;

export type YahooCredentials = { Y: string; T: string };

type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asText = (value: unknown): string | null => {
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
};

function mediaUrl(value: unknown): string | undefined {
  if (typeof value === 'string' && /^https?:\/\//i.test(value.trim()) && value.length <= 2048) return value.trim();
  if (Array.isArray(value)) {
    for (const item of value) {
      const result = mediaUrl(item);
      if (result) return result;
    }
    return undefined;
  }
  if (!isObject(value)) return undefined;
  for (const item of Object.values(value)) {
    const result = mediaUrl(item);
    if (result) return result;
  }
  return undefined;
}

const asNumber = (value: unknown): number | null => {
  const text = asText(value);
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
};

const asInteger = (value: unknown): number | null => {
  const number = asNumber(value);
  return number !== null && Number.isInteger(number) ? number : null;
};

/** Yahoo's JSON converter represents one resource as an array of field objects. */
function mergeFragments(value: unknown): JsonObject {
  if (Array.isArray(value)) {
    const merged: JsonObject = {};
    for (const item of value) Object.assign(merged, mergeFragments(item));
    return merged;
  }
  if (!isObject(value)) return {};

  const merged: JsonObject = {};
  for (const [key, item] of Object.entries(value)) {
    if (/^\d+$/.test(key) && (isObject(item) || Array.isArray(item))) {
      Object.assign(merged, mergeFragments(item));
    } else {
      merged[key] = item;
    }
  }
  return merged;
}

function directField(value: unknown, key: string): unknown {
  if (Array.isArray(value) && key in value) return value[Number(key)];
  if (isObject(value) && key in value) return value[key];
  return mergeFragments(value)[key];
}

function pathField(value: unknown, path: string): unknown {
  let current: unknown = value;
  for (const part of path.split('.')) {
    current = directField(current, part);
    if (current === undefined || current === null) return undefined;
  }
  return current;
}

function collectionItems(value: unknown, resourceName: string): unknown[] {
  if (Array.isArray(value)) {
    if (value.length === 0) return [];
    if (value.every(Array.isArray)) return value.flatMap((item) => collectionItems(item, resourceName));
    const objects = value.filter(isObject);
    const keyNames = [`${resourceName}_key`, `${resourceName}_id`];
    const separateResources = objects.filter((item) =>
      keyNames.some((key) => key in item) && Object.keys(item).length > 1,
    );
    return separateResources.length > 1 ? objects : [value];
  }

  if (isObject(value)) {
    const indexed = Object.keys(value)
      .filter((key) => /^\d+$/.test(key))
      .sort((a, b) => Number(a) - Number(b));
    if (indexed.length) {
      return indexed.flatMap((key) => {
        const item = value[key];
        const nested = isObject(item) ? item[resourceName] : undefined;
        return nested === undefined
          ? [item]
          : collectionItems(nested, resourceName);
      });
    }
    return [value];
  }

  return [];
}

function findResources(value: unknown, resourceName: string): JsonObject[] {
  const found: JsonObject[] = [];
  const visit = (current: unknown): void => {
    if (Array.isArray(current)) {
      for (const item of current) visit(item);
      return;
    }
    if (!isObject(current)) return;

    for (const [key, item] of Object.entries(current)) {
      if (key === resourceName) {
        for (const resource of collectionItems(item, resourceName)) {
          const record = mergeFragments(resource);
          if (Object.keys(record).length) found.push(record);
        }
      }
      visit(item);
    }
  };
  visit(value);
  return found;
}

function firstField(value: unknown, ...paths: string[]): unknown {
  for (const path of paths) {
    const item = pathField(value, path);
    if (item !== undefined && item !== null) return item;
  }
  return undefined;
}

function mediaField(value: unknown, ...paths: string[]): string | undefined {
  for (const path of paths) {
    const result = mediaUrl(firstField(value, path));
    if (result) return result;
  }
  return undefined;
}

function textField(value: unknown, ...paths: string[]): string | null {
  for (const path of paths) {
    const item = firstField(value, path);
    const text = asText(item);
    if (text) return text;
  }
  return null;
}

function numberField(value: unknown, ...paths: string[]): number | null {
  for (const path of paths) {
    const item = firstField(value, path);
    const number = asNumber(item);
    if (number !== null) return number;
  }
  return null;
}

function retryAfter(response: Response): number | undefined {
  const raw = response.headers?.get?.('retry-after');
  if (!raw) return undefined;
  const value = Number(raw);
  if (Number.isFinite(value) && value >= 0) return Math.ceil(value);
  const date = Date.parse(raw);
  return Number.isNaN(date) ? undefined : Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

async function jsonRequest(
  url: string,
  init: RequestInit,
): Promise<unknown> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new AppError('Yahoo request timed out', 502));
    }, REQUEST_TIMEOUT_MS);
  });
  try {
    const response = await Promise.race([
      fetch(url, { ...init, signal: controller.signal }),
      timeout,
    ]);
    if (response.status === 401) throw new AppError('Yahoo authorization expired', 401);
    if (response.status === 429) {
      throw new AppError('Yahoo rate limit exceeded', 429, retryAfter(response));
    }
    if (response.ok === false || response.status >= 400) throw new AppError('Yahoo upstream request failed', 502);
    try {
      return await Promise.race([response.json(), timeout]);
    } catch {
      throw new AppError('Invalid Yahoo response', 502);
    }
  } catch (error) {
    if (controller.signal.aborted) {
      throw new AppError('Yahoo request timed out', 502);
    }
    throw error instanceof AppError ? error : new AppError('Yahoo request failed', 502);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function apiUrl(path: string): string {
  return `${YAHOO_API_URL}${path}${path.includes('?') ? '&' : '?'}format=json`;
}

function browserCookies(credentials: YahooCredentials): RequestInit {
  for (const value of [credentials?.Y, credentials?.T]) {
    if (typeof value !== 'string' || !value || /[\u0000-\u001f\u007f;]/.test(value)) throw new AppError('Invalid Yahoo session.', 401);
  }
  return {
    headers: {
      accept: 'application/json',
      cookie: `Y=${credentials.Y}; T=${credentials.T}`,
    },
    cache: 'no-store',
    redirect: 'manual',
  };
}

export function parseYahooLeagues(payload: unknown): { id: string; name: string; season: number }[] {
  const directLeagues = findResources(payload, 'league');
  const games = findResources(payload, 'game');
  const gameLeagues = games.flatMap((game) => {
    const code = textField(game, 'code');
    if (code && code.toLowerCase() !== 'nfl') return [];
    return findResources(game, 'league').map((league) => ({
      league,
      gameSeason: asInteger(firstField(game, 'season')),
    }));
  });

  const candidates = gameLeagues.length
    ? gameLeagues
    : directLeagues.map((league) => ({ league, gameSeason: null }));
  const byId = new Map<string, { id: string; name: string; season: number }>();
  for (const { league, gameSeason } of candidates) {
    const id = textField(league, 'league_key', 'league_id');
    const season = asInteger(firstField(league, 'season')) ?? gameSeason;
    const name = textField(league, 'name');
    if (!id || !name || season === null) continue;
    byId.set(id, { id, name, season });
  }

  const leagues = [...byId.values()];
  const currentSeason = leagues.reduce<number | null>(
    (current, league) => (current === null || league.season > current ? league.season : current),
    null,
  );
  return currentSeason === null
    ? leagues
    : leagues.filter((league) => league.season === currentSeason);
}

function validLeagueKey(leagueId: string): boolean {
  return /^(?:nfl|\d{1,4})\.l\.\d{1,12}$/.test(leagueId);
}

function leagueKey(leagueId: string): string {
  if (!validLeagueKey(leagueId)) throw new AppError('Invalid Yahoo league key', 400);
  return leagueId;
}

function parseStatValue(value: unknown): string | number {
  const number = asNumber(value);
  return number === null ? String(value ?? '') : number;
}

function statLabels(payload: unknown): Map<string, string> {
  const labels = new Map<string, string>();
  for (const category of findResources(payload, 'stat_categories')) {
    for (const stat of findResources(category, 'stat')) {
      const id = textField(stat, 'stat_id', 'id');
      const label = textField(stat, 'display_name', 'name');
      if (id && label) labels.set(id, label);
    }
  }
  return labels;
}

function statPointModifiers(payload: unknown, labels: Map<string, string>): Map<string, number> {
  const modifiers = new Map<string, number>();
  for (const group of findResources(payload, 'stat_modifiers')) {
    for (const stat of findResources(group, 'stat')) {
      const id = textField(stat, 'stat_id', 'id');
      const value = numberField(stat, 'value', 'modifier');
      const label = id && labels.get(id);
      if (label && value !== null) modifiers.set(label, value);
    }
  }
  return modifiers;
}

function parsePlayer(record: JsonObject, labels: Map<string, string>): Player | null {
  const id = textField(record, 'player_key', 'player_id');
  if (!id) return null;
  const selected = textField(record, 'selected_position.position', 'selected_position');
  const display = textField(record, 'display_position');
  const eligible = textField(record, 'eligible_positions.0.position', 'eligible_positions.position');
  const first = textField(record, 'name.first');
  const last = textField(record, 'name.last');
  const name = textField(record, 'name.full', 'name') ?? ([first, last].filter(Boolean).join(' ') || id);
  const headshot = mediaField(record, 'image_url', 'headshot', 'player_image_url', 'image');
  const rawNflTeam = textField(record, 'editorial_team_abbr', 'editorial_team_full_name', 'team_abbr', 'team_name');
  const nflTeam = rawNflTeam ? normalizeNflTeam(rawNflTeam) ?? rawNflTeam : null;
  const nflTeamLogo = nflTeamLogoUrl(nflTeam ?? undefined) ?? mediaField(record, 'editorial_team_logo', 'team_logo', 'editorial_team_logos');
  const stats: Record<string, string | number> = {};
  for (const stat of findResources(record, 'stat')) {
    const statId = textField(stat, 'stat_id', 'id');
    const value = firstField(stat, 'value');
    if (statId && value !== undefined && value !== null) {
      stats[labels.get(statId) ?? `Yahoo stat ${statId}`] = parseStatValue(value);
    }
  }
  if (!Object.keys(stats).length) {
    const statObject = mergeFragments(firstField(record, 'stats') ?? firstField(record, 'player_stats.stats'));
    for (const [key, value] of Object.entries(statObject)) {
      if (key !== 'stat' && (typeof value === 'string' || typeof value === 'number')) {
        stats[labels.get(key) ?? `Yahoo stat ${key}`] = parseStatValue(value);
      }
    }
  }
  const projection = numberField(record, 'player_projected_points.total', 'projected_points.total', 'projected_points');
  return {
    id,
    name,
    position: display ?? eligible ?? selected ?? '',
    slot: selected ?? '',
    points: numberField(record, 'player_points.total', 'points', 'total_points'),
    ...(projection !== null ? { projection } : {}),
    stats,
    ...(headshot ? { headshot } : {}),
    ...(nflTeam ? { nflTeam } : {}),
    ...(nflTeamLogo ? { nflTeamLogo } : {}),
  };
}

function parseTeam(record: JsonObject, labels: Map<string, string>): Team | null {
  const id = textField(record, 'team_key', 'team_id', 'id');
  if (!id) return null;
  const players = findResources(record, 'player')
    .map((player) => parsePlayer(player, labels))
    .filter((player): player is Player => player !== null);
  const projection = numberField(record, 'team_projected_points.total', 'projected_points.total', 'projected_points');
  return {
    id,
    name: textField(record, 'name') ?? id,
    logo: mediaField(record, 'logo', 'logo_url', 'team_logo', 'team_logos.0.team_logo.0.url', 'team_logos.0.team_logo.url', 'team_logos.team_logo.url'),
    ...(findResources(record, 'manager').some((manager) => ['1', 'true'].includes(String(firstField(manager, 'is_current_login', 'is_current_user')).toLowerCase())) ? { isUserTeam: true } : {}),
    points: numberField(record, 'team_points.total', 'points', 'total_points', 'team_score'),
    ...(projection !== null ? { projection } : {}),
    players,
  };
}

function mergeTeams(records: JsonObject[], labels = new Map<string, string>()): Team[] {
  const teams = new Map<string, Team>();
  for (const record of records) {
    const team = parseTeam(record, labels);
    if (!team) continue;
    const existing = teams.get(team.id);
    if (!existing) {
      teams.set(team.id, team);
      continue;
    }
    teams.set(team.id, {
      id: team.id,
      name: team.name || existing.name,
      logo: team.logo ?? existing.logo,
      isUserTeam: team.isUserTeam || existing.isUserTeam,
      points: team.points ?? existing.points,
      projection: team.projection ?? existing.projection,
      players: team.players.length ? team.players : existing.players,
    });
  }
  return [...teams.values()];
}

function mergeTeamValues(values: Team[]): Team[] {
  const teams = new Map<string, Team>();
  for (const team of values) {
    const existing = teams.get(team.id);
    if (!existing) {
      teams.set(team.id, team);
      continue;
    }
    teams.set(team.id, {
      id: team.id,
      name: team.name || existing.name,
      logo: team.logo ?? existing.logo,
      isUserTeam: team.isUserTeam || existing.isUserTeam,
      points: existing.points,
      projection: existing.projection ?? team.projection,
      players: team.players.length ? team.players : existing.players,
    });
  }
  return [...teams.values()].map(withTeamProjection);
}

type YahooLiveProjection = { projection?: number; players: Map<string, number> };

export function parseYahooRedzoneProjections(payload: unknown): Map<string, YahooLiveProjection> {
  const result = new Map<string, YahooLiveProjection>();
  const service = firstField(payload, 'service') ?? payload;
  const leagues = firstField(service, 'leagues');
  if (!isObject(leagues)) return result;
  for (const league of Object.values(leagues)) {
    const teams = firstField(league, 'teams');
    if (!isObject(teams)) continue;
    for (const [teamKey, value] of Object.entries(teams)) {
      if (!isObject(value)) continue;
      const id = textField(value, 'id') ?? teamKey;
      const players = new Map<string, number>();
      const roster = firstField(value, 'players');
      if (Array.isArray(roster)) for (const player of roster) {
        const playerId = textField(player, 'id');
        const projection = numberField(player, 'projectedPoints');
        if (playerId && projection !== null) players.set(playerId, projection);
      }
      const projection = numberField(value, 'projectedPoints');
      result.set(id, { ...(projection !== null ? { projection } : {}), players });
    }
  }
  return result;
}

function yahooDefenseInitialPoints(payload: unknown): number {
  const leagues = firstField(firstField(payload, 'service') ?? payload, 'leagues');
  if (!isObject(leagues)) return 0;
  const league = Object.values(leagues)[0];
  const stats = firstField(league, 'stats');
  if (!Array.isArray(stats)) return 0;
  return stats.reduce((total, stat) => {
    const id = textField(stat, 'id');
    return id === '50' || id === '71' ? total + (numberField(stat, 'modifier') ?? 0) : total;
  }, 0);
}

function parseMatchups(payload: unknown, labels = new Map<string, string>()): { matchups: LeagueSnapshot['matchups']; week: number | null; teams: Team[] } {
  const matchups: LeagueSnapshot['matchups'] = [];
  const scoreboardMatchups = findResources(payload, 'matchup');
  const league = findResources(payload, 'league')[0];
  const scoreboard = findResources(payload, 'scoreboard')[0];
  const scoreboardTeams: JsonObject[] = [];
  for (const matchup of scoreboardMatchups) {
    const teams = findResources(matchup, 'team');
    const unique = new Map<string, JsonObject>();
    for (const team of teams) {
      const id = textField(team, 'team_key', 'team_id', 'id');
      if (id && !unique.has(id)) unique.set(id, team);
    }
    const ids = [...unique.keys()];
    const chance = numberField(matchup, 'home_win_probability', 'win_probability.home') ??
      numberField(unique.get(ids[0]), 'win_probability');
    if (ids.length) matchups.push({ home: ids[0], away: ids[1] ?? null,
      ...(chance !== null && chance >= 0 && chance <= 100 ? { homeWinProbability: chance <= 1 ? chance * 100 : chance } : {}) });
    scoreboardTeams.push(...unique.values());
  }
  return {
    matchups,
    week: asInteger(firstField(league, 'week', 'current_week')) ??
      asInteger(firstField(scoreboard, 'week', 'current_week')) ??
      asInteger(firstField(payload, 'week', 'current_week')),
    teams: mergeTeams(scoreboardTeams, labels),
  };
}

export function parseYahooLeagueSnapshot(
  payload: unknown,
  leagueId = '',
  season = 0,
  scoreboardPayload?: unknown,
): LeagueSnapshot {
  const leagueRecords = findResources(payload, 'league');
  const league = leagueRecords.find((item) => textField(item, 'name')) ?? leagueRecords[0] ?? {};
  const labels = statLabels(payload);
  const modifiers = statPointModifiers(payload, labels);
  const scoreboard = parseMatchups(scoreboardPayload ?? payload, labels);
  const teams = mergeTeams(findResources(payload, 'team'), labels);
  const mergedTeams = mergeTeamValues([...scoreboard.teams, ...teams]);
  const week =
    asInteger(firstField(league, 'current_week', 'week')) ??
    scoreboard.week ??
    0;
  return {
    id: textField(league, 'league_key') ?? leagueId,
    provider: 'yahoo',
    name: textField(league, 'name') ?? leagueId,
    logo: mediaField(league, 'logo', 'logo_url', 'league_logo', 'league_logo_url'),
    season: asInteger(firstField(league, 'season')) ?? season,
    week,
    fetchedAt: new Date().toISOString(),
    teams: mergedTeams.map((team) => withTeamProjection(modifiers.size ? { ...team, players: team.players.map((player) => ({
      ...player,
      statPoints: Object.fromEntries(Object.entries(player.stats).flatMap(([label, value]) => {
        const amount = asNumber(value);
        const modifier = modifiers.get(label);
        return amount !== null && modifier !== undefined ? [[label, amount * modifier]] : [];
      })),
    })) } : team)),
    matchups: scoreboard.matchups,
  };
}

export const parseYahooLeague = parseYahooLeagueSnapshot;
export const parseLeagueSnapshot = parseYahooLeagueSnapshot;

export async function discoverYahooLeagues(
  credentials: YahooCredentials,
): Promise<{ id: string; name: string; season: number }[]> {
  const payload = await jsonRequest(
    apiUrl('/users;use_login=1/games;game_codes=nfl/leagues'),
    browserCookies(credentials),
  );
  return parseYahooLeagues(payload);
}

export async function fetchYahooLeague(
  credentials: YahooCredentials,
  leagueId: string,
  season: number,
  previous?: LeagueSnapshot,
  projectionTeamIds?: string[],
): Promise<LeagueSnapshot> {
  const key = leagueKey(leagueId);
  if (!Number.isInteger(season) || season < 2000 || season > 2100) {
    throw new AppError('Invalid Yahoo season', 400);
  }
  const metadata = await jsonRequest(apiUrl(`/league/${key}/settings`), browserCookies(credentials));
  const metadataLeague = findResources(metadata, 'league')[0];
  const metadataSnapshot = parseYahooLeagueSnapshot(metadata, key, season);
  if (
    !metadataLeague ||
    !textField(metadataLeague, 'league_key', 'league_id') ||
    !textField(metadataLeague, 'name') ||
    metadataSnapshot.week < 1
  ) {
    throw new AppError('Invalid Yahoo league response', 502);
  }

  const week = metadataSnapshot.week;
  const [roster, scoreboard] = await Promise.all([
    jsonRequest(
      apiUrl(`/league/${key}/teams/roster;week=${week}/players/stats;type=week;week=${week}`),
      browserCookies(credentials),
    ),
    jsonRequest(
      apiUrl(`/league/${key}/scoreboard;week=${week}`),
      browserCookies(credentials),
    ),
  ]);
  const snapshot = parseYahooLeagueSnapshot({ metadata, roster }, key, season, scoreboard);
  if (!snapshot.teams.length) throw new AppError('Invalid Yahoo league response', 502);
  if (previous?.week === week && previous.season === season && previous.id === key) {
    const savedTeams = new Map(previous.teams.map((team) => [team.id, team.projection] as const));
    const saved = new Map(previous.teams.flatMap((team) => team.players.map((player) => [player.id, player.projection] as const)));
    snapshot.teams = snapshot.teams.map((team) => ({ ...team,
      ...(savedTeams.get(team.id) !== undefined ? { projection: savedTeams.get(team.id) } : {}), players: team.players.map((player) => ({
      ...player,
      ...(saved.get(player.id) !== undefined ? { projection: saved.get(player.id) } : {}),
    })) }));
  }
  const userTeam = snapshot.teams.find((team) => team.isUserTeam);
  const userMatchup = userTeam && snapshot.matchups.find((item) => item.home === userTeam.id || item.away === userTeam.id);
  const selectedIds = projectionTeamIds ?? (userTeam ? [userTeam.id, userMatchup?.home === userTeam.id ? userMatchup.away : userMatchup?.home].filter((id): id is string => Boolean(id)) : []);
  const selectedTeams = [...new Set(selectedIds)].slice(0, 2).flatMap((teamId) => snapshot.teams.filter((team) => team.id === teamId));
  let live: Map<string, YahooLiveProjection> | undefined;
  if (selectedTeams.length) {
    const payload = await jsonRequest(
      `${YAHOO_REDZONE_URL}?league_id=${key.split('.').at(-1)}&format=json&player_image_type=17`,
      browserCookies(credentials),
    ).catch(() => undefined);
    if (payload) {
      live = parseYahooRedzoneProjections(payload);
      snapshot.yahooDefenseInitialPoints = yahooDefenseInitialPoints(payload);
    }
  }
  for (const team of live ? snapshot.teams : []) {
    const values = live?.get(team.id.split('.').at(-1)!);
    team.players = team.players.map((player) => {
      const projection = values?.players.get(player.id.split('.').at(-1)!);
      return projection === undefined ? player : { ...player, projection };
    });
    if (values?.projection !== undefined) team.projection = values.projection;
  }
  if (selectedIds.length && live?.size) snapshot.yahooProjectionsAt = new Date().toISOString();
  return snapshot;
}
