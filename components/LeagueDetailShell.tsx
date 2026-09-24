"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { LeagueSnapshot, Team } from "@/lib/types";
import { leagueHref, MatchupGrid, TeamLogo, TeamRoster, formatPoints } from "@/components/LeagueViews";
import { Wordmark } from "@/components/Wordmark";
import { ProjectionValue } from "@/components/ProjectionValue";

type Props = { provider: string; leagueId: string; teamId?: string; season?: string };

function isLeague(value: unknown): value is LeagueSnapshot {
  return typeof value === "object" && value !== null && (value as LeagueSnapshot).provider !== undefined && typeof (value as LeagueSnapshot).id === "string";
}

export function LeagueDetailShell({ provider, leagueId, teamId, season }: Props) {
  const router = useRouter();
  const [leagues, setLeagues] = useState<LeagueSnapshot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/dashboard", { cache: "no-store", credentials: "same-origin" }).then(async (response) => {
      if (response.status === 401) return router.replace("/login");
      if (!response.ok) throw new Error("We couldn’t load this snapshot.");
      const value: unknown = await response.json();
      const next = value && typeof value === "object" && Array.isArray((value as { leagues?: unknown }).leagues)
        ? (value as { leagues: unknown[] }).leagues.filter(isLeague)
        : [];
      if (!cancelled) setLeagues(next);
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : "We couldn’t load this snapshot.");
    });
    return () => { cancelled = true; };
  }, [router]);

  useEffect(() => {
    let busy = false;
    const refresh = async () => {
      if (busy || document.visibilityState !== 'visible') return;
      busy = true;
      try {
        const response = await fetch('/api/refresh', { method: 'POST', credentials: 'same-origin', cache: 'no-store' });
        if (response.status === 401) return router.replace('/login');
        if (!response.ok) return;
        const value: unknown = await response.json();
        if (value && typeof value === 'object' && Array.isArray((value as { leagues?: unknown }).leagues))
          setLeagues((value as { leagues: unknown[] }).leagues.filter(isLeague));
      } catch { /* Keep the previous snapshot when a live refresh fails. */ }
      finally { busy = false; }
    };
    const timer = window.setInterval(() => void refresh(), 30_000);
    document.addEventListener('visibilitychange', refresh);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [router]);

  if (error) return <RouteMessage message={error} />;
  if (!leagues) return <main className="dashboard-loading"><Wordmark compact /><div className="loading-spinner" role="status" aria-label="Loading snapshot" /><p>Opening snapshot…</p></main>;
  const league = leagues.find((item) => item.provider === provider && item.id === leagueId && (!season || String(item.season) === season));
  const team = league && teamId ? league.teams.find((item) => item.id === teamId) : undefined;
  if (!league || (teamId && !team)) return <RouteMessage message="That league or team is not in your saved snapshots." />;
  return <div className="dashboard-route-shell"><main className="dashboard-main"><header className="dashboard-topbar"><Link href="/" className="dashboard-brand"><Wordmark /></Link><nav className="dashboard-nav" aria-label="Dashboard sections"><Link href="/dashboard" className="dashboard-nav-link active">Game center</Link><Link href="/dashboard/settings" className="dashboard-nav-link">Settings</Link><Link href="/dashboard/help" className="dashboard-nav-link">Help</Link></nav><Link href="/dashboard" className="route-back">← Back</Link></header><div className="dashboard-content"><div className="route-breadcrumb"><Link href="/dashboard">Dashboard</Link><span>/</span><Link href={leagueHref(league)}>{league.name}</Link>{team ? <><span>/</span><span>{team.name}</span></> : null}</div>{team ? <TeamDetail league={league} team={team} /> : <LeagueDetail league={league} />}</div></main></div>;
}

function LeagueDetail({ league }: { league: LeagueSnapshot }) {
  return <><div className="route-heading"><div><p className="eyebrow">{league.provider.toUpperCase()} · {league.season} SEASON · WEEK {league.week || "—"}</p><h1>{league.name}</h1><p>{league.teams.length} teams · {league.matchups.length} matchups</p></div></div><section className="dashboard-matchups route-section" aria-labelledby="matchups-title"><div className="section-heading-row"><div><p className="eyebrow">WEEKLY VIEW</p><h2 id="matchups-title">Matchups</h2></div></div><MatchupGrid leagues={[league]} /></section></>;
}

function TeamDetail({ league, team }: { league: LeagueSnapshot; team: Team }) {
  return <><div className="route-heading team-detail-heading"><div className="team-detail-title"><TeamLogo team={team} /><div><p className="eyebrow">{league.name} · {league.season} SEASON</p><h1>{team.name}</h1><p>{formatPoints(team.points)} points · {team.players.length} rostered players</p><ProjectionValue value={team.projection} baseline={team.pregameProjection} /></div></div><Link className="button button-outline button-small" href={leagueHref(league)}>← League matchups</Link></div><TeamRoster league={league} team={team} /></>;
}

function RouteMessage({ message }: { message: string }) {
  return <main className="dashboard-loading dashboard-error-state"><Wordmark compact /><div className="empty-orbit" aria-hidden="true"><span>!</span></div><h1>Snapshot unavailable.</h1><p>{message}</p><Link className="button button-primary" href="/dashboard">Back to dashboard</Link></main>;
}
