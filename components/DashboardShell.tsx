"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { LeagueSnapshot, Provider } from "@/lib/types";
import { Wordmark } from "@/components/Wordmark";
import { MatchupGrid } from "@/components/LeagueViews";
import { NflDrawer } from "@/components/NflDrawer";

type Connection = { provider: Provider; status: string };
type DashboardData = {
  user: { email: string };
  connections: Connection[];
  leagues: LeagueSnapshot[];
  configured: { espn: boolean; yahoo: boolean };
};
type Notice = { kind: "error" | "success" | "info"; text: string };
type LeagueOption = { id: string; name: string; season: number };
type ImportFailure = LeagueOption & { error: string };
type LeaguePickerState = { provider: Provider; options: LeagueOption[]; selected: string[] };

const extensionStoreUrl = process.env.NEXT_PUBLIC_CHROME_EXTENSION_URL;
const LIVE_INTERVAL_MS = 30_000;
const PANEL_MIN_WIDTH = 320;
const PANEL_DEFAULT_WIDTH = 390;
const panelWidthLimit = () => Math.max(PANEL_MIN_WIDTH, Math.min(900, (typeof window === "undefined" ? 1416 : window.innerWidth) - 656));
const clampPanelWidth = (width: number) => Math.min(panelWidthLimit(), Math.max(PANEL_MIN_WIDTH, width));

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

function normalizeLeagueOptions(value: unknown, field: "leagues" | "availableLeagues"): LeagueOption[] {
  if (!isRecord(value) || !Array.isArray(value[field])) return [];
  return value[field].filter(isRecord).filter((item) => typeof item.id === "string" && typeof item.name === "string" && typeof item.season === "number" && Number.isInteger(item.season)).map((item) => ({ id: item.id as string, name: item.name as string, season: item.season as number }));
}

function optionKey(option: Pick<LeagueOption, "id" | "season">) {
  return `${option.id}:${option.season}`;
}

function prettyProvider(provider: Provider) {
  return provider === "espn" ? "ESPN" : "Yahoo";
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
  if (response.status === 503) return "Live scoring is temporarily unavailable.";
  return fallback;
}

function providerStatus(data: DashboardData, provider: Provider) {
  const connection = data.connections.find((item) => item.provider === provider);
  if (connection) return connection.status || "Connected";
  return data.configured[provider] ? "Ready to connect" : "Setup needed";
}

