import assert from 'node:assert/strict';
import test from 'node:test';
import { carryPregame, holdUpcomingYahooProjections, starterProjection } from '../lib/projections';
import type { LeagueSnapshot, Player } from '../lib/types';

const player = (id: string, projection?: number, slot = 'QB'): Player => ({ id, name: id, position: 'QB', slot, points: 0, stats: {}, ...(projection === undefined ? {} : { projection }) });
const league = (week: number, projections: (number | undefined)[]): LeagueSnapshot => ({
  id: '1', provider: 'espn', name: 'League', season: 2026, week, fetchedAt: '2026-09-01T00:00:00Z', matchups: [],
  teams: [{ id: '1', name: 'Team', points: 0, projection: projections.every((value) => value !== undefined) ? projections.reduce<number>((sum, value) => sum + value!, 0) : undefined,
    players: projections.map((value, index) => player(String(index), value)) }],
});

test('team projection uses every starter and excludes bench', () => {
  assert.equal(starterProjection([player('a', 10), player('b', 8), player('c', 50, 'BE')]), 18);
  assert.equal(starterProjection([player('a', 10), player('b')]), undefined);
});

test('pregame values stay fixed, disappear for late imports, and reset in a new week', () => {
  const pregame = carryPregame(league(1, [10, 8]), undefined, true);
  assert.equal(pregame.teams[0].pregameProjection, 18);
  const adjustedPregame = carryPregame(league(1, [11, 9]), pregame, true);
  assert.equal(adjustedPregame.teams[0].pregameProjection, 20);
  assert.deepEqual(adjustedPregame.teams[0].players.map((item) => item.pregameProjection), [11, 9]);
  const live = carryPregame(league(1, [14, 6]), adjustedPregame);
  assert.equal(live.teams[0].pregameProjection, 20);
  assert.deepEqual(live.teams[0].players.map((item) => item.pregameProjection), [11, 9]);
  const late = carryPregame(league(1, [14, 6]));
  assert.equal(late.pregameClosed, true);
  assert.equal(carryPregame(league(1, [16, 7]), late, true).teams[0].pregameProjection, undefined);
  assert.equal(carryPregame(league(2, [12, 9]), pregame, true).teams[0].pregameProjection, 21);
});

test('Yahoo holds player projections until their own games start', () => {
  const snapshot = carryPregame(league(1, [10, 8]), undefined, true);
  snapshot.provider = 'yahoo';
  snapshot.teams[0].players[0].nflTeam = 'KC';
  snapshot.teams[0].players[1].nflTeam = 'BUF';
  const live = carryPregame(league(1, [12, 6]), snapshot);
  live.provider = 'yahoo';
  live.teams[0].players[0].nflTeam = 'KC';
  live.teams[0].players[1].nflTeam = 'BUF';
  const games = [
    { id: '1', homeTeam: 'KC', awayTeam: 'DAL', homeName: 'KC', awayName: 'DAL', homeScore: 0, awayScore: 0, date: '2026-09-02T00:00:00Z', state: 'scheduled' as const, period: null, clock: null },
    { id: '2', homeTeam: 'BUF', awayTeam: 'MIA', homeName: 'BUF', awayName: 'MIA', homeScore: 0, awayScore: 0, date: '2026-09-01T00:00:00Z', state: 'live' as const, period: 1, clock: null },
  ];
  const held = holdUpcomingYahooProjections(live, games, Date.parse('2026-09-01T12:00:00Z'));
  assert.deepEqual(held.teams[0].players.map((item) => item.projectionHeld), [true, false]);
  assert.deepEqual(held.teams[0].players.map((item) => item.projection), [12, 6]);
  assert.deepEqual(holdUpcomingYahooProjections({ ...live, provider: 'espn' }, games).teams[0].players.map((item) => item.projectionHeld), [undefined, undefined]);
});
