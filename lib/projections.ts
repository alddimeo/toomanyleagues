import type { LeagueSnapshot, Player, Team } from './types';

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
