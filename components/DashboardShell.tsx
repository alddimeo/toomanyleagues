"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { LeagueSnapshot, Player, Provider, Team } from "@/lib/types";
import { Wordmark } from "@/components/Wordmark";

type Connection = { provider: Provider; status: string };
type DashboardData = {
  user: { email: string };
  connections: Connection[];
  leagues: LeagueSnapshot[];
  configured: { espn: boolean; yahoo: boolean };
};
type Notice = { kind: "error" | "success" | "info"; text: string };
type EspnSession = { liveUrl: string; expiresAt?: string };
type YahooLeagueOption = { id: string; name: string; season: number };

const currentYear = new Date().getFullYear();

function leagueKey(league: Pick<LeagueSnapshot, "provider" | "id" | "season">) {
  return `${league.provider}:${league.id}:${league.season}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeDashboard(value: unknown): DashboardData | null {
  if (!isRecord(value) || !isRecord(value.user) || typeof value.user.email !== "string") return null;
  const configured = isRecord(value.configured) ? value.configured : {};
  return {
    user: { email: value.user.email },
    connections: Array.isArray(value.connections) ? value.connections.filter(isRecord).filter((item) => item.provider === "espn" || item.provider === "yahoo") as Connection[] : [],
    leagues: Array.isArray(value.leagues) ? value.leagues as LeagueSnapshot[] : [],
    configured: { espn: configured.espn === true, yahoo: configured.yahoo === true },
  };
}

function points(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : "—";
}

function prettyProvider(provider: Provider) {
  return provider === "espn" ? "ESPN" : "Yahoo";
}

function formatDate(value: string | undefined) {
  if (!value) return "No refresh time";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "No refresh time" : `Updated ${date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" })}`;
}

function formatExpiry(value: string | undefined) {
  if (!value) return "Hosted sign-in session";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Hosted sign-in session" : `Session expires ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

function providerInitial(provider: Provider) {
  return provider === "espn" ? "E" : "Y!";
}

function safeRetryAfter(response: Response) {
  const seconds = Number(response.headers.get("Retry-After"));
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds * 1000) : 4000;
}

async function safeApiMessage(response: Response, fallback: string) {
  try {
    const value: unknown = await response.json();
    if (isRecord(value) && typeof value.error === "string" && value.error.length > 0 && value.error.length <= 180) return value.error;
  } catch {
    // The status fallback is safer than exposing an unreadable response body.
  }
  if (response.status === 403) return "This private prototype is available to invited testers only.";
  if (response.status === 503) return "This provider is not configured for the prototype yet.";
  return fallback;
}

function providerStatus(data: DashboardData, provider: Provider) {
  const connection = data.connections.find((item) => item.provider === provider);
  if (connection) return connection.status || "Connected";
  return data.configured[provider] ? "Ready to connect" : "Setup needed";
}

export function DashboardShell() {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [selectedLeagueId, setSelectedLeagueId] = useState("");
  const [view, setView] = useState<"matchups" | "rosters">("matchups");
  const [liveMode, setLiveMode] = useState(false);
  const [liveState, setLiveState] = useState("Live mode is off");
  const [refreshing, setRefreshing] = useState(false);
  const [showAddLeague, setShowAddLeague] = useState(false);
  const [leagueProvider, setLeagueProvider] = useState<Provider>("espn");
  const [leagueId, setLeagueId] = useState("");
  const [season, setSeason] = useState(String(currentYear));
  const [leagueBusy, setLeagueBusy] = useState(false);
  const [connectionBusy, setConnectionBusy] = useState<Provider | null>(null);
  const [espnSession, setEspnSession] = useState<EspnSession | null>(null);
  const [espnBusy, setEspnBusy] = useState(false);
  const [yahooOptions, setYahooOptions] = useState<YahooLeagueOption[]>([]);
  const [yahooDiscovering, setYahooDiscovering] = useState(false);
  const [yahooImporting, setYahooImporting] = useState<string | null>(null);
  const selectedLeagueRef = useRef("");
  const selectedLeagueInputRef = useRef<{ provider: Provider; leagueId: string } | null>(null);
  const refreshInFlight = useRef(false);

  const routeToLogin = useCallback(() => {
    setLiveMode(false);
    router.replace("/login");
  }, [router]);

  const setDashboard = useCallback((value: unknown) => {
    const next = normalizeDashboard(value);
    if (!next) return false;
    setData(next);
    if (!selectedLeagueRef.current || !next.leagues.some((league) => leagueKey(league) === selectedLeagueRef.current)) {
      const first = next.leagues[0];
      const nextId = first ? leagueKey(first) : "";
      selectedLeagueRef.current = nextId;
      selectedLeagueInputRef.current = first ? { provider: first.provider, leagueId: first.id } : null;
      setSelectedLeagueId(nextId);
    }
    return true;
  }, []);

  const loadDashboard = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch("/api/dashboard", { cache: "no-store", credentials: "same-origin" });
      if (response.status === 401) {
        routeToLogin();
        return false;
      }
      if (!response.ok) throw new Error(await safeApiMessage(response, "We couldn’t load your dashboard. Please try again."));
      if (!setDashboard(await response.json())) throw new Error("We couldn’t load your dashboard. Please try again.");
      return true;
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : "We couldn’t load your dashboard. Please try again.";
      if (!quiet) setLoadError(message);
      else setNotice({ kind: "error", text: `${message} Your last view is still here.` });
      return false;
    } finally {
      setLoading(false);
    }
  }, [routeToLogin, setDashboard]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("error") === "yahoo_connection") {
      setNotice({ kind: "error", text: "We couldn’t complete Yahoo sign-in. Please try again." });
      window.history.replaceState({}, "", "/dashboard");
    }
  }, []);

  const refreshDashboard = useCallback(async (fromLive = false) => {
    if (refreshInFlight.current || document.visibilityState !== "visible") return 4000;
    refreshInFlight.current = true;
    setRefreshing(true);
    if (fromLive) setLiveState("Refreshing…");
    try {
      const body = selectedLeagueInputRef.current ?? undefined;
      const response = await fetch("/api/refresh", {
        method: "POST",
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        credentials: "same-origin",
        cache: "no-store",
      });
      if (response.status === 401) {
        routeToLogin();
        return 0;
      }
      if (response.status === 429) {
        const delay = safeRetryAfter(response);
        if (fromLive) setLiveState(`Provider is pacing requests · retrying in ${Math.ceil(delay / 1000)}s`);
        else setNotice({ kind: "info", text: "The provider is pacing requests. Try again in a moment." });
        return delay;
      }
      if (response.status === 409) {
        const message = await safeApiMessage(response, "Your provider authorization expired. Reconnect the provider to continue.");
        setLiveMode(false);
        setNotice({ kind: "error", text: message });
        void loadDashboard(true);
        return 0;
      }
      if (!response.ok) {
        const message = await safeApiMessage(response, "We couldn’t refresh right now. Your last view is still here.");
        if (fromLive) {
          setLiveMode(false);
          setNotice({ kind: "error", text: `${message} Live mode is paused; use Refresh to try again.` });
        } else setNotice({ kind: "error", text: message });
        return fromLive ? 0 : 4000;
      }
      if (!setDashboard(await response.json())) throw new Error("refresh");
      const updated = `Updated ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
      if (fromLive) setLiveState(updated);
      else setNotice({ kind: "success", text: updated });
      return 4000;
    } catch {
      if (fromLive) {
        setLiveMode(false);
        setNotice({ kind: "error", text: "We couldn’t refresh right now. Live mode is paused; your last view is still here." });
      } else setNotice({ kind: "error", text: "We couldn’t refresh right now. Your last view is still here." });
      return fromLive ? 0 : 4000;
    } finally {
      refreshInFlight.current = false;
      setRefreshing(false);
    }
  }, [loadDashboard, routeToLogin, setDashboard]);

  useEffect(() => {
    if (!liveMode) {
      setLiveState("Live mode is off");
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      if (cancelled) return;
      const delay = await refreshDashboard(true);
      if (!cancelled && liveMode && delay !== 0) timer = setTimeout(() => void poll(), delay);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [liveMode, refreshDashboard]);

  const selectedLeague = useMemo(() => {
    if (!data?.leagues.length) return null;
    return data.leagues.find((league) => leagueKey(league) === selectedLeagueId) ?? data.leagues[0];
  }, [data, selectedLeagueId]);

  const teams = selectedLeague?.teams ?? [];
  const teamById = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams]);

  const submitLeague = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanId = leagueId.trim();
    const year = Number(season);
    if (!cleanId) {
      setNotice({ kind: "error", text: "Enter a league ID to add a league." });
      return;
    }
    if (!Number.isInteger(year) || year < 2000 || year > currentYear + 1) {
      setNotice({ kind: "error", text: "Enter a valid season year." });
      return;
    }
    setLeagueBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/leagues", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: leagueProvider, leagueId: cleanId, season: year }),
        credentials: "same-origin",
      });
      if (response.status === 401) return routeToLogin();
      if (!response.ok) throw new Error(await safeApiMessage(response, "We couldn’t add that league. Check the ID and try again."));
      setShowAddLeague(false);
      setLeagueId("");
      setNotice({ kind: "success", text: "League added. Loading its first snapshot…" });
      await loadDashboard(true);
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "We couldn’t add that league. Check the ID and try again." });
    } finally {
      setLeagueBusy(false);
    }
  };

  const disconnect = async (provider: Provider) => {
    setConnectionBusy(provider);
    setNotice(null);
    try {
      const response = await fetch("/api/connections", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider }),
        credentials: "same-origin",
      });
      if (response.status === 401) return routeToLogin();
      if (!response.ok) throw new Error(await safeApiMessage(response, `We couldn’t disconnect ${prettyProvider(provider)} right now.`));
      setNotice({ kind: "success", text: `${prettyProvider(provider)} disconnected.` });
      await loadDashboard(true);
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : `We couldn’t disconnect ${prettyProvider(provider)} right now.` });
    } finally {
      setConnectionBusy(null);
    }
  };

  const startEspn = async () => {
    setEspnBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/espn/start", { method: "POST", credentials: "same-origin" });
      if (response.status === 401) return routeToLogin();
      if (!response.ok) throw new Error(await safeApiMessage(response, "We couldn’t start the hosted ESPN sign-in. Please try again."));
      const value: unknown = await response.json();
      if (!isRecord(value) || typeof value.liveUrl !== "string" || !value.liveUrl) throw new Error("espn");
      setEspnSession({ liveUrl: value.liveUrl, expiresAt: typeof value.expiresAt === "string" ? value.expiresAt : undefined });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "We couldn’t start the hosted ESPN sign-in. Please try again." });
    } finally {
      setEspnBusy(false);
    }
  };

  const finishEspn = async (cancel = false) => {
    setEspnBusy(true);
    try {
      const response = await fetch(cancel ? "/api/espn/cancel" : "/api/espn/complete", { method: "POST", credentials: "same-origin" });
      if (response.status === 401) return routeToLogin();
      if (!response.ok) throw new Error(await safeApiMessage(response, "We couldn’t update the ESPN connection. Please try again."));
      setEspnSession(null);
      setNotice({ kind: cancel ? "info" : "success", text: cancel ? "ESPN sign-in canceled." : "ESPN sign-in completed. Add a league ID to load it." });
      if (!cancel) await loadDashboard(true);
    } catch (error) {
      if (!cancel) setEspnSession(null);
      setNotice({ kind: "error", text: `${error instanceof Error ? error.message : "We couldn’t update the ESPN connection."}${cancel ? "" : " Open a new ESPN sign-in window to try again."}` });
    } finally {
      setEspnBusy(false);
    }
  };

  const discoverYahoo = async () => {
    setYahooDiscovering(true);
    setNotice(null);
    try {
      const response = await fetch("/api/yahoo/discover", { method: "POST", credentials: "same-origin" });
      if (response.status === 401) return routeToLogin();
      if (!response.ok) throw new Error(await safeApiMessage(response, "We couldn’t discover your Yahoo leagues."));
      const value: unknown = await response.json();
      const leagues = isRecord(value) && Array.isArray(value.leagues) ? value.leagues.filter(isRecord).filter((item) => typeof item.id === "string" && typeof item.name === "string" && typeof item.season === "number").map((item) => ({ id: item.id as string, name: item.name as string, season: item.season as number })) : [];
      setYahooOptions(leagues);
      setNotice({ kind: "info", text: leagues.length ? "Choose a Yahoo league to import below." : "Yahoo did not return any leagues for this account." });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "We couldn’t discover your Yahoo leagues." });
    } finally {
      setYahooDiscovering(false);
    }
  };

  const importYahoo = async (option: YahooLeagueOption) => {
    setYahooImporting(option.id);
    setNotice(null);
    try {
      const response = await fetch("/api/leagues", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "yahoo", leagueId: option.id, season: option.season }),
        credentials: "same-origin",
      });
      if (response.status === 401) return routeToLogin();
      if (!response.ok) throw new Error(await safeApiMessage(response, "We couldn’t import that Yahoo league."));
      setYahooOptions((items) => items.filter((item) => !(item.id === option.id && item.season === option.season)));
      setNotice({ kind: "success", text: `${option.name} imported. Loading its snapshot…` });
      await loadDashboard(true);
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "We couldn’t import that Yahoo league." });
    } finally {
      setYahooImporting(null);
    }
  };

  if (loading && !data) return <LoadingDashboard />;
  if (loadError && !data) return <DashboardError message={loadError} onRetry={() => void loadDashboard()} />;
  if (!data) return <DashboardError message="Your dashboard data is unavailable. Please sign in again." onRetry={() => void loadDashboard()} />;

  return (
    <div className="dashboard-shell">
      <aside className="dashboard-sidebar">
        <Link href="/" className="dashboard-brand"><Wordmark compact /></Link>
        <div className="sidebar-nav" aria-label="Dashboard sections">
          <a href="#overview" className="sidebar-nav-item active"><span aria-hidden="true">◈</span> Overview</a>
          <a href="#connections" className="sidebar-nav-item"><span aria-hidden="true">◎</span> Connections</a>
        </div>
        <div className="sidebar-spacer" />
        <div className="sidebar-prototype"><span className="status-dot" /> Private prototype<div>Private dashboard with saved snapshots.</div></div>
        <form action="/auth/logout" method="post"><button className="sidebar-signout" type="submit"><span aria-hidden="true">↪</span> Sign out</button></form>
      </aside>

      <main className="dashboard-main" id="overview">
        <header className="dashboard-topbar">
          <div className="mobile-brand"><Link href="/" className="dashboard-brand"><Wordmark compact /></Link></div>
          <div className="dashboard-user"><span className="preview-tag">PRIVATE PREVIEW</span><span className="user-email">{data?.user.email}</span><form action="/auth/logout" method="post"><button type="submit" className="mobile-signout">Sign out</button></form></div>
        </header>
        <div className="dashboard-content">
          <header className="dashboard-heading">
            <div><p className="eyebrow">YOUR DASHBOARD</p><h1>Game day, <span>edited down.</span></h1><p>One view for the leagues you actually care about.</p></div>
            <div className="dashboard-actions"><button className="button button-outline" type="button" onClick={() => void refreshDashboard()} disabled={refreshing}>{refreshing ? "Refreshing…" : "↻ Refresh"}</button><button className={`live-toggle${liveMode ? " is-on" : ""}`} type="button" aria-pressed={liveMode} onClick={() => setLiveMode((value) => !value)}><span className="live-toggle-dot" /> Live mode</button></div>
          </header>

          <section className="score-feed" aria-labelledby="score-feed-title"><div className="score-feed-head"><div><p className="eyebrow">SUNDAY CONTROL ROOM</p><h2 id="score-feed-title">Scoreboard feed</h2></div><span>{data.leagues.length} {data.leagues.length === 1 ? "league" : "leagues"} · {liveMode ? "USER REFRESH ON" : "SNAPSHOT VIEW"}</span></div><div className="score-feed-rows">{data.leagues.length ? data.leagues.map((league) => <button className={`score-feed-row${leagueKey(league) === leagueKey(selectedLeague ?? league) ? " active" : ""}`} key={`feed-${leagueKey(league)}`} type="button" onClick={() => { selectedLeagueRef.current = leagueKey(league); selectedLeagueInputRef.current = { provider: league.provider, leagueId: league.id }; setSelectedLeagueId(leagueKey(league)); }}><span className={`league-provider provider-${league.provider}`}>{providerInitial(league.provider)}</span><span className="score-feed-league"><strong>{league.name}</strong><small>{prettyProvider(league.provider)} · {league.season} season</small></span><span className="score-feed-stat"><small>WEEK</small><b>{league.week || "—"}</b></span><span className="score-feed-stat"><small>TEAMS</small><b>{league.teams?.length ?? 0}</b></span><span className="score-feed-stat"><small>MATCHUPS</small><b>{league.matchups?.length ?? 0}</b></span><span className="score-feed-time">{formatDate(league.fetchedAt)}</span><span className="score-feed-arrow" aria-hidden="true">→</span></button>) : <p className="score-feed-empty">No snapshots yet. Connect a source and import a league below.</p>}</div></section>

          {notice ? <div className={`dashboard-notice notice-${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}><span aria-hidden="true">{notice.kind === "error" ? "!" : notice.kind === "success" ? "✓" : "i"}</span>{notice.text}<button type="button" aria-label="Dismiss message" onClick={() => setNotice(null)}>×</button></div> : null}

          <section className="connection-area" id="connections" aria-labelledby="connections-title">
            <div className="section-heading-row"><div><p className="eyebrow">SOURCES</p><h2 id="connections-title">Your connections</h2></div><span className="section-caption">{data?.connections.length ?? 0} connected</span></div>
            <div className="connection-grid">
              <ConnectionCard provider="espn" configured={data?.configured.espn === true} status={providerStatus(data!, "espn")} busy={connectionBusy === "espn" || espnBusy} onConnect={() => void startEspn()} onDisconnect={() => void disconnect("espn")} connected={Boolean(data?.connections.some((item) => item.provider === "espn"))} reconnect={providerStatus(data!, "espn").toLowerCase() === "reconnect"} />
              <ConnectionCard provider="yahoo" configured={data?.configured.yahoo === true} status={providerStatus(data!, "yahoo")} busy={connectionBusy === "yahoo" || yahooDiscovering} onConnect={() => { window.location.assign("/api/yahoo/connect"); }} onDisconnect={() => void disconnect("yahoo")} onDiscover={() => void discoverYahoo()} connected={Boolean(data?.connections.some((item) => item.provider === "yahoo"))} reconnect={providerStatus(data!, "yahoo").toLowerCase() === "reconnect"} />
            </div>
          </section>

          {yahooOptions.length ? <YahooPicker options={yahooOptions} importing={yahooImporting} onImport={(option) => void importYahoo(option)} onClose={() => setYahooOptions([])} /> : null}

          {espnSession ? <section className="espn-panel" aria-labelledby="espn-panel-title"><div className="espn-panel-head"><div><p className="eyebrow">HOSTED REMOTE BROWSER</p><h2 id="espn-panel-title">Connect ESPN</h2></div><button className="icon-button" type="button" aria-label="Close ESPN sign-in" onClick={() => void finishEspn(true)} disabled={espnBusy}>×</button></div><p className="espn-explanation">This window is a hosted remote browser showing ESPN’s sign-in page. Enter credentials only on ESPN’s page. Too Many Leagues does not capture or log your password. {formatExpiry(espnSession.expiresAt)}.</p><iframe className="espn-frame" title="Hosted ESPN sign-in" src={espnSession.liveUrl} sandbox="allow-forms allow-scripts allow-same-origin" referrerPolicy="no-referrer" /><div className="espn-panel-actions"><button type="button" className="button button-primary" onClick={() => void finishEspn(false)} disabled={espnBusy}>{espnBusy ? "Checking…" : "I’m finished signing in"}</button><button type="button" className="text-button" onClick={() => void finishEspn(true)} disabled={espnBusy}>Cancel</button></div></section> : null}

          <section className="leagues-area" aria-labelledby="leagues-title">
            <div className="section-heading-row"><div><p className="eyebrow">YOUR LEAGUES</p><h2 id="leagues-title">The weekly view</h2></div><button type="button" className="button button-outline button-small" onClick={() => setShowAddLeague((value) => !value)}>{showAddLeague ? "Close" : "+ Add league"}</button></div>
            {showAddLeague ? <form className="add-league-form" onSubmit={submitLeague}><div className="form-intro"><span className="form-icon">+</span><div><h3>Add a league manually</h3><p>First connect the provider above, then enter a league ID for a focused snapshot.</p></div></div><div className="form-fields"><label>Provider<select value={leagueProvider} onChange={(event) => setLeagueProvider(event.target.value as Provider)}><option value="espn">ESPN</option><option value="yahoo">Yahoo</option></select></label><label>League ID<input value={leagueId} onChange={(event) => setLeagueId(event.target.value)} placeholder="e.g. 12345678" autoComplete="off" /></label><label>Season<input value={season} onChange={(event) => setSeason(event.target.value)} inputMode="numeric" /></label><button className="button button-primary" type="submit" disabled={leagueBusy}>{leagueBusy ? "Adding…" : "Add league"}</button></div></form> : null}

            {selectedLeague ? <>
              <div className="league-list" role="tablist" aria-label="Choose a league">{data?.leagues.map((league) => <button key={leagueKey(league)} className={`league-tab${leagueKey(league) === leagueKey(selectedLeague) ? " active" : ""}`} type="button" role="tab" aria-selected={leagueKey(league) === leagueKey(selectedLeague)} onClick={() => { selectedLeagueRef.current = leagueKey(league); selectedLeagueInputRef.current = { provider: league.provider, leagueId: league.id }; setSelectedLeagueId(leagueKey(league)); }}><span className={`league-provider provider-${league.provider}`}>{providerInitial(league.provider)}</span><span className="league-tab-copy"><strong>{league.name}</strong><small>{prettyProvider(league.provider)} · {league.season} season</small></span><span className="league-tab-arrow" aria-hidden="true">→</span></button>)}</div>
              <div className="league-heading"><div><p className="league-kicker">{prettyProvider(selectedLeague.provider)} · {selectedLeague.season} SEASON · WEEK {selectedLeague.week}</p><h3>{selectedLeague.name}</h3><p>{formatDate(selectedLeague.fetchedAt)}</p></div><div className="view-tabs" role="tablist" aria-label="League view"><button type="button" role="tab" aria-selected={view === "matchups"} className={view === "matchups" ? "active" : ""} onClick={() => setView("matchups")}>Matchups</button><button type="button" role="tab" aria-selected={view === "rosters"} className={view === "rosters" ? "active" : ""} onClick={() => setView("rosters")}>Rosters</button></div></div>
              {view === "matchups" ? <MatchupView league={selectedLeague} teamById={teamById} /> : <RosterView teams={teams} />}
            </> : <EmptyLeague onAdd={() => setShowAddLeague(true)} />}
          </section>

          <footer className="dashboard-footer"><span>{liveMode ? <><b className="status-dot" /> {liveState}</> : "Snapshots are shown from your last successful refresh."}</span><span>Too Many Leagues · private prototype</span></footer>
        </div>
      </main>
    </div>
  );
}

