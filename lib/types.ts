export type Provider = 'espn' | 'yahoo';
export type Player = {
  id: string;
  name: string;
  position: string;
  slot: string;
  points: number | null;
  stats: Record<string, string | number>;
  headshot?: string;
  nflTeam?: string;
  nflTeamLogo?: string;
};
export type Team = { id: string; name: string; logo?: string; isUserTeam?: boolean; points: number | null; players: Player[] };
export type LeagueSnapshot = { id: string; provider: Provider; name: string; season: number; week: number; fetchedAt: string; teams: Team[]; matchups: { home: string; away: string | null }[] };
