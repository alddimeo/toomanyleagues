import type { LeagueSnapshot, Player, Team } from './types';
import { normalizeNflTeam, type NflGame } from './nfl';

export function isBench(player: Player): boolean {
  return /^(BE|BN|BENCH|IR)$/i.test(player.slot.trim());
}

export function starterProjection(players: Player[]): number | undefined {
  const starters = players.filter((player) => !isBench(player));
  return starters.length && starters.every((player) => typeof player.projection === 'number' && Number.isFinite(player.projection))
    ? starters.reduce((total, player) => total + player.projection!, 0)
    : undefined;
}

export function carryPregame(fresh: LeagueSnapshot, old?: LeagueSnapshot, beforeKickoff = false): LeagueSnapshot {
  if (old?.week === fresh.week && old.season === fresh.season) {
    if (old.pregameClosed) return { ...fresh, pregameClosed: true };
    if (old.pregameCapturedAt && !beforeKickoff) {
      const prior = new Map(old.teams.map((team) => [team.id, team]));
      return { ...fresh, pregameCapturedAt: old.pregameCapturedAt, teams: fresh.teams.map((team) => {
        const saved = prior.get(team.id);
        const players = new Map(saved?.players.map((player) => [player.id, player]));
        return { ...team, pregameProjection: saved?.pregameProjection, players: team.players.map((player) => ({
          ...player, pregameProjection: players.get(player.id)?.pregameProjection,
        })) };
      }) };
    }
  }
  if (!beforeKickoff) return { ...fresh, pregameClosed: true };
  const teams = fresh.teams.map((team) => ({ ...team, pregameProjection: team.projection,
    players: team.players.map((player) => ({ ...player, pregameProjection: player.projection })) }));
  return teams.some((team) => team.pregameProjection !== undefined || team.players.some((player) => player.pregameProjection !== undefined))
    ? { ...fresh, pregameCapturedAt: fresh.fetchedAt, teams }
    : fresh;
}

export function withTeamProjection(team: Team): Team {
  return { ...team, projection: team.projection ?? starterProjection(team.players) };
}

function gameTimeRemaining(game: NflGame): number {
  if (game.state === 'scheduled') return 1;
  if (game.state === 'final') return 0;
  const period = game.period;
  const clock = game.clock?.match(/^(\d{1,2}):(\d{2})$/);
  if (!period || !clock) return 1;
  const seconds = Number(clock[1]) * 60 + Number(clock[2]);
  return (seconds + 900 * (4 - Math.min(period, 4))) / (3600 + 60 * Math.max(period - 4, 0));
}

export function applyYahooProviderProjections(snapshot: LeagueSnapshot, games: NflGame[]): LeagueSnapshot {
  if (snapshot.provider !== 'yahoo') return snapshot;
  return { ...snapshot, teams: snapshot.teams.map((team) => {
    const original = team.projection;
    const players = team.players.map((player) => {
      const baseline = player.projection;
      const nflTeam = normalizeNflTeam(player.nflTeam);
      const game = nflTeam && games.find((item) => item.homeTeam === nflTeam || item.awayTeam === nflTeam);
      if (baseline === undefined) return player;
      const remaining = game ? gameTimeRemaining(game) : 1;
      const defenseStart = /^(?:DEF|DST|D\/ST)$/i.test(player.position) && (remaining < 1 || (player.points ?? 0) !== 0)
        ? snapshot.yahooDefenseInitialPoints ?? 0
        : 0;
      const projection = game
        ? (player.points ?? 0) + (baseline - defenseStart) * remaining
        : baseline;
      return { ...player, projection, pregameProjection: baseline };
    });
    return { ...team, players, projection: starterProjection(players) ?? original, pregameProjection: original };
  }) };
}

export function applyEspnProviderProjections(snapshot: LeagueSnapshot, games: NflGame[]): LeagueSnapshot {
  if (snapshot.provider !== 'espn') return snapshot;
  return { ...snapshot, teams: snapshot.teams.map((team) => {
    const original = starterProjection(team.players) ?? team.projection;
    const players = team.players.map((player) => {
      const baseline = player.projection;
      const nflTeam = normalizeNflTeam(player.nflTeam);
      const game = nflTeam && games.find((item) => item.homeTeam === nflTeam || item.awayTeam === nflTeam);
      if (baseline === undefined) return player;
      const remaining = game ? gameTimeRemaining(game) : 1;
      const points = player.points ?? 0;
      const projection = !game ? baseline
        : player.injuryStatus === 'OUT' ? points
        : /^(?:DEF|DST|D\/ST)$/i.test(player.position) ? points * (1 - remaining) + baseline * remaining
        : points + baseline * remaining;
      return { ...player, projection, pregameProjection: baseline };
    });
    return { ...team, players, projection: starterProjection(players) ?? original, pregameProjection: original };
  }) };
}

export function projectionPresentation(value?: number, baseline?: number, state?: NflGame['state'] | 'bye') {
  const current = typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  const original = typeof baseline === 'number' && Number.isFinite(baseline) ? baseline : current;
  const visible = state === 'live' ? current ?? original : original;
  const change = state === 'live' && current !== undefined && baseline !== undefined
    ? Math.round((current - baseline) * 100) : 0;
  return { value: visible, direction: Math.sign(change) };
}

export function teamProjectionState(team: Team, games: NflGame[]): NflGame['state'] | undefined {
  const states = team.players.filter((player) => !isBench(player)).flatMap((player) => {
    const nflTeam = normalizeNflTeam(player.nflTeam);
    const game = nflTeam && games.find((item) => item.homeTeam === nflTeam || item.awayTeam === nflTeam);
    return game ? [game.state] : [];
  });
  if (!states.length) return undefined;
  if (states.every((state) => state === 'scheduled')) return 'scheduled';
  if (states.every((state) => state === 'final')) return 'final';
  return 'live';
}

export function holdUpcomingYahooProjections(snapshot: LeagueSnapshot, games: NflGame[], now = Date.now()): LeagueSnapshot {
  if (snapshot.provider !== 'yahoo') return snapshot;
  const upcoming = new Set(games.filter((game) => game.state === 'scheduled' && game.date && Date.parse(game.date) > now)
    .flatMap((game) => [game.homeTeam, game.awayTeam]));
  return { ...snapshot, teams: snapshot.teams.map((team) => ({ ...team, players: team.players.map((player) => ({
    ...player, projectionHeld: player.pregameProjection !== undefined && upcoming.has(normalizeNflTeam(player.nflTeam) || ''),
  })) })) };
}
