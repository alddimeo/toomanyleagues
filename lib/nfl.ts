export type NflGame = {
  id: string;
  homeTeam: string;
  awayTeam: string;
  homeName: string;
  awayName: string;
  homeScore: number | null;
  awayScore: number | null;
  date: string | null;
  state: 'scheduled' | 'live' | 'final';
  period: number | null;
  clock: string | null;
};

export type NflPlay = { id: string; text: string; timestamp: string | null; period: number | null; clock: string | null };

const TEAM_NAMES: Record<string, string> = {
  ARI: 'CARDINALS', ATL: 'FALCONS', BAL: 'RAVENS', BUF: 'BILLS', CAR: 'PANTHERS',
  CHI: 'BEARS', CIN: 'BENGALS', CLE: 'BROWNS', DAL: 'COWBOYS', DEN: 'BRONCOS',
  DET: 'LIONS', GB: 'PACKERS', HOU: 'TEXANS', IND: 'COLTS', JAX: 'JAGUARS',
  KC: 'CHIEFS', LAC: 'CHARGERS', LAR: 'RAMS', LV: 'RAIDERS', MIA: 'DOLPHINS',
  MIN: 'VIKINGS', NE: 'PATRIOTS', NO: 'SAINTS', NYG: 'GIANTS', NYJ: 'JETS',
  PHI: 'EAGLES', PIT: 'STEELERS', SF: '49ERS', SEA: 'SEAHAWKS', TB: 'BUCCANEERS',
  TEN: 'TITANS', WSH: 'COMMANDERS',
};

const TEAM_ALIASES: Record<string, string> = {
  JAC: 'JAX', SD: 'LAC', OAK: 'LV', STL: 'LAR', WAS: 'WSH', WFT: 'WSH',
  WASHINGTONFOOTBALLTEAM: 'WSH', WASHINGTONREDSKINS: 'WSH',
};

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numeric(value: unknown): number | null {
  const result = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(result) ? result : null;
}

export function normalizeNflTeam(value: string | undefined): string | null {
  if (!value) return null;
  const key = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const abbreviation = TEAM_ALIASES[key] || key;
  if (TEAM_NAMES[abbreviation]) return abbreviation;
  return Object.entries(TEAM_NAMES).find(([, name]) => key.endsWith(name))?.[0] ?? null;
}

export function nflTeamLogoUrl(value: string | undefined): string | undefined {
  const team = normalizeNflTeam(value);
  return team ? `/nfl/${team}.png` : undefined;
}

export function parseNflScoreboard(value: unknown): NflGame[] {
  const events = array(object(value)?.events);
  return events.flatMap((entry): NflGame[] => {
    const event = object(entry);
    const competition = object(array(event?.competitions)[0]);
    const competitors = array(competition?.competitors).map(object).filter((team): team is Record<string, unknown> => !!team);
    const home = competitors.find((team) => team.homeAway === 'home');
    const away = competitors.find((team) => team.homeAway === 'away');
    const teamName = (team: Record<string, unknown> | undefined) => {
      const data = object(team?.team);
      return normalizeNflTeam(text(data?.abbreviation) || text(data?.displayName) || '');
    };
    const homeTeam = teamName(home);
    const awayTeam = teamName(away);
    if (!event || !competition || !homeTeam || !awayTeam || !text(event.id)) return [];

    const status = object(competition.status) || object(event.status);
    const type = object(status?.type);
    const state = text(type?.state);
    const period = numeric(status?.period);
    const date = text(event.date) || text(competition.date);
    return [{
      id: text(event.id)!,
      homeTeam,
      awayTeam,
      homeName: text(object(home?.team)?.displayName) || homeTeam,
      awayName: text(object(away?.team)?.displayName) || awayTeam,
      homeScore: numeric(home?.score),
      awayScore: numeric(away?.score),
      date: date && Number.isFinite(Date.parse(date)) ? date : null,
      state: state === 'in' ? 'live' : state === 'post' || type?.completed === true ? 'final' : 'scheduled',
      period: period === null ? null : Math.trunc(period),
      clock: text(status?.displayClock),
    }];
  });
}

export async function fetchNflScoreboard(season?: number, week?: number): Promise<NflGame[]> {
  if (season !== undefined || week !== undefined) {
    if (!Number.isInteger(season) || season! < 2018 || season! > new Date().getFullYear() + 1) throw new Error('Invalid NFL season.');
    if (!Number.isInteger(week) || week! < 1 || week! > 22) throw new Error('Invalid NFL week.');
  }
  const url = new URL('https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard');
  if (season !== undefined && week !== undefined) {
    const postseason = week > 18;
    url.searchParams.set('dates', String(season));
    url.searchParams.set('week', String(postseason ? week - 18 : week));
    url.searchParams.set('seasontype', postseason ? '3' : '2');
  }

  let response: Response;
  try {
    response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new Error('NFL scores are unavailable.');
  }
  if (!response.ok) throw new Error('NFL scores are unavailable.');
  const length = Number(response.headers.get('Content-Length'));
  if (Number.isFinite(length) && length > 2_000_000) throw new Error('Invalid NFL scoreboard response.');
  try {
    return parseNflScoreboard(await response.json());
  } catch {
    throw new Error('Invalid NFL scoreboard response.');
  }
}

export function parseNflPlays(value: unknown): NflPlay[] {
  const drives = object(object(value)?.drives);
  const all = [...array(drives?.previous), ...(drives?.current ? [drives.current] : [])];
  return all.flatMap((drive) => array(object(drive)?.plays)).slice(-12).flatMap((entry): NflPlay[] => {
    const play = object(entry);
    const description = text(play?.text);
    if (!play || !description) return [];
    const timestamp = text(play.wallclock);
    const period = numeric(object(play.period)?.number);
    return [{
      id: text(play.id) || `${text(play.sequenceNumber) || 'play'}-${period || 0}`,
      text: description.slice(0, 500),
      timestamp: timestamp && Number.isFinite(Date.parse(timestamp)) ? timestamp : null,
      period: period === null ? null : Math.trunc(period),
      clock: text(object(play.clock)?.displayValue),
    }];
  }).reverse();
}
