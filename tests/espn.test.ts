import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../lib/security';
import { ESPN_API_BASE, ESPN_FAN_API_BASE, discoverEspnLeagues, espnTeamLogoId, espnTeamLogoProxyPath, fetchEspnLeague, fetchEspnTeamLogo, parseEspnLeague, parseEspnProfile } from '../lib/espn';

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
        logo: 'https://cdn.example/team.png',
        owners: ['owner-id'],
        roster: { entries: [{
          playerId: 101,
          lineupSlotId: 0,
          playerPoolEntry: { player: { id: 101, fullName: 'Quarterback One', defaultPositionId: 1, imageUrl: 'https://cdn.example/qb.png', proTeamId: 12 } },
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
  assert.equal(snapshot.teams[0].logo, 'https://cdn.example/team.png');
  assert.equal(snapshot.teams[0].players[0].headshot, 'https://cdn.example/qb.png');
  assert.equal(snapshot.teams[0].players[0].nflTeam, 'KC');
  assert.equal(snapshot.teams[0].players[0].nflTeamLogo, 'https://a.espncdn.com/i/teamlogos/nfl/500/12.png');
  assert.equal(snapshot.teams[0].players[0].points, 25.5);
  assert.equal(snapshot.teams[0].players[0].position, 'QB');
  assert.equal(snapshot.teams[0].players[0].slot, 'QB');
  assert.deepEqual(snapshot.teams[0].players[0].stats, { 'Passing yards': 300, 'Passing touchdowns': 2 });
  assert.equal(snapshot.teams[1].points, null);
});

test('parser reads current ESPN projected points and matchup win chance', () => {
  const value = responseFixture();
  value.teams[0].roster.entries[0].playerPoolEntry.player.stats = [
    { seasonId: season, scoringPeriodId: 5, statSourceId: 1, appliedStatTotal: 29.5 },
    { seasonId: season, scoringPeriodId: 4, statSourceId: 1, appliedStatTotal: 99 },
  ];
  value.schedule[1].home.winProbability = 0.64;
  const snapshot = parseEspnLeague(value, '123', season);
  assert.equal(snapshot.teams[0].players[0].projection, 29.5);
  assert.equal(snapshot.teams[0].projection, 29.5);
  assert.equal(snapshot.matchups[0].homeWinProbability, 64);
});

test('ESPN uses its weekly player and matchup team projections', () => {
  const value = responseFixture();
  value.teams[0].roster.entries[0].playerPoolEntry.projectedPoints = 10.27;
  value.teams[0].roster.entries[0].playerPoolEntry.player.stats = [
    { seasonId: season, scoringPeriodId: 5, statSourceId: 1, statTypeId: 1, appliedStatTotal: 200 },
    { seasonId: season, scoringPeriodId: 5, statSourceId: 1, statTypeId: 0, appliedStatTotal: 7.19 },
  ];
  value.schedule[1].home.totalProjectedPoints = 113.6;
  const snapshot = parseEspnLeague(value, '123', season);
  assert.equal(snapshot.teams[0].players[0].projection, 7.19);
  assert.equal(snapshot.teams[0].projection, 113.6);
});

test('parser maps league and nested ESPN team logos', () => {
  const value = responseFixture();
  value.settings.logoUrl = 'https://cdn.example/league.png';
  value.teams[0].logo = undefined;
  value.teams[0].logos = [{ custom: { src: 'https://cdn.example/nested-team.png' } }];
  const snapshot = parseEspnLeague(value, '123', season);
  assert.equal(snapshot.logo, 'https://cdn.example/league.png');
  assert.equal(snapshot.teams[0].logo, 'https://cdn.example/nested-team.png');
});

test('parser normalizes protocol-relative ESPN Fantasy team logos', () => {
  const value = responseFixture();
  value.teams[0].logo = '//g.espncdn.com/lm-static/ffl/images/default_logos/1.svg';
  value.teams[1].logos = [{ href: '//g.espncdn.com/lm-static/ffl/images/default_logos/2.svg' }];
  const snapshot = parseEspnLeague(value, '123', season);
  assert.equal(snapshot.teams[0].logo, 'https://g.espncdn.com/lm-static/ffl/images/default_logos/1.svg');
  assert.equal(snapshot.teams[1].logo, 'https://g.espncdn.com/lm-static/ffl/images/default_logos/2.svg');
});

test('ESPN logo proxy mapping produces a same-origin relative route', () => {
  const id = 'a1234567-b123-c123-d123-e123456789ab';
  const source = `https://mystique-api.fantasy.espn.com/apis/v1/domains/lm/images/${id}`;
  const previousAppUrl = process.env.APP_URL;
  process.env.APP_URL = 'https://app.example';
  try {
    assert.equal(espnTeamLogoId(source), id);
    assert.equal(espnTeamLogoId(`/api/espn/team-logo/${id}`), id);
    assert.equal(espnTeamLogoId(`https://app.example/api/espn/team-logo/${id}`), id);
    assert.equal(espnTeamLogoProxyPath(source), `/api/espn/team-logo/${id}`);
    const saved = responseFixture();
    saved.teams[0].logo = source;
    const snapshot = parseEspnLeague(saved, '123', season);
    assert.equal(espnTeamLogoProxyPath(snapshot.teams[0].logo), `/api/espn/team-logo/${id}`);
    assert.equal(snapshot.teams[0].logo, source);
    assert.equal(espnTeamLogoId(source.replace('https://', 'http://')), undefined);
    assert.equal(espnTeamLogoId(source.replace('mystique-api.fantasy.espn.com', 'images.example.com')), undefined);
    assert.equal(espnTeamLogoId(`${source}?next=https://other.example`), undefined);
    assert.equal(espnTeamLogoId(`https://other.example/api/espn/team-logo/${id}`), undefined);
  } finally {
    if (previousAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = previousAppUrl;
  }
});

test('ESPN logo fetch is fixed-host, authenticated, and validates image responses', async () => {
  const originalFetch = globalThis.fetch;
  const id = 'a1234567-b123-c123-d123-e123456789ab';
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0x00]);
  let url = '';
  let init: RequestInit | undefined;
  let calls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, requestInit?: RequestInit) => {
    calls += 1;
    url = String(input);
    init = requestInit;
    return new Response(jpeg, { headers: { 'Content-Type': 'image/jpg' } });
  }) as typeof fetch;
  try {
    const image = await fetchEspnTeamLogo({ espn_s2: 's2-token', SWID: '{user-id}' }, id);
    assert.deepEqual([...image.bytes], [...jpeg]);
    assert.equal(image.contentType, 'image/jpeg');
    assert.equal(new URL(url).origin, 'https://mystique-api.fantasy.espn.com');
    assert.equal(new URL(url).pathname, `/apis/v1/domains/lm/images/${id}`);
    assert.equal((init?.headers as Record<string, string>).Cookie, 'espn_s2=s2-token; SWID={user-id}');
    assert.equal(init?.redirect, 'manual');
    assert.equal(init?.cache, 'no-store');

    globalThis.fetch = (async () => new Response('not an image', { headers: { 'Content-Type': 'image/jpeg' } })) as typeof fetch;
    await assert.rejects(fetchEspnTeamLogo({ espn_s2: 's2-token', SWID: '{user-id}' }, id),
      (error: unknown) => error instanceof AppError && error.status === 502);

    globalThis.fetch = (async () => new Response(jpeg, {
      headers: { 'Content-Type': 'image/jpeg', 'Content-Length': String(2 * 1024 * 1024 + 1) },
    })) as typeof fetch;
    await assert.rejects(fetchEspnTeamLogo({ espn_s2: 's2-token', SWID: '{user-id}' }, id),
      (error: unknown) => error instanceof AppError && error.status === 502);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(calls, 1);
});

