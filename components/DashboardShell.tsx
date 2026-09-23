"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { LeagueSnapshot, Provider } from "@/lib/types";
import { Wordmark } from "@/components/Wordmark";
import { MatchupGrid } from "@/components/LeagueViews";

type Connection = { provider: Provider; status: string };
type DashboardData = {
  user: { email: string };
  connections: Connection[];
  leagues: LeagueSnapshot[];
  configured: { espn: boolean; yahoo: boolean };
};
type Notice = { kind: "error" | "success" | "info"; text: string };
type EspnSession = { liveUrl: string; expiresAt?: string };
type EspnLeagueOption = { id: string; name: string; season: number };
type EspnImportFailure = EspnLeagueOption & { error: string };
type YahooLeagueOption = { id: string; name: string; season: number };

const currentYear = new Date().getFullYear();

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

function normalizeEspnOptions(value: unknown, field: "leagues" | "availableLeagues"): EspnLeagueOption[] {
  if (!isRecord(value) || !Array.isArray(value[field])) return [];
  return value[field].filter(isRecord).filter((item) => typeof item.id === "string" && typeof item.name === "string" && typeof item.season === "number" && Number.isInteger(item.season)).map((item) => ({ id: item.id as string, name: item.name as string, season: item.season as number }));
}

function espnOptionKey(option: Pick<EspnLeagueOption, "id" | "season">) {
  return `${option.id}:${option.season}`;
}

