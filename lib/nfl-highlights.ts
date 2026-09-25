import type { LeagueSnapshot } from './types';
import { isBench } from './projections';
import { normalizeNflTeam, type NflGame } from './nfl';

export type HighlightedStarter = { name: string; nflTeam: string; side: 'you' | 'opponent' | 'both' };

export function startersInGame(leagues: LeagueSnapshot[], game: NflGame): HighlightedStarter[] {
  const found = new Map<string, HighlightedStarter>();
  const add = (team: LeagueSnapshot['teams'][number] | undefined, side: 'you' | 'opponent') => {
    for (const player of team?.players ?? []) {
      const nflTeam = normalizeNflTeam(player.nflTeam);
      if (isBench(player) || !nflTeam || (nflTeam !== game.homeTeam && nflTeam !== game.awayTeam)) continue;
      const key = `${player.name.toLowerCase()}:${nflTeam}`;
      const existing = found.get(key);
      found.set(key, { name: player.name, nflTeam, side: existing && existing.side !== side ? 'both' : side });
    }
  };
  for (const league of leagues) {
    for (const team of league.teams.filter((item) => item.isUserTeam)) {
      add(team, 'you');
      const matchup = league.matchups.find((item) => item.home === team.id || item.away === team.id);
      const opponentId = matchup?.home === team.id ? matchup.away : matchup?.home;
      add(league.teams.find((item) => item.id === opponentId), 'opponent');
    }
  }
  return [...found.values()];
}

export function startersMentioned(text: string, starters: HighlightedStarter[]): (HighlightedStarter & { start: number; end: number })[] {
  const matches: (HighlightedStarter & { start: number; end: number })[] = [];
  for (const player of starters) {
    const parts = player.name.trim().split(/\s+/);
    const surname = parts.at(-1)?.replace(/[^A-Za-z'-]/g, '');
    const initial = parts[0]?.[0];
    if (!surname || !initial || surname.length < 3) continue;
    const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(?<![A-Za-z])(?:${escape(player.name)}|${escape(initial)}\\.\\s*${escape(surname)})(?![A-Za-z])`, 'gi');
    for (const match of text.matchAll(pattern)) matches.push({ ...player, start: match.index, end: match.index + match[0].length });
  }
  matches.sort((a, b) => a.start - b.start || b.end - a.end);
  let end = 0;
  return matches.filter((match) => {
    if (match.start < end) return false;
    end = match.end;
    return true;
  });
}
