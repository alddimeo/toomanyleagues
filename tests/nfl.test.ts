import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchNflScoreboard, nflTeamLogoUrl, normalizeNflTeam, parseNflPlays, parseNflScoreboard } from '../lib/nfl';
import { startersInGame, startersMentioned } from '../lib/nfl-highlights';
import type { LeagueSnapshot } from '../lib/types';

test('normalizes provider abbreviations and team names', () => {
  assert.equal(normalizeNflTeam('JAC'), 'JAX');
  assert.equal(normalizeNflTeam('Los Angeles Chargers'), 'LAC');
  assert.equal(normalizeNflTeam('Kansas City Chiefs'), 'KC');
  assert.equal(normalizeNflTeam('Washington Commanders'), 'WSH');
  assert.equal(normalizeNflTeam('Washington Football Team'), 'WSH');
  assert.equal(normalizeNflTeam('Unknown Team'), null);
});

test('uses shared NFL logo URLs for normalized provider team names', () => {
  assert.equal(nflTeamLogoUrl('JAC'), '/nfl/JAX.png');
  assert.equal(nflTeamLogoUrl('Washington Commanders'), '/nfl/WSH.png');
  assert.equal(nflTeamLogoUrl('Unknown Team'), undefined);
});

test('parses scheduled, live, and final scoreboard states', () => {
  const game = (id: string, state: string, period: number, clock: string, score: string) => ({
    id,
    date: '2026-09-20T17:00:00Z',
    competitions: [{
      competitors: [
        { homeAway: 'away', score, team: { abbreviation: 'JAC', displayName: 'Jacksonville Jaguars' } },
        { homeAway: 'home', score: '10', team: { displayName: 'Kansas City Chiefs' } },
      ],
      status: { type: { state, completed: state === 'post' }, period, displayClock: clock },
    }],
  });
  const games = parseNflScoreboard({ events: [game('scheduled', 'pre', 0, '0:00', '0'), game('live', 'in', 3, '8:24', '7'), game('final', 'post', 4, '0:00', '17')] });
  assert.deepEqual(games.map(({ state }) => state), ['scheduled', 'live', 'final']);
  assert.equal(games[0].awayTeam, 'JAX');
  assert.equal(games[0].awayName, 'Jacksonville Jaguars');
  assert.equal(games[0].homeName, 'Kansas City Chiefs');
  assert.equal(games[1].period, 3);
  assert.equal(games[1].awayScore, 7);
  assert.equal(games[2].homeScore, 10);
});

test('requests the saved season and maps fantasy playoff weeks to the NFL postseason', async () => {
  const originalFetch = globalThis.fetch;
  const requested: URL[] = [];
  globalThis.fetch = async (input) => {
    requested.push(new URL(String(input)));
    return Response.json({ events: [] });
  };
  try {
    await fetchNflScoreboard(2020, 20);
    assert.equal(requested[0]?.hostname, 'site.web.api.espn.com');
    assert.equal(requested[0]?.searchParams.get('dates'), '2020');
    assert.equal(requested[0]?.searchParams.get('week'), '2');
    assert.equal(requested[0]?.searchParams.get('seasontype'), '3');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('shows recent plays and identifies starters on each side of a fantasy matchup', () => {
  const game = parseNflScoreboard({ events: [{ id: '401772510', competitions: [{ competitors: [
    { homeAway: 'away', team: { abbreviation: 'DAL' } },
    { homeAway: 'home', team: { abbreviation: 'PHI' } },
  ] }] }] })[0];
  const player = (name: string, nflTeam: string, slot = 'QB') => ({ id: name, name, nflTeam, slot, position: slot, points: 0, stats: {} });
  const leagues: LeagueSnapshot[] = [{ id: '1', provider: 'espn', name: 'League', season: 2026, week: 3, fetchedAt: '', matchups: [{ home: 'me', away: 'them' }], teams: [
    { id: 'me', name: 'Me', isUserTeam: true, points: 0, players: [player('Dak Prescott', 'DAL'), player('Bench Player', 'PHI', 'BE')] },
    { id: 'them', name: 'Them', points: 0, players: [player('Jalen Hurts', 'PHI')] },
  ] }];
  const starters = startersInGame(leagues, game);
  assert.deepEqual(starters.map(({ name, side }) => [name, side]), [['Dak Prescott', 'you'], ['Jalen Hurts', 'opponent']]);
  const reversed = { ...leagues[0], id: '2', teams: leagues[0].teams.map((team) => ({ ...team, isUserTeam: team.id === 'them' })) };
  assert.deepEqual(startersInGame([...leagues, reversed], game).map(({ side }) => side), ['both', 'both']);
  const plays = parseNflPlays({ drives: { previous: [{ plays: [
    { id: '1', text: 'J.Hurts pass to A.Brown', wallclock: '2026-09-20T17:01:00Z', period: { number: 1 }, clock: { displayValue: '14:20' } },
    { id: '2', text: 'D.Prescott pass to C.Lamb', wallclock: '2026-09-20T17:02:00Z', period: { number: 1 }, clock: { displayValue: '13:10' } },
  ] }] } });
  assert.equal(plays[0].id, '2');
  assert.equal(plays[0].clock, '13:10');
  assert.equal(plays[0].timestamp, '2026-09-20T17:02:00Z');
  assert.deepEqual(startersMentioned(plays[0].text, starters).map(({ side }) => side), ['you']);
  assert.deepEqual(startersMentioned(plays[1].text, starters).map(({ side }) => side), ['opponent']);
  const inline = 'J.Hurts pass to D. Prescott. J.Hurts scrambles.';
  assert.deepEqual(startersMentioned(inline, starters).map(({ side, start, end }) => [side, inline.slice(start, end)]), [
    ['opponent', 'J.Hurts'], ['you', 'D. Prescott'], ['opponent', 'J.Hurts'],
  ]);
});