test('parser keeps opponent live points and weekly player stats', () => {
  const value = responseFixture();
  value.schedule[1].away.totalPointsLive = 77.25;
  value.schedule[1].away.rosterForCurrentScoringPeriod.entries = [{
    playerId: 202,
    lineupSlotId: 2,
    playerPoolEntry: {
      appliedStatTotal: 12.5,
      player: {
        id: 202,
        fullName: 'Running Back Two',
        defaultPositionId: 2,
        stats: [{ seasonId: season, scoringPeriodId: 5, statSourceId: 0, stats: { '24': 50 } }],
      },
    },
  }];
  const opponent = parseEspnLeague(value, '123', season).teams[1];
  assert.equal(opponent.points, 77.25);
  assert.equal(opponent.players[0].points, 12.5);
  assert.deepEqual(opponent.players[0].stats, { 'Rushing yards': 50 });
});

test('parser prefers ESPN live matchup points when totalPoints is still zero', () => {
  const value = responseFixture();
  value.schedule[1].home.totalPoints = 0;
  value.schedule[1].home.totalPointsLive = 86.8;
  const snapshot = parseEspnLeague(value, '123', season);
  assert.equal(snapshot.teams[0].points, 86.8);
});

test('parser marks the ESPN team owned by the authenticated account', () => {
  const snapshot = parseEspnLeague(responseFixture(), '123', season, '{OWNER-ID}');
  assert.equal(snapshot.teams[0].isUserTeam, true);
  assert.equal(snapshot.teams[1].isUserTeam, undefined);
});

