import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  discoverYahooLeagues,
  fetchYahooLeague,
  parseYahooLeagueSnapshot,
  parseYahooLeagues,
  parseYahooRedzoneProjections,
} from '../lib/yahoo';
import { playerStatsWithDefaults } from '../lib/player-stats';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('parses leagues from Yahoo resource arrays and selects the current game season', () => {
  const payload = {
    fantasy_content: {
      users: {
        '0': {
          user: [
            { guid: 'user-guid' },
            {
              games: {
                '0': {
                  game: [
                    { game_key: '449' },
                    { code: 'nfl' },
                    { season: '2024' },
                    {
                      leagues: {
                        '0': {
                          league: [
                            { league_key: '449.l.123' },
                            { league_id: '123' },
                            { name: 'Current League' },
                          ],
                        },
                      },
                    },
                  ],
                },
              },
            },
          ],
        },
      },
    },
  };

  assert.deepEqual(parseYahooLeagues(payload), [
    { id: '449.l.123', name: 'Current League', season: 2024 },
  ]);
});

test('parses nested teams, live roster stats, points, and scoreboard matchups', () => {
  const rosterPayload = {
    fantasy_content: {
      league: [
        { league_key: '449.l.123' },
        { league_id: '123' },
        { name: 'Current League', logo_url: 'https://cdn.example/yahoo-league.png' },
        { season: '2024' },
        { current_week: '4' },
        {
          settings: {
            stat_categories: {
              '0': {
                stat: [
                  [{ stat_id: '4' }, { display_name: 'Passing yards' }],
                  [{ stat_id: '5' }, { display_name: 'Pass TD' }],
                ],
              },
            },
            stat_modifiers: { stats: {
              '0': { stat: [[{ stat_id: '4' }, { value: '0.04' }]] },
              '1': { stat: [[{ stat_id: '5' }, { value: '4' }]] },
            } },
          },
        },
        {
          teams: {
            '0': {
              team: [
                [
                  { team_key: '449.l.123.t.1' },
                  { team_id: '1' },
                  { name: 'Team One' },
                  { team_logos: { '0': { team_logo: { '0': { url: 'https://cdn.example/fantasy-team.png' } } } } },
                  { team_points: { total: '1000' } },
                  { managers: { manager: [{ is_current_login: '1' }] } },
                  {
                    roster: {
                      '0': {
                        roster: [
                          { coverage_type: 'week' },
                          { week: '4' },
                          {
                            players: {
                              '0': {
                                player: [
                                  [
                                    { player_key: '449.p.10' },
                                    { player_id: '10' },
                                    { name: { full: 'Quarterback One' } },
                                    { image_url: 'https://cdn.example/qb.png' },
                                    { editorial_team_abbr: 'KC' },
                                    { editorial_team_logo: 'https://cdn.example/kc.png' },
                                    { display_position: 'QB' },
                                    { selected_position: { position: 'BN' } },
                                    {
                                      player_points: {
                                        coverage_type: 'week',
                                        week: '4',
                                        total: '18.5',
                                      },
                                    },
                                    {
                                      player_stats: {
                                        coverage_type: 'week',
                                        week: '4',
                                        stats: {
                                          '0': { stat: [{ stat_id: '4' }, { value: '250' }] },
                                          '1': { stat: [{ stat_id: '5' }, { value: '2' }] },
                                        },
                                      },
                                    },
                                    [],
                                    [],
                                  ],
                                ],
                              },
                              '1': {
                                player: [[
                                  { player_key: '449.p.11' },
                                  { name: { full: 'Running Back Two' } },
                                  { editorial_team_full_name: 'New York Jets' },
                                  { display_position: 'RB' },
                                ]],
                              },
                              '2': {
                                player: [[
                                  { player_key: '449.p.12' },
                                  { name: { full: 'Mystery Player' } },
                                  { editorial_team_abbr: 'XYZ' },
                                  { editorial_team_logo: 'https://cdn.example/custom.png' },
                                  { display_position: 'WR' },
                                ]],
                              },
                            },
                          },
                        ],
                      },
                    },
                  },
                ],
              ],
            },
            '1': {
              team: [[{ team_key: '449.l.123.t.2' }, { team_id: '2' }, { name: 'Team Two' }, { team_points: { total: '999' } }]],
            },
          },
        },
      ],
    },
  };
  const scoreboardPayload = {
    fantasy_content: {
      league: [
        { league_key: '449.l.123' },
        {
          scoreboard: {
            '0': {
              scoreboard: [
                { week: '4' },
                {
                  matchups: {
                    '0': {
                      matchup: [
                        { week: '4' },
                        {
                          teams: {
                            '0': {
                              team: [[{ team_key: '449.l.123.t.1' }, { name: 'Team One' }, { team_points: { total: '88.5' } }]],
                            },
                            '1': {
                              team: [[{ team_key: '449.l.123.t.2' }, { name: 'Team Two' }, { team_points: { total: '77.25' } }]],
                            },
                          },
                        },
                      ],
                    },
                  },
                },
              ],
            },
          },
        },
      ],
    },
  };

  const snapshot = parseYahooLeagueSnapshot(rosterPayload, '449.l.123', 2024, scoreboardPayload);
  assert.equal(snapshot.id, '449.l.123');
  assert.equal(snapshot.name, 'Current League');
  assert.equal(snapshot.season, 2024);
  assert.equal(snapshot.week, 4);
  assert.equal(snapshot.logo, 'https://cdn.example/yahoo-league.png');
  assert.deepEqual(snapshot.matchups, [{ home: '449.l.123.t.1', away: '449.l.123.t.2' }]);
  assert.equal(snapshot.teams.length, 2);
  assert.equal(snapshot.teams[0].isUserTeam, true);
  assert.equal(snapshot.teams[0].points, 88.5);
  assert.equal(snapshot.teams[1].points, 77.25);
  assert.equal(snapshot.teams[0].logo, 'https://cdn.example/fantasy-team.png');
  assert.deepEqual(snapshot.teams[0].players[0], {
    id: '449.p.10',
    name: 'Quarterback One',
    position: 'QB',
    slot: 'BN',
    points: 18.5,
    stats: { 'Passing yards': 250, 'Pass TD': 2 },
    statPoints: { 'Passing yards': 10, 'Pass TD': 8 },
    headshot: 'https://cdn.example/qb.png',
    nflTeam: 'KC',
    nflTeamLogo: '/nfl/KC.png',
  });
  assert.equal(snapshot.teams[0].players[1].nflTeam, 'NYJ');
  assert.equal(snapshot.teams[0].players[1].nflTeamLogo, '/nfl/NYJ.png');
  assert.equal(snapshot.teams[0].players[2].nflTeamLogo, 'https://cdn.example/custom.png');
});

