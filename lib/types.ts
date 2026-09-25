export type Provider = 'espn' | 'yahoo';
export type Player = {
  id: string;
  name: string;
  position: string;
  slot: string;
  points: number | null;
  projection?: number;
  pregameProjection?: number;
  projectionHeld?: boolean;
  stats: Record<string, string | number>;
  headshot?: string;
  nflTeam?: string;
  nflTeamLogo?: string;
};
export type Team = { id: string; name: string; logo?: string; isUserTeam?: boolean; points: number | null; projection?: number; pregameProjection?: number; players: Player[] };
export type LeagueSnapshot = { id: string; provider: Provider; name: string; logo?: string; season: number; week: number; fetchedAt: string; yahooProjectionsAt?: string; yahooProjectionCursor?: number; pregameClosed?: boolean; pregameCapturedAt?: string; teams: Team[]; matchups: { home: string; away: string | null; homeWinProbability?: number }[] };
