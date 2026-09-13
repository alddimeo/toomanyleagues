import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  exchangeYahooCode,
  fetchYahooLeague,
  parseYahooLeagueSnapshot,
  parseYahooLeagues,
  refreshYahooTokens,
  yahooAuthorizeUrl,
} from '../lib/yahoo';

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
});

test('builds a read-only Yahoo consent URL with the callback and state', () => {
  process.env.YAHOO_CLIENT_ID = 'client-id';
  process.env.APP_URL = 'https://league.example/';

  const url = new URL(yahooAuthorizeUrl('csrf value'));

  assert.equal(url.origin, 'https://api.login.yahoo.com');
  assert.equal(url.pathname, '/oauth2/request_auth');
  assert.equal(url.searchParams.get('client_id'), 'client-id');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://league.example/api/yahoo/callback');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('scope'), 'fspt-r');
  assert.equal(url.searchParams.get('state'), 'csrf value');
});

test('exchanges a code and keeps or rotates refresh tokens', async () => {
  process.env.YAHOO_CLIENT_ID = 'client-id';
  process.env.YAHOO_CLIENT_SECRET = 'client-secret';
  process.env.APP_URL = 'https://league.example';
  let call = 0;
  globalThis.fetch = (async (input, init) => {
    assert.equal(String(input), 'https://api.login.yahoo.com/oauth2/get_token');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Basic Y2xpZW50LWlkOmNsaWVudC1zZWNyZXQ=');
    call += 1;
    return new Response(
      JSON.stringify(
        call === 1
          ? { access_token: 'access-1', refresh_token: 'refresh-1', expires_in: '3600' }
          : call === 2
            ? { access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 1800 }
            : { access_token: 'access-3', expires_in: 900 },
      ),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;

  const first = await exchangeYahooCode('authorization-code');
  const second = await refreshYahooTokens(first.refreshToken);
  const third = await refreshYahooTokens(second.refreshToken);
  assert.equal(first.accessToken, 'access-1');
  assert.equal(first.refreshToken, 'refresh-1');
  assert.equal(second.accessToken, 'access-2');
  assert.equal(second.refreshToken, 'refresh-2');
  assert.equal(third.accessToken, 'access-3');
  assert.equal(third.refreshToken, 'refresh-2');
  assert.ok(Date.parse(first.expiresAt) > Date.now());
  assert.ok(Date.parse(second.expiresAt) > Date.now());
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
        { name: 'Current League' },
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
              team: [[{ team_key: '449.l.123.t.2' }, { team_id: '2' }, { name: 'Team Two' }]],
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
  assert.deepEqual(snapshot.matchups, [{ home: '449.l.123.t.1', away: '449.l.123.t.2' }]);
  assert.equal(snapshot.teams.length, 2);
  assert.equal(snapshot.teams[0].points, 88.5);
  assert.deepEqual(snapshot.teams[0].players[0], {
    id: '449.p.10',
    name: 'Quarterback One',
    position: 'QB',
    slot: 'BN',
    points: 18.5,
    stats: { 'Passing yards': 250, 'Pass TD': 2 },
  });
});

test('fetches metadata first, then requests the current roster period and scoreboard', async () => {
  process.env.APP_URL = 'https://league.example';
  const urls: string[] = [];
  globalThis.fetch = (async (input) => {
    const url = String(input);
    urls.push(url);
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
                  '0': { team: [[{ team_key: '449.l.123.t.1' }, { name: 'Team One' }]] },
                },
              },
            ],
          },
        }),
      );
    }
    assert.match(url, /\/scoreboard;week=4\?format=json$/);
    return new Response(JSON.stringify({ fantasy_content: { league: [{ scoreboard: [{ week: '4' }] }] } }));
  }) as typeof fetch;

  const snapshot = await fetchYahooLeague('access-token', '449.l.123', 2024);
  assert.deepEqual(urls, [
    'https://fantasysports.yahooapis.com/fantasy/v2/league/449.l.123/settings?format=json',
    'https://fantasysports.yahooapis.com/fantasy/v2/league/449.l.123/teams/roster;week=4/players/stats;type=week;week=4?format=json',
    'https://fantasysports.yahooapis.com/fantasy/v2/league/449.l.123/scoreboard;week=4?format=json',
  ]);
  assert.equal(snapshot.week, 4);
  assert.equal(snapshot.teams[0].id, '449.l.123.t.1');
});