test('parser derives a D/ST logo from the team name when ESPN omits proTeamId', () => {
  const value = responseFixture();
  value.teams[0].roster.entries.push({
    playerId: 202,
    lineupSlotId: 16,
    playerPoolEntry: { player: { id: 202, fullName: 'Texans D/ST', defaultPositionId: 16 } },
  });
  const defense = parseEspnLeague(value, '123', season).teams[0].players[1];
  assert.equal(defense.nflTeam, 'HOU');
  assert.equal(defense.nflTeamLogo, 'https://a.espncdn.com/i/teamlogos/nfl/500/34.png');
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
    assert.equal(calls[0].init?.redirect, 'manual');
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

test('profile parser finds football leagues in nested account data and ignores other sports', () => {
  assert.deepEqual(parseEspnProfile({
    sports: [
      { sport: 'football', leagues: [
        { leagueId: '123', leagueName: 'Sunday League', seasonId: 2025 },
        { id: '456', name: 'Keeper League', season: 2026 },
      ] },
      { sport: 'basketball', leagues: [{ leagueId: '999', leagueName: 'Hoops' }] },
    ],
  }, 2026), [
    { id: '123', name: 'Sunday League', season: 2025 },
    { id: '456', name: 'Keeper League', season: 2026 },
  ]);
});

test('profile parser reads ESPN account group listings', () => {
  assert.deepEqual(parseEspnProfile({
    preferences: [
      { metaData: { entry: {
        name: 'Fantasy Football 2026', seasonId: 2026,
        groups: [{ groupId: 1179837, groupName: 'Amtrak' }],
      } } },
      { metaData: { entry: {
        name: 'Fantasy Basketball 2026', seasonId: 2026,
        groups: [{ groupId: 7654321, groupName: 'Hoops' }],
      } } },
    ],
  }, 2026), [{ id: '1179837', name: 'Amtrak', season: 2026 }]);
});

test('profile discovery uses the SWID path and authenticated ESPN cookies', async () => {
  const originalFetch = globalThis.fetch;
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify({ leagues: [{ leagueId: '123', leagueName: 'Sunday League', seasonId: 2026 }] }), { status: 200 });
  }) as typeof fetch;
  try {
    assert.deepEqual(await discoverEspnLeagues({ espn_s2: 's2-token', SWID: '{user-id}' }, 2026), [
      { id: '123', name: 'Sunday League', season: 2026 },
    ]);
    const request = new URL(calls[0].url);
    assert.equal(request.origin, ESPN_FAN_API_BASE);
    assert.equal(request.pathname, '/apis/v2/fans/%7Buser-id%7D');
    assert.equal((calls[0].init?.headers as Record<string, string>).Cookie, 'SWID={user-id}; espn_s2=s2-token');
    assert.equal(calls[0].init?.redirect, 'manual');
    assert.equal(calls[0].init?.cache, 'no-store');
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