function ConnectionCard({ provider, configured, status, connected, reconnect, busy, onConnect, onDisconnect, onDiscover }: { provider: Provider; configured: boolean; status: string; connected: boolean; reconnect: boolean; busy: boolean; onConnect: () => void; onDisconnect: () => void; onDiscover?: () => void }) {
  const label = prettyProvider(provider);
  return <article className={`connection-card connection-${provider}`}><div className="connection-card-top"><span className={`connection-logo provider-${provider}`}>{providerInitial(provider)}</span><span className={`connection-status${connected && !reconnect ? " connected" : ""}`}><b /> {status}</span></div><h3>{label}</h3><p>{reconnect ? "Authorization expired. Reconnect to keep this provider current." : connected ? "Connected account can power your league snapshots." : configured ? "Connect a provider account to pull in league data." : "Provider setup is missing for this private prototype."}</p><div className={`connection-card-actions${connected ? " connection-actions-connected" : ""}`}>{connected && provider === "yahoo" && !reconnect && onDiscover ? <button className="text-button discover-button" type="button" onClick={onDiscover} disabled={busy}>{busy ? "Discovering…" : "Discover leagues"}</button> : null}{connected && !reconnect ? <button className="text-button danger-button" type="button" onClick={onDisconnect} disabled={busy}>{busy ? "Disconnecting…" : "Disconnect"}</button> : reconnect ? <><button className="button button-small button-dark" type="button" onClick={onConnect} disabled={!configured || busy}>{busy ? "Opening…" : configured ? `Reconnect ${label} ↗` : "Unavailable"}</button><button className="text-button danger-button" type="button" onClick={onDisconnect} disabled={busy}>Disconnect</button></> : provider === "yahoo" ? <button className="button button-small button-dark" type="button" onClick={onConnect} disabled={!configured || busy}>{busy ? "Opening…" : configured ? "Connect Yahoo ↗" : "Unavailable"}</button> : <button className="button button-small button-dark" type="button" onClick={onConnect} disabled={!configured || busy}>{busy ? "Opening…" : configured ? "Connect ESPN ↗" : "Unavailable"}</button>}</div></article>;
}

