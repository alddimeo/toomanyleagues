import { cookies } from "next/headers";
import { LeagueDetailShell } from "@/components/LeagueDetailShell";

type Props = { params: Promise<{ provider: string; leagueId: string; teamId: string }>; searchParams: Promise<{ season?: string | string[] }> };

export default async function TeamPage({ params, searchParams }: Props) {
  await cookies();
  const { provider, leagueId, teamId } = await params;
  const query = await searchParams;
  const season = Array.isArray(query.season) ? query.season[0] : query.season;
  return <LeagueDetailShell provider={provider} leagueId={leagueId} teamId={teamId} season={season} />;
}
