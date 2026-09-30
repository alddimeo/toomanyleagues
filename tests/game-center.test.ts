import assert from 'node:assert/strict';
import test from 'node:test';
import { exposurePerformance, featuredPlayerExposure, filterPersonalMatchups, matchupSignal, personalMatchups, playerExposure, sortPersonalMatchups } from '../lib/game-center';
import type { LeagueSnapshot, Player, Team } from '../lib/types';

const player = (name: string, slot = 'RB'): Player => ({ id: name, name, position: 'RB', slot, points: 8, stats: {}, nflTeam: 'PHI' });
const league = (id: string, margin: number, projectionMargin: number, sharedName = 'A.J. Brown'): LeagueSnapshot => {
  const user: Team = { id: `${id}-user`, name: 'Mine', isUserTeam: true, points: 100 + margin, projection: 110 + projectionMargin, players: [player(sharedName), player('Bench Player', 'BN')] };
  const opponent: Team = { id: `${id}-opponent`, name: 'Theirs', points: 100, projection: 110, players: [player(sharedName === 'A.J. Brown' ? 'AJ Brown' : sharedName)] };
  return { id, provider: id === 'one' ? 'espn' : 'yahoo', name: `League ${id}`, season: 2026, week: 4, fetchedAt: '2026-09-29T00:00:00Z', teams: [user, opponent], matchups: [{ home: user.id, away: opponent.id }] };
};

test('game center prioritizes projected flips and filters by the projected margin', () => {
  const matchups = personalMatchups([league('one', 6, -2), league('two', -20, 14), league('three', 2, 4)]);
  assert.equal(sortPersonalMatchups(matchups, 'attention')[0].league.id, 'one');
  assert.deepEqual(filterPersonalMatchups(matchups, 'close').map((item) => item.league.id), ['one', 'three']);
  assert.deepEqual(filterPersonalMatchups(matchups, 'behind').map((item) => item.league.id), ['one']);
  assert.equal(matchupSignal(matchups[0]).label, 'Lead may flip');
});

test('cross-league exposure merges provider punctuation variants and separates roles', () => {
  const exposure = playerExposure([league('one', 1, 1), league('two', 1, 1)]);
  const { player: representative, ...shared } = exposure[0];
  assert.deepEqual(shared, { key: 'ajbrown', name: 'A.J. Brown', position: 'RB', nflTeam: 'PHI', leagues: 2, started: 2, benched: 0, against: 2 });
  assert.equal(representative.name, 'A.J. Brown');
  assert.equal(exposure.some((item) => item.name === 'Bench Player'), true);
});

test('featured players can rank starts and projection performance', () => {
  const base = playerExposure([league('one', 1, 1), league('two', 1, 1)])[0];
  const entry = (key: string, points: number, projection: number, started: number) => ({ ...base, key, name: key, started, player: { ...base.player, name: key, points, pregameProjection: projection } });
  const exposure = [entry('steady', 12, 10, 4), entry('boom', 20, 10, 1), entry('bust', 4, 12, 3), entry('flat', 10, 10, 5)];
  assert.deepEqual(featuredPlayerExposure(exposure, 'starts').map((item) => item.key), ['flat', 'steady', 'bust', 'boom']);
  assert.deepEqual(featuredPlayerExposure(exposure, 'over').map((item) => item.key), ['boom', 'steady']);
  assert.deepEqual(featuredPlayerExposure(exposure, 'under').map((item) => item.key), ['bust']);
  assert.deepEqual(featuredPlayerExposure(exposure, 'combined').map((item) => item.key), ['boom', 'steady', 'bust']);
  assert.equal(exposurePerformance(exposure[1]), 10);
  const many = Array.from({ length: 5 }, (_, index) => entry(`over-${index}`, 20 + index, 10, index)).concat(Array.from({ length: 5 }, (_, index) => entry(`under-${index}`, index, 10, index)));
  const combined = featuredPlayerExposure(many, 'combined');
  assert.equal(combined.length, 8);
  assert.equal(combined.filter((item) => (exposurePerformance(item) ?? 0) > 0).length, 4);
  assert.equal(combined.filter((item) => (exposurePerformance(item) ?? 0) < 0).length, 4);
});

test('performance modes select category leaders before limiting to eight', () => {
  const base = playerExposure([league('one', 1, 1)])[0];
  const entry = (key: string, performance: number, leagues: number) => ({ ...base, key, name: key, leagues, player: { ...base.player, name: key, points: 10 + performance, pregameProjection: 10 } });
  const exposure = Array.from({ length: 9 }, (_, index) => entry(`popular-${index}`, 1, 20 - index));
  const leader = entry('category-leader', 20, 1);

  assert.equal(featuredPlayerExposure([...exposure, leader], 'over')[0], leader);
});

test('performance rankings include players from a single league', () => {
  const solo = league('solo', 1, 1);
  solo.teams[0].players.push({ ...player('Solo Boom'), points: 30, pregameProjection: 5 });
  const exposure = playerExposure([league('one', 1, 1), league('two', 1, 1), solo]);
  assert.equal(featuredPlayerExposure(exposure, 'over')[0].name, 'Solo Boom');
});