test('parser keeps optional Yahoo projections and win chance when supplied', () => {
  const snapshot = parseYahooLeagueSnapshot({ league: [{ league_key: '449.l.1', name: 'League', current_week: '4',
    teams: { team: [{ team_key: '449.l.1.t.1', name: 'Home', team_projected_points: { total: '90.5' },
      roster: { players: { player: [{ player_key: '449.p.1', name: { full: 'One' }, selected_position: { position: 'QB' }, player_projected_points: { total: '20.5' } }] } } }] },
    scoreboard: { matchups: { matchup: [{ home_win_probability: '62', teams: { team: [
      { team_key: '449.l.1.t.1', name: 'Home' }, { team_key: '449.l.1.t.2', name: 'Away' },
    ] } }] } },
  }] }, '449.l.1', 2024);
  assert.equal(snapshot.teams[0].projection, 90.5);
  assert.equal(snapshot.teams[0].players[0].projection, 20.5);
  assert.equal(snapshot.matchups[0].homeWinProbability, 62);
});

test('reads original player and team projections from Yahoo redzone data', () => {
  const projections = parseYahooRedzoneProjections({ service: { leagues: { '123': { teams: {
    '1': { id: '1', projectedPoints: '31.50', players: [
      { id: '10', projectedPoints: '10.17' },
      { id: '11', projectedPoints: '0.00' },
      { id: '12' },
    ] },
    '2': { id: '2', projectedPoints: '40.25', players: [{ id: '13', projectedPoints: '19.25' }] },
  } } } } });
  assert.equal(projections.get('1')?.projection, 31.5);
  assert.deepEqual([...projections.get('1')!.players], [['10', 10.17], ['11', 0]]);
  assert.equal(projections.get('2')?.players.get('13'), 19.25);
});

