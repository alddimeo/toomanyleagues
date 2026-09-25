"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { LeagueSnapshot, Team } from "@/lib/types";
import { leagueHref, MatchupGrid, TeamLogo, TeamRoster, formatPoints } from "@/components/LeagueViews";
import { Wordmark } from "@/components/Wordmark";
import { ProjectionValue } from "@/components/ProjectionValue";
import { useLiveNflGames } from "@/components/useLiveNflGames";
import { NflPanel } from "@/components/NflPanel";

type Props = { provider: string; leagueId: string; teamId?: string; season?: string; matchup?: string };

function isLeague(value: unknown): value is LeagueSnapshot {
  return typeof value === "object" && value !== null && (value as LeagueSnapshot).provider !== undefined && typeof (value as LeagueSnapshot).id === "string";
}

export function LeagueDetailShell({ provider, leagueId, teamId, season, matchup }: Props) {
  const router = useRouter();
  const [leagues, setLeagues] = useState<LeagueSnapshot[] | null>(null);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const liveGames = useLiveNflGames(leagues !== null);
  const refreshing = useRef(false);
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/dashboard", { cache: "no-store", credentials: "same-origin" }).then(async (response) => {
      if (response.status === 401) return router.replace("/login");
      if (!response.ok) throw new Error("We couldn’t load this snapshot.");
      const value: unknown = await response.json();
      const next = value && typeof value === "object" && Array.isArray((value as { leagues?: unknown }).leagues)
        ? (value as { leagues: unknown[] }).leagues.filter(isLeague)
        : [];
      if (!cancelled) {
        setEmail(value && typeof value === "object" && "user" in value && value.user && typeof value.user === "object" && "email" in value.user && typeof value.user.email === "string" ? value.user.email : "");
        setLeagues(next);
      }
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : "We couldn’t load this snapshot.");
    });
    return () => { cancelled = true; };
  }, [router]);

  const refresh = useCallback(async () => {
      if (refreshing.current || document.visibilityState !== 'visible') return;
      refreshing.current = true;
      try {
        const response = await fetch('/api/refresh', { method: 'POST', credentials: 'same-origin', cache: 'no-store' });
        if (response.status === 401) return router.replace('/login');
        if (!response.ok) return;
        const value: unknown = await response.json();
        if (value && typeof value === 'object' && Array.isArray((value as { leagues?: unknown }).leagues))
          setLeagues((value as { leagues: unknown[] }).leagues.filter(isLeague));
      } catch { /* Keep the previous snapshot when a live refresh fails. */ }
      finally { refreshing.current = false; }
  }, [router]);

  useEffect(() => {
    if (!liveGames) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    document.addEventListener('visibilitychange', refresh);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [liveGames, refresh]);

  if (error) return <RouteMessage message={error} />;
  if (!leagues) return <main className="dashboard-loading"><Wordmark compact /><div className="loading-spinner" role="status" aria-label="Loading snapshot" /><p>Opening snapshot…</p></main>;
  const league = leagues.find((item) => item.provider === provider && item.id === leagueId && (!season || String(item.season) === season));
  const team = league && teamId ? league.teams.find((item) => item.id === teamId) : undefined;
  if (!league || (teamId && !team)) return <RouteMessage message="That league or team is not in your saved snapshots." />;
  return <div className="dashboard-route-shell"><main className="dashboard-main"><header className="dashboard-topbar"><Link href="/" className="dashboard-brand"><Wordmark /></Link><nav className="dashboard-nav" aria-label="Dashboard sections"><Link href="/dashboard" className="dashboard-nav-link">Game center</Link><Link href="/dashboard/leagues" className="dashboard-nav-link active">Leagues</Link><Link href="/dashboard/settings" className="dashboard-nav-link">Settings</Link><Link href="/dashboard/help" className="dashboard-nav-link">Help</Link></nav><div className="dashboard-user"><span className="user-email">{email}</span><form action="/auth/logout" method="post"><button type="submit" className="mobile-signout">Sign out</button></form></div></header><div className="dashboard-content">{team ? <><div className="route-breadcrumb"><Link href="/dashboard/leagues">Leagues</Link><span>/</span><Link href={leagueHref(league)}>{league.name}</Link><span>/</span><span>{team.name}</span></div>{liveGames === false ? <div className="dashboard-heading-actions"><span className="dashboard-refresh-help">Automatic updates run while NFL games are live.</span><button className="button button-small button-outline" type="button" onClick={() => void refresh()}>Refresh scores</button></div> : null}<TeamDetail league={league} team={team} /></> : <LeagueDetail league={league} matchup={matchup} liveGames={liveGames} onRefresh={refresh} />}</div></main><NflPanel leagues={leagues} /></div>;
}

function LeagueDetail({ league, matchup, liveGames, onRefresh }: { league: LeagueSnapshot; matchup?: string; liveGames: boolean | null; onRefresh: () => Promise<void> }) {
  const updated = new Date(league.fetchedAt);
  return <><div className="route-heading league-detail-heading"><h1>{league.name}</h1><div className="league-detail-updated">{Number.isFinite(updated.getTime()) ? <span className="dashboard-live-status" role="status"><b className="status-dot" /><time dateTime={league.fetchedAt}>Updated {updated.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time></span> : null}{liveGames === false ? <button className="button button-small button-outline" type="button" onClick={() => void onRefresh()}>Refresh scores</button> : null}</div></div><section className="dashboard-matchups route-section league-detail-section" aria-label="Matchups"><MatchupGrid leagues={[league]} initialMatchup={matchup} layout="grid" /></section></>;
}

function TeamDetail({ league, team }: { league: LeagueSnapshot; team: Team }) {
  return <><div className="route-heading team-detail-heading"><div className="team-detail-title"><TeamLogo team={team} /><div><p className="eyebrow">{league.name} · {league.season} SEASON</p><h1>{team.name}</h1><p><strong className="team-detail-points">{formatPoints(team.points)}</strong> points · {team.players.length} rostered players</p><ProjectionValue value={team.projection} baseline={team.pregameProjection} teamTotal /></div></div><Link className="button button-outline button-small" href={leagueHref(league)}>← League matchups</Link></div><TeamRoster league={league} team={team} /></>;
}

function RouteMessage({ message }: { message: string }) {
  return <main className="dashboard-loading dashboard-error-state"><Wordmark compact /><div className="empty-orbit" aria-hidden="true"><span>!</span></div><h1>Snapshot unavailable.</h1><p>{message}</p><Link className="button button-primary" href="/dashboard">Back to dashboard</Link></main>;
}