function prettyProvider(provider: Provider) {
  return provider === "espn" ? "ESPN" : "Yahoo";
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

export function DashboardShell({ focus = "overview" }: { focus?: "overview" | "connections" }) {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
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
  const [espnOptions, setEspnOptions] = useState<EspnLeagueOption[]>([]);
  const [espnSelected, setEspnSelected] = useState<string[]>([]);
  const [espnImporting, setEspnImporting] = useState(false);
  const [yahooOptions, setYahooOptions] = useState<YahooLeagueOption[]>([]);
  const [yahooDiscovering, setYahooDiscovering] = useState(false);
  const [yahooImporting, setYahooImporting] = useState<string | null>(null);
  const refreshInFlight = useRef(false);
  const espnDiscoveryAttempted = useRef(false);

  const routeToLogin = useCallback(() => {
    setLiveMode(false);
    router.replace("/login");
  }, [router]);

  const openEspnPicker = useCallback((options: EspnLeagueOption[]) => {
    setEspnOptions(options);
    setEspnSelected(options.map(espnOptionKey));
  }, []);

  const setDashboard = useCallback((value: unknown) => {
    const next = normalizeDashboard(value);
    if (!next) return false;
    setData(next);
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
    if (focus !== "connections" || loading || !data) return;
    requestAnimationFrame(() => document.getElementById("connections")?.scrollIntoView({ block: "start" }));
  }, [data, focus, loading]);

  useEffect(() => {
    if (!data || espnDiscoveryAttempted.current) return;
    const connected = data.connections.some((item) => item.provider === "espn" && item.status.toLowerCase() !== "reconnect");
    if (!connected || data.leagues.some((league) => league.provider === "espn")) return;
    espnDiscoveryAttempted.current = true;
    void (async () => {
      try {
        const response = await fetch("/api/espn/discover", { method: "POST", credentials: "same-origin" });
        if (response.status === 401) return routeToLogin();
        if (response.status === 409) {
          setNotice({ kind: "error", text: await safeApiMessage(response, "Your ESPN authorization expired. Reconnect that account.") });
          await loadDashboard(true);
          return;
        }
        if (!response.ok) return;
        const value = await response.json();
        const next = normalizeDashboard(value);
        if (next) setDashboard(next);
        const options = normalizeEspnOptions(value, "availableLeagues");
        if (options.length) {
          openEspnPicker(options);
          setNotice({ kind: "info", text: "ESPN connected. Choose which leagues to add." });
        }
      } catch {
        // The connection remains usable; the next ESPN sign-in retries discovery.
      }
    })();
  }, [data, loadDashboard, openEspnPicker, routeToLogin, setDashboard]);

  useEffect(() => {
    const error = new URLSearchParams(window.location.search).get("error");
    if (error === "yahoo_scope") {
      setNotice({ kind: "error", text: "Yahoo Fantasy API access is not enabled for this app. Apply at sports.yahoo.com/developer/access, then try again." });
      window.history.replaceState({}, "", "/dashboard");
    } else if (error === "yahoo_connection") {
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
      const response = await fetch("/api/refresh", {
        method: "POST",
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
    setEspnOptions([]);
    setEspnSelected([]);
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
      const value: unknown = await response.json();
      const options = cancel ? [] : normalizeEspnOptions(value, "leagues");
      setEspnSession(null);
      setShowAddLeague(false);
      espnDiscoveryAttempted.current = true;
      if (options.length) {
        openEspnPicker(options);
        setNotice({ kind: "info", text: "ESPN connected. Choose which leagues to add." });
      } else setNotice({ kind: cancel ? "info" : "success", text: cancel ? "ESPN sign-in canceled." : "ESPN connected, but no leagues were found. You can use Add league ID as a fallback." });
      if (!cancel) await loadDashboard(true);
    } catch (error) {
      if (!cancel) setEspnSession(null);
      setNotice({ kind: "error", text: `${error instanceof Error ? error.message : "We couldn’t update the ESPN connection."}${cancel ? "" : " Open a new ESPN sign-in window to try again."}` });
    } finally {
      setEspnBusy(false);
    }
  };

  const importEspn = async () => {
    const selected = espnOptions.filter((option) => espnSelected.includes(espnOptionKey(option)));
    setEspnImporting(true);
    setNotice(null);
    try {
      const response = await fetch("/api/espn/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leagues: selected }),
        credentials: "same-origin",
      });
      if (response.status === 401) return routeToLogin();
      if (!response.ok) throw new Error(await safeApiMessage(response, "We couldn’t add those ESPN leagues."));
      const value: unknown = await response.json();
      const imported = isRecord(value) && typeof value.imported === "number" ? value.imported : selected.length;
      const failed: EspnImportFailure[] = isRecord(value) && Array.isArray(value.failed) ? value.failed.filter(isRecord).filter((item) => typeof item.id === "string" && typeof item.name === "string" && typeof item.season === "number" && typeof item.error === "string").map((item) => ({ id: item.id as string, name: item.name as string, season: item.season as number, error: item.error as string })) : [];
      if (failed.length) {
        setEspnSelected(failed.map(espnOptionKey));
        setNotice({ kind: "error", text: `${imported ? `Added ${imported} league${imported === 1 ? "" : "s"}. ` : ""}Couldn’t load ${failed.map((item) => item.name).join(", ")}. ${failed[0].error} Try again.` });
        await loadDashboard(true);
        return;
      }
      setEspnOptions([]);
      setEspnSelected([]);
      setNotice({ kind: "success", text: imported ? `Added ${imported} ESPN league${imported === 1 ? "" : "s"}.` : "No ESPN leagues added." });
      await loadDashboard(true);
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "We couldn’t add those ESPN leagues." });
    } finally {
      setEspnImporting(false);
    }
  };

  const skipEspn = () => {
    setEspnOptions([]);
    setEspnSelected([]);
    setNotice({ kind: "info", text: "No ESPN leagues added." });
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
      <main className="dashboard-main" id="overview">
        <header className="dashboard-topbar">
          <Link href="/" className="dashboard-brand"><Wordmark /></Link>
          <nav className="dashboard-nav" aria-label="Dashboard sections">
            <Link href="/dashboard" className={`dashboard-nav-link${focus === "overview" ? " active" : ""}`}>Game center</Link>
            <Link href="/dashboard/connections" className={`dashboard-nav-link${focus === "connections" ? " active" : ""}`}>Connections</Link>
          </nav>
          <div className="dashboard-user"><span className="preview-tag">PRIVATE PREVIEW</span><span className="user-email">{data?.user.email}</span><form action="/auth/logout" method="post"><button type="submit" className="mobile-signout">Sign out</button></form></div>
        </header>
        <div className="dashboard-content">
          <header className="dashboard-heading">
            <div><p className="eyebrow">LEAGUE OVERVIEW</p><h1>Your leagues</h1><p>Matchups, lineups, and live scoring.</p></div>
            <div className="dashboard-actions"><button className="button button-outline" type="button" onClick={() => void refreshDashboard()} disabled={refreshing}>{refreshing ? "Refreshing…" : "↻ Refresh"}</button><button className={`live-toggle${liveMode ? " is-on" : ""}`} type="button" aria-pressed={liveMode} onClick={() => setLiveMode((value) => !value)}><span className="live-toggle-dot" /> Live mode</button></div>
          </header>

          <section className="dashboard-matchups" aria-labelledby="dashboard-matchups-title"><div className="section-heading-row"><div><p className="eyebrow">YOUR LEAGUES</p><h2 id="dashboard-matchups-title">Your matchups</h2></div><span className="section-caption">{data.leagues.length} {data.leagues.length === 1 ? "league" : "leagues"} · {liveMode ? "LIVE REFRESH ON" : "SNAPSHOT VIEW"}</span></div><MatchupGrid leagues={data.leagues} personalOnly /></section>

          {notice ? <div className={`dashboard-notice notice-${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}><span aria-hidden="true">{notice.kind === "error" ? "!" : notice.kind === "success" ? "✓" : "i"}</span>{notice.text}<button type="button" aria-label="Dismiss message" onClick={() => setNotice(null)}>×</button></div> : null}

          <section className="connection-area" id="connections" aria-labelledby="connections-title">
            <div className="section-heading-row"><div><p className="eyebrow">SOURCES</p><h2 id="connections-title">Your connections</h2></div><span className="section-caption">{data?.connections.length ?? 0} connected</span></div>
            <div className="connection-grid">
              <ConnectionCard provider="espn" configured={data?.configured.espn === true} status={providerStatus(data!, "espn")} busy={connectionBusy === "espn" || espnBusy} onConnect={() => void startEspn()} onDisconnect={() => void disconnect("espn")} connected={Boolean(data?.connections.some((item) => item.provider === "espn"))} reconnect={providerStatus(data!, "espn").toLowerCase() === "reconnect"} />
              <ConnectionCard provider="yahoo" configured={data?.configured.yahoo === true} status={providerStatus(data!, "yahoo")} busy={connectionBusy === "yahoo" || yahooDiscovering} onConnect={() => { window.location.assign("/api/yahoo/connect"); }} onDisconnect={() => void disconnect("yahoo")} onDiscover={() => void discoverYahoo()} connected={Boolean(data?.connections.some((item) => item.provider === "yahoo"))} reconnect={providerStatus(data!, "yahoo").toLowerCase() === "reconnect"} />
            </div>
          </section>

          {yahooOptions.length ? <YahooPicker options={yahooOptions} importing={yahooImporting} onImport={(option) => void importYahoo(option)} onClose={() => setYahooOptions([])} /> : null}

          {espnSession ? <section className="espn-panel" aria-labelledby="espn-panel-title"><div className="espn-panel-head"><div><p className="eyebrow">HOSTED REMOTE BROWSER</p><h2 id="espn-panel-title">Connect ESPN</h2></div><button className="icon-button" type="button" aria-label="Close ESPN sign-in" onClick={() => void finishEspn(true)} disabled={espnBusy}>×</button></div><p className="espn-explanation">This window is a hosted remote browser showing ESPN’s sign-in page. Enter credentials only on ESPN’s page. Too Many Leagues does not capture or log your password. {formatExpiry(espnSession.expiresAt)}.</p><div className="espn-panel-actions"><button type="button" className="button button-primary" onClick={() => void finishEspn(false)} disabled={espnBusy}>{espnBusy ? "Checking…" : "I’m finished signing in — import leagues"}</button><button type="button" className="text-button" onClick={() => void finishEspn(true)} disabled={espnBusy}>Cancel</button></div><iframe className="espn-frame" title="Hosted ESPN sign-in" src={espnSession.liveUrl} sandbox="allow-forms allow-same-origin allow-scripts" referrerPolicy="no-referrer" /></section> : null}

          {espnOptions.length ? <EspnLeaguePicker options={espnOptions} selected={espnSelected} importing={espnImporting} onToggle={(option) => { const key = espnOptionKey(option); setEspnSelected((items) => items.includes(key) ? items.filter((item) => item !== key) : [...items, key]); }} onImport={() => void importEspn()} onClose={skipEspn} /> : null}

          <section className="leagues-area" aria-labelledby="leagues-title">
            <div className="section-heading-row"><div><p className="eyebrow">MANAGE LEAGUES</p><h2 id="leagues-title">Add a league manually</h2></div><button type="button" className="button button-outline button-small" onClick={() => setShowAddLeague((value) => !value)}>{showAddLeague ? "Close" : "+ Add league ID"}</button></div>
            {showAddLeague ? <form className="add-league-form" onSubmit={submitLeague}><div className="form-intro"><span className="form-icon">+</span><div><h3>Manual league ID fallback</h3><p>ESPN leagues are imported automatically after sign-in. Use this for a league that is not listed on your account page.</p></div></div><div className="form-fields"><label>Provider<select value={leagueProvider} onChange={(event) => setLeagueProvider(event.target.value as Provider)}><option value="espn">ESPN</option><option value="yahoo">Yahoo</option></select></label><label>League ID<input value={leagueId} onChange={(event) => setLeagueId(event.target.value)} placeholder="e.g. 12345678" autoComplete="off" /></label><label>Season<input value={season} onChange={(event) => setSeason(event.target.value)} inputMode="numeric" /></label><button className="button button-primary" type="submit" disabled={leagueBusy}>{leagueBusy ? "Adding…" : "Add league"}</button></div></form> : null}
          </section>

          <footer className="dashboard-footer"><span>{liveMode ? <><b className="status-dot" /> {liveState}</> : "Snapshots are shown from your last successful refresh."}</span><span>Too Many Leagues · private prototype</span></footer>
        </div>
      </main>
    </div>
  );
}

function ConnectionCard({ provider, configured, status, connected, reconnect, busy, onConnect, onDisconnect, onDiscover }: { provider: Provider; configured: boolean; status: string; connected: boolean; reconnect: boolean; busy: boolean; onConnect: () => void; onDisconnect: () => void; onDiscover?: () => void }) {
  const label = prettyProvider(provider);
  return <article className={`connection-card connection-${provider}`}><div className="connection-card-top"><span className={`connection-logo provider-${provider}`}>{providerInitial(provider)}</span><span className={`connection-status${connected && !reconnect ? " connected" : ""}`}><b /> {status}</span></div><h3>{label}</h3><p>{reconnect ? "Authorization expired. Reconnect to keep this provider current." : connected ? provider === "espn" ? "After sign-in, choose which ESPN leagues to add." : "Connected account can power your league snapshots." : configured ? "Connect a provider account to pull in league data." : "Provider setup is missing for this private prototype."}</p><div className={`connection-card-actions${connected ? " connection-actions-connected" : ""}`}>{connected && provider === "yahoo" && !reconnect && onDiscover ? <button className="text-button discover-button" type="button" onClick={onDiscover} disabled={busy}>{busy ? "Discovering…" : "Discover leagues"}</button> : null}{connected && !reconnect ? <button className="text-button danger-button" type="button" onClick={onDisconnect} disabled={busy}>{busy ? "Disconnecting…" : "Disconnect"}</button> : reconnect ? <><button className="button button-small button-dark" type="button" onClick={onConnect} disabled={!configured || busy}>{busy ? "Opening…" : configured ? `Reconnect ${label} ↗` : "Unavailable"}</button><button className="text-button danger-button" type="button" onClick={onDisconnect} disabled={busy}>Disconnect</button></> : provider === "yahoo" ? <button className="button button-small button-dark" type="button" onClick={onConnect} disabled={!configured || busy}>{busy ? "Opening…" : configured ? "Connect Yahoo ↗" : "Unavailable"}</button> : <button className="button button-small button-dark" type="button" onClick={onConnect} disabled={!configured || busy}>{busy ? "Opening…" : configured ? "Connect ESPN ↗" : "Unavailable"}</button>}</div></article>;
}

function YahooPicker({ options, importing, onImport, onClose }: { options: YahooLeagueOption[]; importing: string | null; onImport: (option: YahooLeagueOption) => void; onClose: () => void }) {
  return <section className="yahoo-picker" aria-labelledby="yahoo-picker-title"><div className="yahoo-picker-head"><div><p className="eyebrow">YAHOO LEAGUES</p><h2 id="yahoo-picker-title">Choose what to import</h2></div><button className="icon-button light-icon-button" type="button" aria-label="Close Yahoo league picker" onClick={onClose}>×</button></div><div className="yahoo-picker-list">{options.map((option) => <div className="yahoo-picker-row" key={`${option.id}-${option.season}`}><div><strong>{option.name}</strong><small>{option.season} season · {option.id}</small></div><button className="button button-small button-primary" type="button" onClick={() => onImport(option)} disabled={Boolean(importing)}>{importing === option.id ? "Importing…" : "Import"}</button></div>)}</div></section>;
}

function EspnLeaguePicker({ options, selected, importing, onToggle, onImport, onClose }: { options: EspnLeagueOption[]; selected: string[]; importing: boolean; onToggle: (option: EspnLeagueOption) => void; onImport: () => void; onClose: () => void }) {
  return <div className="espn-modal-backdrop"><section className="espn-modal" role="dialog" aria-modal="true" aria-labelledby="espn-picker-title"><div className="espn-modal-head"><div><p className="eyebrow">ESPN LEAGUES</p><h2 id="espn-picker-title">Choose leagues to add</h2></div><button className="icon-button" type="button" aria-label="Skip ESPN league selection" onClick={onClose} disabled={importing}>×</button></div><p className="espn-modal-copy">We found these leagues on your ESPN account. Select the ones you want in Too Many Leagues.</p><div className="espn-modal-list">{options.map((option) => { const key = espnOptionKey(option); return <label className="espn-modal-option" key={key}><input type="checkbox" checked={selected.includes(key)} onChange={() => onToggle(option)} disabled={importing} /><span><strong>{option.name}</strong><small>{option.season} season · {option.id}</small></span></label>; })}</div><div className="espn-modal-actions"><button className="button button-primary" type="button" onClick={onImport} disabled={!selected.length || importing}>{importing ? "Adding…" : `Add ${selected.length} selected`}</button><button className="text-button" type="button" onClick={onClose} disabled={importing}>Skip for now</button></div></section></div>;
}

function LoadingDashboard() {
  return <main className="dashboard-loading"><Wordmark compact /><div className="loading-spinner" aria-label="Loading dashboard" role="status" /><p>Opening your dashboard…</p></main>;
}

function DashboardError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <main className="dashboard-loading dashboard-error-state"><Wordmark compact /><div className="empty-orbit" aria-hidden="true"><span>!</span></div><h1>We couldn’t open your dashboard.</h1><p>{message}</p><div><button className="button button-primary" type="button" onClick={onRetry}>Try again</button><a className="text-link" href="/login">Sign in</a></div></main>;
}