test('reads win probability from the first Yahoo scoreboard team', () => {
  const snapshot = parseYahooLeagueSnapshot({ league: [{ league_key: '449.l.1', name: 'League', current_week: '4' }] },
    '449.l.1', 2024, { scoreboard: { matchups: { matchup: [{ teams: { team: [
      { team_key: '449.l.1.t.1', win_probability: '0.62' }, { team_key: '449.l.1.t.2', win_probability: '0.38' },
    ] } }] } } });
  assert.equal(snapshot.matchups[0].homeWinProbability, 62);
});

test('shows the same labeled player stats for Yahoo and ESPN', () => {
  const expected = {
    'Passing attempts': 0,
    'Passing completions': 0,
    'Passing yards': 250,
    'Passing touchdowns': 2,
    'Passing interceptions': 1,
    'Rushing attempts': 0,
    'Rushing yards': 0,
    'Rushing touchdowns': 0,
    'Lost fumbles': 0,
  };
  assert.deepEqual(playerStatsWithDefaults({
    position: 'QB', stats: { 'Passing yards': 250, 'Pass TD': 2, Interceptions: 1, 'Yahoo stat 99': 7 },
  }), expected);
  assert.deepEqual(playerStatsWithDefaults({
    position: 'QB', stats: { 'Passing yards': 250, 'Passing touchdowns': 2, 'Passing interceptions': 1, 'ESPN stat 155': 3 },
  }), expected);
});

test('does not use stale roster totals when the scoreboard has no team score', () => {
  const rosterPayload = { fantasy_content: { league: [
    { league_key: '449.l.123' }, { name: 'League' }, { current_week: '4' },
    { teams: { '0': { team: [
      { team: [[{ team_key: '449.l.123.t.1' }, { name: 'Team One' }, { team_points: { total: '999' } }]] },
      { team: [[{ team_key: '449.l.123.t.2' }, { name: 'Team Two' }, { team_points: { total: '888' } }]] },
    ] } } },
  ] } };
  const scoreboardPayload = {
    fantasy_content: {
      league: [
        { league_key: '449.l.123' },
        {
          scoreboard: {
            '0': {
              scoreboard: [
                { week: '4' },
                {
                  matchups: {
                    '0': {
                      matchup: [{ teams: {
                        '0': { team: [[{ team_key: '449.l.123.t.1' }, { name: 'Team One' }, { team_points: { total: '42' } }]] },
                        '1': { team: [[{ team_key: '449.l.123.t.2' }, { name: 'Team Two' }]] },
                      } }],
                    },
                  },
                },
              ],
            },
          },
        },
      ],
    },
  };
  const snapshot = parseYahooLeagueSnapshot(rosterPayload, '449.l.123', 2024, scoreboardPayload);
  assert.equal(snapshot.teams.find((team) => team.id === '449.l.123.t.1')?.points, 42);
  assert.equal(snapshot.teams.find((team) => team.id === '449.l.123.t.2')?.points, null);
});

test('keeps live roster fields joined to team metadata', () => {
  const payload = { fantasy_content: { league: [
    { league_key: '449.l.123' }, { name: 'League' }, { current_week: '4' },
    { teams: { '0': { team: [
      [{ team_key: '449.l.123.t.1' }, { name: 'Team' }],
      { roster: [{ players: { '0': { player: [
        [{ player_key: '449.p.10' }, { name: { full: 'Quarterback' } }],
        { selected_position: [{ position: 'QB' }] },
      ] } } }] },
    ] } } },
  ] } };
  const snapshot = parseYahooLeagueSnapshot(payload, '449.l.123', 2024);
  assert.equal(snapshot.teams[0].players[0].name, 'Quarterback');
  assert.equal(snapshot.teams[0].players[0].slot, 'QB');
});

test('rejects unsafe Yahoo cookies before sending a request', async () => {
  globalThis.fetch = (() => { throw new Error('request should not run'); }) as typeof fetch;
  await assert.rejects(() => discoverYahooLeagues({ Y: 'bad\r\nX-Leak: yes', T: 'valid' }), /Invalid Yahoo session/);
});