export function DashboardShell({ focus = "overview" }: { focus?: "overview" | "settings" | "help" }) {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const hasData = data !== null;
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [liveState, setLiveState] = useState("Connecting to live scores");
  const [compact, setCompact] = useState(false);
  const [nflOpen, setNflOpen] = useState(false);
  const [panelWidth, setPanelWidth] = useState(PANEL_DEFAULT_WIDTH);
  const dashboardShell = useRef<HTMLDivElement>(null);
  const draggingWidth = useRef<number | null>(null);
  const nflButton = useRef<HTMLButtonElement>(null);
  const compactBeforeNfl = useRef(false);
  const closeNfl = useCallback(() => { setCompact(compactBeforeNfl.current); setNflOpen(false); requestAnimationFrame(() => nflButton.current?.focus()); }, []);
  const toggleNfl = () => {
    if (nflOpen) return closeNfl();
    compactBeforeNfl.current = compact;
    setCompact(true);
    setNflOpen(true);
  };
  useEffect(() => {
    const saved = Number(localStorage.getItem("nfl-panel-width"));
    setPanelWidth(clampPanelWidth(saved || PANEL_DEFAULT_WIDTH));
    const fitViewport = () => setPanelWidth((width) => clampPanelWidth(width));
    window.addEventListener("resize", fitViewport);
    return () => window.removeEventListener("resize", fitViewport);
  }, []);
  const resizePanel = (width: number) => {
    const next = clampPanelWidth(width);
    draggingWidth.current = next;
    dashboardShell.current?.style.setProperty("--nfl-panel-width", `${next}px`);
  };
  const finishResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const width = draggingWidth.current;
    if (width === null) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    draggingWidth.current = null;
    setPanelWidth(width);
    localStorage.setItem("nfl-panel-width", String(width));
  };
  const nudgePanel = (width: number) => {
    const next = clampPanelWidth(width);
    setPanelWidth(next);
    localStorage.setItem("nfl-panel-width", String(next));
  };
  const [connectionBusy, setConnectionBusy] = useState<Provider | null>(null);
  const [extensionReady, setExtensionReady] = useState(false);
  const [extensionPending, setExtensionPending] = useState<Provider | null>(null);
  const extensionRequest = useRef<{ id: string; provider: Provider } | null>(null);
  const [picker, setPicker] = useState<LeaguePickerState | null>(null);
  const [importing, setImporting] = useState(false);
  const [discovering, setDiscovering] = useState<Provider | null>(null);
  const refreshInFlight = useRef(false);
  const pollingPaused = useRef(false);

  const routeToLogin = useCallback(() => {
    router.replace("/login");
  }, [router]);

  const openPicker = useCallback((provider: Provider, options: LeagueOption[]) => {
    setPicker({ provider, options, selected: options.map(optionKey) });
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

  const refreshDashboard = useCallback(async () => {
    if (refreshInFlight.current || document.visibilityState !== "visible") return LIVE_INTERVAL_MS;
    refreshInFlight.current = true;
    setLiveState("Updating scores…");
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
        setLiveState("Live updates delayed");
        return Math.max(delay, LIVE_INTERVAL_MS);
      }
      if (response.status === 409) {
        const message = await safeApiMessage(response, "Your provider authorization expired. Reconnect the provider to continue.");
        pollingPaused.current = true;
        setLiveState("Updates paused");
        setNotice({ kind: "error", text: `${message} Reconnect from Settings to resume live updates.` });
        void loadDashboard(true);
        return 0;
      }
      if (!response.ok) {
        const message = await safeApiMessage(response, "We couldn’t update live scores.");
        setLiveState("Live updates delayed");
        setNotice({ kind: "error", text: `${message} Retrying automatically.` });
        return LIVE_INTERVAL_MS;
      }
      if (!setDashboard(await response.json())) throw new Error("refresh");
      const updated = `Updated ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
      pollingPaused.current = false;
      setNotice((current) => current?.kind === "error" ? null : current);
      setLiveState(updated);
      return LIVE_INTERVAL_MS;
    } catch {
      setLiveState("Live updates delayed");
      setNotice({ kind: "error", text: "We couldn’t update live scores. Retrying automatically." });
      return LIVE_INTERVAL_MS;
    } finally {
      refreshInFlight.current = false;
    }
  }, [loadDashboard, routeToLogin, setDashboard]);

  useEffect(() => {
    if (focus !== "overview" || loading || !hasData) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      if (cancelled || pollingPaused.current || document.visibilityState !== "visible") return;
      const delay = await refreshDashboard();
      if (!cancelled && !pollingPaused.current && delay !== 0) timer = setTimeout(() => void poll(), delay);
    };
    const resume = () => {
      if (document.visibilityState !== "visible") return;
      if (timer) clearTimeout(timer);
      pollingPaused.current = false;
      void poll();
    };
    document.addEventListener("visibilitychange", resume);
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [focus, hasData, loading, refreshDashboard]);

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

  const startExtension = useCallback((provider: Provider, openLogin = true) => {
    setExtensionPending(provider);
    if (!extensionReady) {
      setNotice({ kind: "info", text: "Install the Too Many Leagues Chrome connector, then reload this page to connect." });
      return;
    }
    setPicker(null);
    const id = crypto.randomUUID();
    extensionRequest.current = { id, provider };
    setConnectionBusy(provider);
    setNotice(null);
    window.postMessage({ source: "too-many-leagues-app", id, action: "connect", provider, openLogin }, location.origin);
  }, [extensionReady]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== location.origin || !isRecord(event.data) || event.data.source !== "too-many-leagues-connector") return;
      if (event.data.status === "available") { setExtensionReady(true); return; }
      const pending = extensionRequest.current;
      if (!pending || event.data.id !== pending.id) return;
      extensionRequest.current = null;
      setConnectionBusy(null);
      if (event.data.status === "login-required") {
        setNotice({ kind: "info", text: `Sign in to ${prettyProvider(pending.provider)} in the new tab, then return here. We’ll continue automatically.` });
        return;
      }
      if (event.data.status !== "connected") {
        const result = isRecord(event.data.result) ? event.data.result : {};
        if (result.status === 401) { routeToLogin(); return; }
        setNotice({ kind: "error", text: typeof result.error === "string" ? result.error : `Could not connect ${prettyProvider(pending.provider)}. Try again.` });
        return;
      }
      const options = normalizeLeagueOptions(event.data.result, "leagues");
      setExtensionPending(null);
      if (options.length) openPicker(pending.provider, options);
      setNotice({ kind: options.length ? "info" : "success", text: options.length ? `${prettyProvider(pending.provider)} connected. Choose which leagues to add.` : `${prettyProvider(pending.provider)} connected, but no leagues were found.` });
      void loadDashboard(true);
    };
    window.addEventListener("message", onMessage);
    window.postMessage({ source: "too-many-leagues-app", action: "ping", id: "ready" }, location.origin);
    return () => window.removeEventListener("message", onMessage);
  }, [loadDashboard, openPicker, routeToLogin]);

  useEffect(() => {
    if (!extensionPending || !extensionReady) return;
    const retry = () => { if (document.visibilityState === "visible" && !extensionRequest.current) startExtension(extensionPending, false); };
    document.addEventListener("visibilitychange", retry);
    return () => document.removeEventListener("visibilitychange", retry);
  }, [extensionPending, extensionReady, startExtension]);

  const importSelected = async () => {
    if (!picker) return;
    const selected = picker.options.filter((option) => picker.selected.includes(optionKey(option)));
    setImporting(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/${picker.provider}/import`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leagues: selected }),
        credentials: "same-origin",
      });
      if (response.status === 401) return routeToLogin();
      if (!response.ok) throw new Error(await safeApiMessage(response, `We couldn’t add those ${prettyProvider(picker.provider)} leagues.`));
      const value: unknown = await response.json();
      const imported = isRecord(value) && typeof value.imported === "number" ? value.imported : selected.length;
      const failed: ImportFailure[] = isRecord(value) && Array.isArray(value.failed) ? value.failed.filter(isRecord).filter((item) => typeof item.id === "string" && typeof item.name === "string" && typeof item.season === "number" && typeof item.error === "string").map((item) => ({ id: item.id as string, name: item.name as string, season: item.season as number, error: item.error as string })) : [];
      if (failed.length) {
        setPicker((current) => current ? { ...current, selected: failed.map(optionKey) } : null);
        setNotice({ kind: "error", text: `${imported ? `Added ${imported} league${imported === 1 ? "" : "s"}. ` : ""}Couldn’t load ${failed.map((item) => item.name).join(", ")}. ${failed[0].error} Try again.` });
        await loadDashboard(true);
        return;
      }
      setPicker(null);
      setNotice({ kind: "success", text: imported ? `Added ${imported} ${prettyProvider(picker.provider)} league${imported === 1 ? "" : "s"}.` : `No ${prettyProvider(picker.provider)} leagues added.` });
      await loadDashboard(true);
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : `We couldn’t add those ${prettyProvider(picker.provider)} leagues.` });
    } finally {
      setImporting(false);
    }
  };

  const discoverLeagues = async (provider: Provider) => {
    setDiscovering(provider);
    setNotice(null);
    try {
      const response = await fetch(`/api/${provider}/discover`, { method: "POST", credentials: "same-origin" });
      if (response.status === 401) return routeToLogin();
      if (response.status === 409) await loadDashboard(true);
      if (!response.ok) throw new Error(await safeApiMessage(response, `We couldn’t discover your ${prettyProvider(provider)} leagues.`));
      const leagues = normalizeLeagueOptions(await response.json(), provider === "espn" ? "availableLeagues" : "leagues");
      if (leagues.length) openPicker(provider, leagues);
      setNotice({ kind: "info", text: leagues.length ? `Choose which ${prettyProvider(provider)} leagues to add.` : `${prettyProvider(provider)} did not return any leagues for this account.` });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : `We couldn’t discover your ${prettyProvider(provider)} leagues.` });
    } finally {
      setDiscovering(null);
    }
  };

  if (loading && !data) return <LoadingDashboard />;
  if (loadError && !data) return <DashboardError message={loadError} onRetry={() => void loadDashboard()} />;
  if (!data) return <DashboardError message="Your dashboard data is unavailable. Please sign in again." onRetry={() => void loadDashboard()} />;

  return (
    <div ref={dashboardShell} className={`dashboard-shell${nflOpen ? " has-nfl-drawer" : focus === "overview" ? " has-nfl-launch" : ""}`} style={{ "--nfl-panel-width": `${panelWidth}px` } as CSSProperties}>
      <main className="dashboard-main" id="overview">
        <header className="dashboard-topbar">
          <Link href="/" className="dashboard-brand"><Wordmark /></Link>
          <nav className="dashboard-nav" aria-label="Dashboard sections">
            <Link href="/dashboard" className={`dashboard-nav-link${focus === "overview" ? " active" : ""}`}>Game center</Link>
            <Link href="/dashboard/settings" className={`dashboard-nav-link${focus === "settings" ? " active" : ""}`}>Settings</Link>
            <Link href="/dashboard/help" className={`dashboard-nav-link${focus === "help" ? " active" : ""}`}>Help</Link>
          </nav>
          <div className="dashboard-user"><span className="user-email">{data.user.email}</span><form action="/auth/logout" method="post"><button type="submit" className="mobile-signout">Sign out</button></form></div>
        </header>
        <div className="dashboard-content">
          <header className="dashboard-heading">
            <div>{focus !== "overview" ? <p className="eyebrow">{focus.toUpperCase()}</p> : null}<h1>{focus === "overview" ? "Matchups" : focus === "settings" ? "Settings" : "Help"}</h1></div>
            {focus === "overview" ? <div className="dashboard-heading-actions"><span className={`dashboard-live-status${liveState === "Updates paused" ? " is-paused" : ""}`} role="status"><b className="status-dot" /> {liveState}</span><button className="compact-view-toggle" type="button" aria-pressed={compact} onClick={() => setCompact((value) => !value)}>Compact View {compact ? "On" : "Off"}</button></div> : null}
          </header>

          {notice && !extensionPending && !picker ? <div className={`dashboard-notice notice-${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}><span aria-hidden="true">{notice.kind === "error" ? "!" : notice.kind === "success" ? "✓" : "i"}</span>{notice.text}<button type="button" aria-label="Dismiss message" onClick={() => setNotice(null)}>×</button></div> : null}

          {focus === "overview" ? <div className={`dashboard-game-layout${nflOpen ? " has-drawer" : ""}`}>{nflOpen ? <><NflDrawer leagues={data.leagues} onClose={closeNfl} /><div className="nfl-resize-handle" role="separator" aria-label="Resize NFL scores" aria-orientation="vertical" aria-valuemin={PANEL_MIN_WIDTH} aria-valuemax={panelWidthLimit()} aria-valuenow={panelWidth} tabIndex={0} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); resizePanel(event.clientX); }} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) resizePanel(event.clientX); }} onPointerUp={finishResize} onPointerCancel={finishResize} onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); nudgePanel(panelWidth + (event.key === "ArrowRight" ? 16 : -16)); } }} /></> : null}<section className="dashboard-matchups" aria-label="League matchups"><MatchupGrid leagues={data.leagues} personalOnly compact={compact} /></section></div> : focus === "help" ? <section className="help-faq" aria-labelledby="help-title"><h2 id="help-title">Frequently asked questions</h2>
            <details open><summary>What is the smaller number beneath a score?</summary><p>It is the latest fantasy point projection supplied by your connected provider. A dash means that provider has not supplied one.</p></details>
            <details><summary>What do the green and red changes mean?</summary><p>Green means the current projection is higher than the saved pregame projection; red means it is lower. The number shows the change in fantasy points.</p></details>
            <details><summary>Why is there no colored change for my league?</summary><p>We can save a pregame comparison only when a league is connected and projections are available before the first NFL game of the week starts. Leagues connected later still show available live projections, without a comparison for that week.</p></details>
            <details><summary>Why is win chance missing?</summary><p>Win chance appears only when your fantasy provider supplies a matchup percentage. We do not calculate our own odds.</p></details>
          </section> : <section className="connection-area" aria-labelledby="connections-title">
            <div className="section-heading-row"><h2 id="connections-title">Connections</h2><span className="section-caption">{data.connections.length} connected</span></div>
            <p className="connection-disclosure">Manage the provider accounts used for live scoring.</p>
            <div className="connection-grid">
              <ConnectionCard provider="espn" configured={data.configured.espn} status={providerStatus(data, "espn")} busy={connectionBusy === "espn" || discovering === "espn"} onConnect={() => startExtension("espn")} onDisconnect={() => void disconnect("espn")} onDiscover={() => void discoverLeagues("espn")} connected={Boolean(data.connections.some((item) => item.provider === "espn"))} reconnect={providerStatus(data, "espn").toLowerCase() === "reconnect"} />
              <ConnectionCard provider="yahoo" configured={data.configured.yahoo} status={providerStatus(data, "yahoo")} busy={connectionBusy === "yahoo" || discovering === "yahoo"} onConnect={() => startExtension("yahoo")} onDisconnect={() => void disconnect("yahoo")} onDiscover={() => void discoverLeagues("yahoo")} connected={Boolean(data.connections.some((item) => item.provider === "yahoo"))} reconnect={providerStatus(data, "yahoo").toLowerCase() === "reconnect"} />
            </div>
          </section>}

          {extensionPending ? <div className="espn-modal-backdrop"><section className={`espn-modal provider-${extensionPending}`} role="dialog" aria-modal="true" aria-labelledby="connector-panel-title"><div className="espn-modal-head"><div><p className="eyebrow">CHROME CONNECTOR</p><h2 id="connector-panel-title">Connect {prettyProvider(extensionPending)}</h2></div><button className="icon-button" type="button" aria-label="Close connection instructions" onClick={() => { setExtensionPending(null); extensionRequest.current = null; setConnectionBusy(null); }}>×</button></div><p className="espn-modal-copy">{connectionBusy ? `Checking your ${prettyProvider(extensionPending)} account…` : extensionReady ? notice?.kind === "info" ? notice.text : `Sign in to ${prettyProvider(extensionPending)} in the provider tab if needed. Return here when you’re done; we’ll finish connecting automatically.` : "Install the Too Many Leagues Chrome connector, then reload this page."}</p>{!extensionReady ? extensionStoreUrl ? <p className="espn-modal-copy"><a href={extensionStoreUrl} target="_blank" rel="noopener noreferrer">Install the Chrome connector ↗</a></p> : <p className="espn-modal-copy">Preview install: open <code>chrome://extensions</code>, turn on Developer mode, choose Load unpacked, and select the <code>extension</code> folder from this project.</p> : null}{notice?.kind === "error" ? <p className="espn-modal-error" role="alert">{notice.text}</p> : null}{extensionReady ? <div className="espn-modal-actions"><button type="button" className="button button-primary" onClick={() => startExtension(extensionPending, false)} disabled={connectionBusy !== null}>{connectionBusy ? "Checking…" : "I’ve signed in — connect"}</button></div> : null}</section></div> : null}

          {picker ? <LeaguePicker picker={picker} importing={importing} onToggle={(option) => { const key = optionKey(option); setPicker((current) => current ? { ...current, selected: current.selected.includes(key) ? current.selected.filter((item) => item !== key) : [...current.selected, key] } : null); }} onImport={() => void importSelected()} onClose={() => setPicker(null)} error={notice?.kind === "error" ? notice.text : null} /> : null}

        </div>
      </main>
      {focus === "overview" && !nflOpen ? <button ref={nflButton} className="nfl-vertical-button" type="button" aria-label="Open NFL scores" aria-controls="nfl-drawer" aria-expanded={false} onClick={toggleNfl}><span>NFL</span><b aria-hidden="true">›</b></button> : null}
    </div>
  );
}

function ConnectionCard({ provider, configured, status, connected, reconnect, busy, onConnect, onDisconnect, onDiscover }: { provider: Provider; configured: boolean; status: string; connected: boolean; reconnect: boolean; busy: boolean; onConnect: () => void; onDisconnect: () => void; onDiscover: () => void }) {
  const label = prettyProvider(provider);
  return <article className={`connection-card connection-${provider}`}><div className="connection-card-top"><span className={`connection-logo provider-${provider}`}>{providerInitial(provider)}</span><span className={`connection-status${connected && !reconnect ? " connected" : ""}`}><b /> {status}</span></div><h3>{label}</h3><p>{reconnect ? "Authorization expired. Reconnect to keep this provider current." : connected ? "Discover more leagues from this account." : configured ? "Connect a provider account to pull in league data." : "Provider setup is missing for this private prototype."}</p><div className={`connection-card-actions${connected ? " connection-actions-connected" : ""}`}>{connected && !reconnect ? <><button className="text-button discover-button" type="button" onClick={onDiscover} disabled={busy}>{busy ? "Discovering…" : "Discover leagues"}</button><button className="text-button danger-button" type="button" onClick={onDisconnect} disabled={busy}>{busy ? "Disconnecting…" : "Disconnect"}</button></> : reconnect ? <><button className="button button-small button-dark" type="button" onClick={onConnect} disabled={!configured || busy}>{busy ? "Opening…" : configured ? `Reconnect ${label} ↗` : "Unavailable"}</button><button className="text-button danger-button" type="button" onClick={onDisconnect} disabled={busy}>Disconnect</button></> : provider === "yahoo" ? <button className="button button-small button-dark" type="button" onClick={onConnect} disabled={!configured || busy}>{busy ? "Opening…" : configured ? "Connect Yahoo ↗" : "Unavailable"}</button> : <button className="button button-small button-dark" type="button" onClick={onConnect} disabled={!configured || busy}>{busy ? "Opening…" : configured ? "Connect ESPN ↗" : "Unavailable"}</button>}</div></article>;
}

function LeaguePicker({ picker, importing, onToggle, onImport, onClose, error }: { picker: LeaguePickerState; importing: boolean; onToggle: (option: LeagueOption) => void; onImport: () => void; onClose: () => void; error: string | null }) {
  const label = prettyProvider(picker.provider);
  return <div className="espn-modal-backdrop"><section className={`espn-modal provider-${picker.provider}`} role="dialog" aria-modal="true" aria-labelledby="league-picker-title"><div className="espn-modal-head"><div><p className="eyebrow">{label.toUpperCase()} LEAGUES</p><h2 id="league-picker-title">Choose leagues to add</h2></div><button className="icon-button" type="button" aria-label={`Skip ${label} league selection`} onClick={onClose} disabled={importing}>×</button></div><p className="espn-modal-copy">We found these leagues on your {label} account. Select the ones you want in Too Many Leagues.</p>{error ? <p className="espn-modal-error" role="alert">{error}</p> : null}<div className="espn-modal-list">{picker.options.map((option) => { const key = optionKey(option); return <label className="espn-modal-option" key={key}><input type="checkbox" checked={picker.selected.includes(key)} onChange={() => onToggle(option)} disabled={importing} /><span><strong>{option.name}</strong><small>{option.season} season · {option.id}</small></span></label>; })}</div><div className="espn-modal-actions"><button className="button button-primary" type="button" onClick={onImport} disabled={!picker.selected.length || importing}>{importing ? "Adding…" : `Add ${picker.selected.length} selected`}</button><button className="text-button" type="button" onClick={onClose} disabled={importing}>Skip for now</button></div></section></div>;
}

function LoadingDashboard() {
  return <main className="dashboard-loading"><Wordmark compact /><div className="loading-spinner" aria-label="Loading dashboard" role="status" /><p>Opening your dashboard…</p></main>;
}

function DashboardError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <main className="dashboard-loading dashboard-error-state"><Wordmark compact /><div className="empty-orbit" aria-hidden="true"><span>!</span></div><h1>We couldn’t open your dashboard.</h1><p>{message}</p><div><button className="button button-primary" type="button" onClick={onRetry}>Try again</button><a className="text-link" href="/login">Sign in</a></div></main>;
}