function YahooPicker({ options, importing, onImport, onClose }: { options: YahooLeagueOption[]; importing: string | null; onImport: (option: YahooLeagueOption) => void; onClose: () => void }) {
  return <section className="yahoo-picker" aria-labelledby="yahoo-picker-title"><div className="yahoo-picker-head"><div><p className="eyebrow">YAHOO LEAGUES</p><h2 id="yahoo-picker-title">Choose what to import</h2></div><button className="icon-button light-icon-button" type="button" aria-label="Close Yahoo league picker" onClick={onClose}>×</button></div><div className="yahoo-picker-list">{options.map((option) => <div className="yahoo-picker-row" key={`${option.id}-${option.season}`}><div><strong>{option.name}</strong><small>{option.season} season · {option.id}</small></div><button className="button button-small button-primary" type="button" onClick={() => onImport(option)} disabled={Boolean(importing)}>{importing === option.id ? "Importing…" : "Import"}</button></div>)}</div></section>;
}

function MatchupView({ league, teamById }: { league: LeagueSnapshot; teamById: Map<string, Team> }) {
  const matchups = league.matchups ?? [];
  const featured = matchups[0];
  const featuredHome = featured ? teamById.get(featured.home) : undefined;
  const featuredAway = featured?.away ? teamById.get(featured.away) : undefined;
  return <div className="matchup-view"><div className="view-intro"><p>WEEK {league.week} MATCHUPS</p><span>{matchups.length} {matchups.length === 1 ? "matchup" : "matchups"}</span></div>{featured ? <div className="field-detail"><div className="field-detail-copy"><p>FEATURED MATCHUP / SCORE SNAPSHOT</p><div><strong>{featuredHome?.name ?? featured.home}</strong><b>{points(featuredHome?.points)}</b></div><div className="field-detail-divider">VS</div><div><strong>{featuredAway?.name ?? featured.away ?? "Bye week"}</strong><b>{featuredAway ? points(featuredAway.points) : "—"}</b></div></div><div className="football-field" aria-hidden="true"><i>10</i><i>20</i><i>30</i><i>40</i><i>50</i><i>40</i><i>30</i><i>20</i><i>10</i><span className="field-ball">●</span></div></div> : null}{matchups.length ? <div className="matchup-grid">{matchups.map((matchup, index) => { const home = teamById.get(matchup.home); const away = matchup.away ? teamById.get(matchup.away) : undefined; return <article className="matchup-card" key={`${matchup.home}-${matchup.away ?? "bye"}-${index}`}><div className="matchup-card-top"><span>WEEK {league.week}</span><span>{away ? "SCORE SNAPSHOT" : "BYE"}</span></div><TeamScore team={home} fallback={matchup.home} /><div className="versus"><span>VS</span></div>{away ? <TeamScore team={away} fallback={matchup.away ?? "Away team"} /> : <div className="bye-team"><span className="bye-mark">—</span><div><strong>Bye week</strong><small>No opponent listed</small></div></div>}<div className="matchup-card-foot"><span>{home?.players?.length ?? 0} players</span><span>{away?.players?.length ?? 0} players</span></div></article>; })}</div> : <div className="empty-inline"><span>◌</span><div><strong>No matchup pairs in this snapshot</strong><p>The provider returned league teams without a current matchup list.</p></div></div>}</div>;
}