test('refreshes Yahoo originals from redzone and preserves the last good value', async () => {
  const requests: { url: string; init?: RequestInit }[] = [];
  let redzoneFails = false;
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.includes('/league/449.l.123/settings?')) {
      return new Response(
        JSON.stringify({
          fantasy_content: {
            league: [
              { league_key: '449.l.123' },
              { name: 'Current League' },
              { season: '2024' },
              { current_week: '4' },
            ],
          },
        }),
      );
    }
    if (url.includes('/teams/roster;week=4/players/stats;type=week;week=4?')) {
      return new Response(
        JSON.stringify({
          fantasy_content: {
            league: [
              {
                teams: {
                  '0': { team: [[{ team_key: '449.l.123.t.1' }, { name: 'Team One' }],
                    { roster: { players: { '0': { player: [[{ player_key: '449.p.10' }, { name: { full: 'Player' } }, { player_projected_points: { total: '99' } }]] } } } }] },
                  '1': { team: [[{ team_key: '449.l.123.t.2' }, { name: 'Team Two' }],
                    { roster: { players: { '0': { player: [[{ player_key: '449.p.11' }, { name: { full: 'Other' } }, { player_projected_points: { total: '88' } }]] } } } }] },
                },
              },
            ],
          },
        }),
      );
    }
    if (url.includes('pub-api.fantasysports.yahoo.com/fantasy/v3/redzone/nfl?')) {
      if (redzoneFails) return new Response('unavailable', { status: 503 });
      return new Response(JSON.stringify({ service: { leagues: { '123': { teams: {
        '1': { id: '1', projectedPoints: '31.50', players: [{ id: '10', projectedPoints: '10.17' }] },
        '2': { id: '2', projectedPoints: '40.25', players: [{ id: '11', projectedPoints: '19.25' }] },
      } } } } }));
    }
    assert.match(url, /\/scoreboard;week=4\?format=json$/);
    return new Response(JSON.stringify({ fantasy_content: { league: [{ scoreboard: { week: '4', matchups: { matchup: [{ teams: { team: [
      { team_key: '449.l.123.t.1', name: 'Team One' },
      { team_key: '449.l.123.t.2', name: 'Team Two' },
    ] } }] } } }] } }));
  }) as typeof fetch;

  const snapshot = await fetchYahooLeague({ Y: 'y-cookie', T: 't-cookie' }, '449.l.123', 2024, undefined, ['449.l.123.t.1', '449.l.123.t.2']);
  assert.deepEqual(requests.map((request) => request.url), [
    'https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/league/449.l.123/settings?format=json',
    'https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/league/449.l.123/teams/roster;week=4/players/stats;type=week;week=4?format=json',
    'https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/league/449.l.123/scoreboard;week=4?format=json',
    'https://pub-api.fantasysports.yahoo.com/fantasy/v3/redzone/nfl?league_id=123&format=json&player_image_type=17',
  ]);
  assert.ok(requests.every((request) => request.init?.redirect === 'manual'));
  assert.ok(requests.every((request) => (request.init?.headers as Record<string, string>).cookie === 'Y=y-cookie; T=t-cookie'));
  assert.equal(snapshot.week, 4);
  assert.equal(snapshot.teams[0].id, '449.l.123.t.1');
  assert.equal(snapshot.teams[0].players[0].projection, 10.17);
  assert.equal(snapshot.teams[1].players[0].projection, 19.25);
  assert.equal(snapshot.teams[0].projection, 31.5);
  assert.equal(snapshot.teams[1].projection, 40.25);
  assert.ok(snapshot.yahooProjectionsAt);
  requests.length = 0;
  redzoneFails = true;
  const refreshed = await fetchYahooLeague({ Y: 'y-cookie', T: 't-cookie' }, '449.l.123', 2024, snapshot, ['449.l.123.t.1']);
  assert.equal(requests.length, 4);
  assert.match(requests[3].url, /\/fantasy\/v3\/redzone\/nfl\?/);
  assert.equal(refreshed.teams[0].players[0].projection, 10.17);
  assert.equal(refreshed.teams[0].projection, 31.5);
});
