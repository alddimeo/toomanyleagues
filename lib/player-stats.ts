import type { Player } from './types';

const POSITION_STATS: Record<string, string[]> = {
  QB: ['Passing attempts', 'Passing completions', 'Passing yards', 'Passing touchdowns', 'Passing interceptions', 'Rushing attempts', 'Rushing yards', 'Rushing touchdowns', 'Lost fumbles'],
  RB: ['Rushing attempts', 'Rushing yards', 'Rushing touchdowns', 'Receiving receptions', 'Receiving targets', 'Receiving yards', 'Receiving touchdowns', 'Lost fumbles'],
  WR: ['Receiving receptions', 'Receiving targets', 'Receiving yards', 'Receiving touchdowns', 'Rushing attempts', 'Rushing yards', 'Rushing touchdowns', 'Lost fumbles'],
  TE: ['Receiving receptions', 'Receiving targets', 'Receiving yards', 'Receiving touchdowns', 'Rushing attempts', 'Rushing yards', 'Rushing touchdowns', 'Lost fumbles'],
  K: ['Made field goals', 'Made extra points'],
  'D/ST': ['Defensive sacks', 'Defensive interceptions', 'Defensive fumbles', 'Defensive blocked kicks', 'Defensive safeties', 'Defensive touchdowns'],
};

const STAT_ALIASES: Record<string, string> = {
  'pass att': 'Passing attempts', 'pass attempts': 'Passing attempts',
  'pass cmp': 'Passing completions', 'pass comp': 'Passing completions',
  'pass yds': 'Passing yards', 'pass td': 'Passing touchdowns', 'passing td': 'Passing touchdowns', 'pass int': 'Passing interceptions',
  'rush att': 'Rushing attempts', 'rush yds': 'Rushing yards', 'rush td': 'Rushing touchdowns', 'rushing td': 'Rushing touchdowns',
  rec: 'Receiving receptions', receptions: 'Receiving receptions', 'rec tgts': 'Receiving targets', targets: 'Receiving targets',
  'rec yds': 'Receiving yards', 'rec td': 'Receiving touchdowns', 'receiving td': 'Receiving touchdowns', 'fumbles lost': 'Lost fumbles',
  fgm: 'Made field goals', 'fg made': 'Made field goals', 'field goals made': 'Made field goals',
  xpm: 'Made extra points', 'xp made': 'Made extra points', 'extra points made': 'Made extra points',
};

const POSITION_ALIASES: Record<string, Record<string, string>> = {
  QB: { interceptions: 'Passing interceptions' },
  K: { 'field goals': 'Made field goals', 'extra points': 'Made extra points' },
  'D/ST': {
    sacks: 'Defensive sacks', interceptions: 'Defensive interceptions',
    'fumble recoveries': 'Defensive fumbles', 'blocked kicks': 'Defensive blocked kicks',
    safeties: 'Defensive safeties', touchdowns: 'Defensive touchdowns',
  },
};

export function playerStatsWithDefaults(player: Pick<Player, 'position' | 'stats'>): Record<string, string | number> {
  const rawPosition = player.position.trim().toUpperCase();
  const position = ['D/ST', 'DST', 'DEF', 'DEFENSE'].includes(rawPosition)
    ? 'D/ST'
    : rawPosition.split(/[\/,]/)[0].trim();
  const defaults = POSITION_STATS[position] ?? [];
  const knownLabels = new Map(defaults.map((label) => [label.toLowerCase(), label] as const));
  const stats: Record<string, string | number> = Object.fromEntries(defaults.map((label) => [label, 0]));
  for (const [rawLabel, value] of Object.entries(player.stats ?? {})) {
    const label = rawLabel.trim();
    const key = label.toLowerCase();
    stats[POSITION_ALIASES[position]?.[key] ?? STAT_ALIASES[key] ?? knownLabels.get(key) ?? label] = value;
  }
  return stats;
}