function TeamScore({ team, fallback }: { team: Team | undefined; fallback: string }) {
  return <div className="team-score"><span className="team-avatar">{(team?.name ?? fallback).slice(0, 1).toUpperCase()}</span><div><strong>{team?.name ?? fallback}</strong><small>{team?.players?.length ?? 0} rostered players</small></div><b>{points(team?.points)}</b></div>;
}

function RosterView({ teams }: { teams: Team[] }) {
  return <div className="roster-view"><div className="view-intro"><p>ROSTER SNAPSHOTS</p><span>{teams.length} {teams.length === 1 ? "team" : "teams"}</span></div>{teams.length ? <div className="roster-grid">{teams.map((team) => <details className="roster-card" key={team.id} open={teams.length === 1}><summary><span className="team-avatar">{team.name.slice(0, 1).toUpperCase()}</span><span><strong>{team.name}</strong><small>{team.players?.length ?? 0} players</small></span><b>{points(team.points)} <em>pts</em></b></summary><div className="roster-table-wrap">{team.players?.length ? <table className="roster-table"><thead><tr><th scope="col">Player</th><th scope="col">Slot</th><th scope="col">Points</th><th scope="col">Stats</th></tr></thead><tbody>{team.players.map((player) => <PlayerRow key={player.id} player={player} />)}</tbody></table> : <p className="roster-empty">No players in this snapshot.</p>}</div></details>)}</div> : <div className="empty-inline"><span>◌</span><div><strong>No roster data in this snapshot</strong><p>Refresh the league after the provider has returned its team list.</p></div></div>}</div>;
}

