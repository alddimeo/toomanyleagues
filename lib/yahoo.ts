import { AppError } from './security';
import type { LeagueSnapshot, Player, Team } from './types';

const YAHOO_AUTH_URL = 'https://api.login.yahoo.com/oauth2/request_auth';
const YAHOO_TOKEN_URL = 'https://api.login.yahoo.com/oauth2/get_token';
const YAHOO_API_URL = 'https://fantasysports.yahooapis.com/fantasy/v2';
const CALLBACK_PATH = '/api/yahoo/callback';
const REQUEST_TIMEOUT_MS = 10_000;

export type YahooTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
};

type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asText = (value: unknown): string | null => {
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
};

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
    if (value.some((item) => Array.isArray(item) && item.length > 0)) {
      return value.flatMap((item) => collectionItems(item, resourceName));
    }

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

function env(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new AppError(`Missing ${name}`, 500);
  return value;
}

function redirectUri(): string {
  const appUrl = env('APP_URL');
  let url: URL;
  try {
    url = new URL(appUrl);
  } catch {
    throw new AppError('Invalid APP_URL', 500);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new AppError('Invalid APP_URL', 500);
  }
  return `${appUrl.replace(/\/$/, '')}${CALLBACK_PATH}`;
}

export function yahooAuthorizeUrl(state: string): string {
  if (!state?.trim()) throw new AppError('Missing OAuth state', 400);
  const params = new URLSearchParams({
    client_id: env('YAHOO_CLIENT_ID'),
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: 'fspt-r',
    state,
  });
  return `${YAHOO_AUTH_URL}?${params.toString()}`;
}

