import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../lib/security';
import { ESPN_API_BASE, fetchEspnLeague, parseEspnLeague } from '../lib/espn';

const season = 2025;

function responseFixture(): any {
  return {
    id: 123,
    settings: { name: 'Sunday League' },
    status: { currentMatchupPeriod: 3, latestScoringPeriod: 5 },
    teams: [
      {
        id: 1,
        location: 'The',
        nickname: 'Stat Crew',
        roster: { entries: [{
          playerId: 101,
          lineupSlotId: 0,
          playerPoolEntry: { player: { id: 101, fullName: 'Quarterback One', defaultPositionId: 1 } },
        }] },
      },
      {
        id: 2,
        name: 'Fourth & Long',
        roster: { entries: [] },
      },
    ],
    schedule: [
      { matchupPeriodId: 2, home: { teamId: 1, totalPoints: 90 }, away: { teamId: 2, totalPoints: 80 } },
      {
        matchupPeriodId: 3,
        home: {
          teamId: 1,
          totalPoints: 118.4,
          rosterForCurrentScoringPeriod: {
            appliedStatTotal: 118.4,
            entries: [{
              playerId: 101,
              lineupSlotId: 0,
              playerPoolEntry: {
                appliedStatTotal: 25.5,
                player: {
                  id: 101,
                  fullName: 'Quarterback One',
                  defaultPositionId: 1,
                  stats: [{ seasonId: season, scoringPeriodId: 5, statSourceId: 0, stats: { '3': 300, '4': 2 } }],
                },
              },
            }],
          },
        },
        away: { teamId: 2, totalPoints: null, rosterForCurrentScoringPeriod: { entries: [] } },
      },
    ],
  };
}

test('parser maps current matchup, league points, roster points, and weekly stats', () => {
  const snapshot = parseEspnLeague(responseFixture(), '123', season);
  assert.equal(snapshot.id, '123');
  assert.equal(snapshot.name, 'Sunday League');
  assert.equal(snapshot.week, 3);
  assert.deepEqual(snapshot.matchups, [{ home: '1', away: '2' }]);
  assert.equal(snapshot.teams[0].points, 118.4);
  assert.equal(snapshot.teams[0].players[0].points, 25.5);
  assert.equal(snapshot.teams[0].players[0].position, 'QB');
  assert.equal(snapshot.teams[0].players[0].slot, 'QB');
  assert.deepEqual(snapshot.teams[0].players[0].stats, { 'Passing yards': 300, 'Passing touchdowns': 2 });
  assert.equal(snapshot.teams[1].points, null);
});

test('parser does not inherit a base roster total over a scoped weekly total', () => {
  const value = responseFixture();
  const base = value.teams[0].roster.entries[0].playerPoolEntry;
  base.appliedStatTotal = 999;
  const current = value.schedule[1].home.rosterForCurrentScoringPeriod.entries[0].playerPoolEntry;
  delete current.appliedStatTotal;
  current.player.stats[0].appliedStatTotal = 17.25;
  const snapshot = parseEspnLeague(value, '123', season);
  assert.equal(snapshot.teams[0].players[0].points, 17.25);
});

test('parser leaves unknown current values null and does not use wrong week or season totals', () => {
  const value = responseFixture();
  value.teams[0].roster.entries[0].playerPoolEntry.appliedStatTotal = 999;
  value.teams[0].record = { overall: { pointsFor: 999 } };
  value.teams[0].roster.appliedStatTotal = 999;
  value.schedule[1].home.totalPoints = undefined;
  value.schedule[1].home.rosterForCurrentScoringPeriod = {
    entries: [{
      playerId: 101,
      lineupSlotId: 0,
      playerPoolEntry: {
        player: {
          id: 101,
          fullName: 'Quarterback One',
          defaultPositionId: 1,
          stats: [
            { seasonId: season, scoringPeriodId: 4, statSourceId: 0, stats: { '3': 200 } },
            { seasonId: season - 1, scoringPeriodId: 5, statSourceId: 0, stats: { '3': 400 } },
          ],
        },
      },
    }],
  };
  const snapshot = parseEspnLeague(value, '123', season);
  assert.equal(snapshot.teams[0].points, null);
  assert.equal(snapshot.teams[0].players[0].points, null);
  assert.deepEqual(snapshot.teams[0].players[0].stats, {});
});

test('fetch uses only the fixed ESPN read API, scoped scoreboard views, and safe cookies', async () => {
  const originalFetch = globalThis.fetch;
  const calls: { url: string; init?: RequestInit }[] = [];
  const metadata = responseFixture();
  const scoreboard = { scoringPeriodId: 5, schedule: metadata.schedule };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify(calls.length === 1 ? metadata : scoreboard), { status: 200 });
  }) as typeof fetch;
  try {
    const snapshot = await fetchEspnLeague({ espn_s2: 's2-token', SWID: '{user-id}' }, '123', season);
    assert.equal(snapshot.teams[0].players[0].points, 25.5);
    assert.equal(calls.length, 2);
    const first = new URL(calls[0].url);
    const second = new URL(calls[1].url);
    assert.equal(first.origin, ESPN_API_BASE);
    assert.equal(second.origin, ESPN_API_BASE);
    assert.equal(first.pathname, '/apis/v3/games/ffl/seasons/2025/segments/0/leagues/123');
    assert.deepEqual(first.searchParams.getAll('view'), ['mSettings', 'mTeam', 'mRoster', 'mStatus']);
    assert.deepEqual(second.searchParams.getAll('view'), ['mMatchupScore', 'mScoreboard']);
    assert.equal(second.searchParams.get('scoringPeriodId'), '5');
    assert.equal(calls[0].init?.cache, 'no-store');
    assert.equal(calls[0].init?.redirect, 'error');
    assert.equal((calls[0].init?.headers as Record<string, string>).Cookie, 'espn_s2=s2-token; SWID={user-id}');
    assert.deepEqual(JSON.parse((calls[1].init?.headers as Record<string, string>)['X-Fantasy-Filter']), {
      schedule: { filterMatchupPeriodIds: { value: [3] } },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetch rejects cookie header injection before making a request', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls += 1; return new Response('{}'); }) as typeof fetch;
  try {
    await assert.rejects(
      fetchEspnLeague({ espn_s2: 'bad\r\nX-Leak: yes', SWID: 'ok' }, '123', season),
      (error: unknown) => error instanceof AppError && error.status === 400,
    );
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetch exposes auth and retry-after as safe typed errors', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: RequestInfo | URL) => new Response(null, {
    status: 429,
    headers: { 'Retry-After': '7' },
  })) as typeof fetch;
  try {
    await assert.rejects(
      fetchEspnLeague({ espn_s2: 's2-token', SWID: 'swid' }, '123', season),
      (error: unknown) => error instanceof AppError && error.status === 429 && error.retryAfter === 7,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('parser rejects an absent league response', () => {
  assert.throws(
    () => parseEspnLeague({}, '123', season),
    (error: unknown) => error instanceof AppError && error.status === 502,
  );
});