function PlayerRow({ player }: { player: Player }) {
  const stats = Object.entries(player.stats ?? {});
  return <tr><td><strong>{player.name}</strong><small>{player.position}</small></td><td>{player.slot || "—"}</td><td className="player-points">{points(player.points)}</td><td>{stats.length ? <details className="player-stats"><summary>View</summary><dl>{stats.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{String(value)}</dd></div>)}</dl></details> : <span className="muted-dash">—</span>}</td></tr>;
}

function EmptyLeague({ onAdd }: { onAdd: () => void }) {
  return <div className="empty-league"><div className="empty-orbit" aria-hidden="true"><span>✦</span></div><p className="eyebrow">A clean slate</p><h3>No league snapshots yet.</h3><p>Connect ESPN or Yahoo above, or add a league ID manually. Your dashboard will stay empty until you choose a source.</p><button className="button button-primary" type="button" onClick={onAdd}>+ Add a league</button></div>;
}

function LoadingDashboard() {
  return <main className="dashboard-loading"><Wordmark compact /><div className="loading-spinner" aria-label="Loading dashboard" role="status" /><p>Opening your dashboard…</p></main>;
}

function DashboardError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <main className="dashboard-loading dashboard-error-state"><Wordmark compact /><div className="empty-orbit" aria-hidden="true"><span>!</span></div><h1>We couldn’t open your dashboard.</h1><p>{message}</p><div><button className="button button-primary" type="button" onClick={onRetry}>Try again</button><a className="text-link" href="/login">Sign in</a></div></main>;
}