function basicAuth(clientId: string, clientSecret: string): string {
  const value = `${clientId}:${clientSecret}`;
  if (typeof btoa === 'function') return btoa(value);
  return Buffer.from(value, 'utf8').toString('base64');
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
  kind: 'api' | 'token' = 'api',
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
    if (response.status === 401) {
      throw new AppError(
        kind === 'token' ? 'Yahoo authorization failed' : 'Yahoo authorization expired',
        401,
      );
    }
    if (response.status === 429) {
      throw new AppError('Yahoo rate limit exceeded', 429, retryAfter(response));
    }
    if (kind === 'token' && response.status === 400) {
      try {
        const body = await Promise.race([response.json(), timeout]);
        if (isObject(body) && body.error === 'invalid_grant') {
          throw new AppError('Yahoo authorization failed', 401);
        }
      } catch (error) {
        if (error instanceof AppError) throw error;
      }
      throw new AppError('Yahoo token request failed', 502);
    }
    if (response.ok === false || response.status >= 400) {
      throw new AppError(
        kind === 'token' ? 'Yahoo token request failed' : 'Yahoo upstream request failed',
        502,
      );
    }
    try {
      return await Promise.race([response.json(), timeout]);
    } catch {
      throw new AppError(
        kind === 'token' ? 'Invalid Yahoo token response' : 'Invalid Yahoo response',
        502,
      );
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

async function tokenRequest(body: URLSearchParams): Promise<YahooTokens> {
  const clientId = env('YAHOO_CLIENT_ID');
  const clientSecret = env('YAHOO_CLIENT_SECRET');
  const data = await jsonRequest(YAHOO_TOKEN_URL, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      authorization: `Basic ${basicAuth(clientId, clientSecret)}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
    redirect: 'error',
  }, 'token');

  const accessToken = textField(data, 'access_token');
  const expiresIn = numberField(data, 'expires_in');
  if (!accessToken || expiresIn === null || expiresIn <= 0) {
    throw new AppError('Invalid Yahoo token response', 502);
  }

  return {
    accessToken,
    refreshToken: textField(data, 'refresh_token') ?? '',
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
  };
}

export async function exchangeYahooCode(code: string): Promise<YahooTokens> {
  if (!code?.trim()) throw new AppError('Missing OAuth code', 400);
  const tokens = await tokenRequest(
    new URLSearchParams({
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri(),
    }),
  );
  if (!tokens.refreshToken) throw new AppError('Invalid Yahoo token response', 502);
  return tokens;
}

export async function refreshYahooTokens(refreshToken: string): Promise<YahooTokens> {
  if (!refreshToken?.trim()) throw new AppError('Missing Yahoo refresh token', 400);
  const tokens = await tokenRequest(
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      redirect_uri: redirectUri(),
    }),
  );
  return { ...tokens, refreshToken: tokens.refreshToken || refreshToken };
}

function apiUrl(path: string): string {
  return `${YAHOO_API_URL}${path}${path.includes('?') ? '&' : '?'}format=json`;
}

function bearer(accessToken: string): RequestInit {
  if (!accessToken?.trim()) throw new AppError('Missing Yahoo access token', 401);
  return {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${accessToken}`,
    },
    cache: 'no-store',
    redirect: 'error',
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

function parsePlayer(record: JsonObject, labels: Map<string, string>): Player | null {
  const id = textField(record, 'player_key', 'player_id');
  if (!id) return null;
  const selected = textField(record, 'selected_position.position', 'selected_position');
  const display = textField(record, 'display_position');
  const eligible = textField(record, 'eligible_positions.0.position', 'eligible_positions.position');
  const first = textField(record, 'name.first');
  const last = textField(record, 'name.last');
  const name = textField(record, 'name.full', 'name') ?? ([first, last].filter(Boolean).join(' ') || id);
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
  return {
    id,
    name,
    position: display ?? eligible ?? selected ?? '',
    slot: selected ?? '',
    points: numberField(record, 'player_points.total', 'points', 'total_points'),
    stats,
  };
}

function parseTeam(record: JsonObject, labels: Map<string, string>): Team | null {
  const id = textField(record, 'team_key', 'team_id', 'id');
  if (!id) return null;
  const players = findResources(record, 'player')
    .map((player) => parsePlayer(player, labels))
    .filter((player): player is Player => player !== null);
  return {
    id,
    name: textField(record, 'name') ?? id,
    points: numberField(record, 'team_points.total', 'points', 'total_points', 'team_score'),
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
      points: team.points ?? existing.points,
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
      points: team.points ?? existing.points,
      players: team.players.length ? team.players : existing.players,
    });
  }
  return [...teams.values()];
}

function parseMatchups(payload: unknown, labels = new Map<string, string>()): { matchups: { home: string; away: string | null }[]; week: number | null; teams: Team[] } {
  const matchups: { home: string; away: string | null }[] = [];
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
    if (ids.length) matchups.push({ home: ids[0], away: ids[1] ?? null });
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
  const scoreboard = parseMatchups(scoreboardPayload ?? payload, labels);
  const teams = mergeTeams(findResources(payload, 'team'), labels);
  const mergedTeams = mergeTeamValues([...teams, ...scoreboard.teams]);
  const week =
    asInteger(firstField(league, 'current_week', 'week')) ??
    scoreboard.week ??
    0;
  return {
    id: textField(league, 'league_key') ?? leagueId,
    provider: 'yahoo',
    name: textField(league, 'name') ?? leagueId,
    season: asInteger(firstField(league, 'season')) ?? season,
    week,
    fetchedAt: new Date().toISOString(),
    teams: mergedTeams,
    matchups: scoreboard.matchups,
  };
}

export const parseYahooLeague = parseYahooLeagueSnapshot;
export const parseLeagueSnapshot = parseYahooLeagueSnapshot;

export async function discoverYahooLeagues(
  accessToken: string,
): Promise<{ id: string; name: string; season: number }[]> {
  const payload = await jsonRequest(
    apiUrl('/users;use_login=1/games;game_codes=nfl/leagues'),
    bearer(accessToken),
  );
  return parseYahooLeagues(payload);
}

export async function fetchYahooLeague(
  accessToken: string,
  leagueId: string,
  season: number,
): Promise<LeagueSnapshot> {
  const key = leagueKey(leagueId);
  if (!Number.isInteger(season) || season < 2000 || season > 2100) {
    throw new AppError('Invalid Yahoo season', 400);
  }
  const metadata = await jsonRequest(apiUrl(`/league/${key}/settings`), bearer(accessToken));
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
      bearer(accessToken),
    ),
    jsonRequest(
      apiUrl(`/league/${key}/scoreboard;week=${week}`),
      bearer(accessToken),
    ),
  ]);
  const snapshot = parseYahooLeagueSnapshot({ metadata, roster }, key, season, scoreboard);
  if (!snapshot.teams.length) throw new AppError('Invalid Yahoo league response', 502);
  return snapshot;
}
