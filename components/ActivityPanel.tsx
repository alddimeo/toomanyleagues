"use client";

import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import type { LeagueSnapshot } from "@/lib/types";
import { parseNflPlays, parseNflScoreboard, type NflGame, type NflPlay } from "@/lib/nfl";
import { matchupPlays, startersInGame, type HighlightedStarter } from "@/lib/nfl-highlights";
import { parseBlueskyFeed, type BlueskyMedia, type BlueskyPost, type BlueskySource } from "@/lib/bluesky";

const ESPN = "https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/";
const REFRESH_MS = 15_000;
const BLUESKY = "https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed";
const NEWS_REFRESH_MS = 60_000;
const SOURCES: BlueskySource[] = [
  { label: "Ian Rapoport", actor: "rapsheet.bsky.social" },
  { label: "ESPN", actor: "espn.com" },
  { label: "NFL wire", actor: "nflnewsposter.bsky.social", unofficial: true },
];
const FEEDS = [{ key: "plays", label: "Plays" }, ...SOURCES.map(({ actor, label }) => ({ key: actor, label }))];
const MIN_WIDTH = 320;
const DEFAULT_WIDTH = 320;
const widthLimit = () => Math.max(MIN_WIDTH, Math.min(900, (typeof window === "undefined" ? 1416 : window.innerWidth) - 656));
const clampWidth = (width: number) => Math.min(widthLimit(), Math.max(MIN_WIDTH, width));

type ActivityPlay = { game: NflGame; play: NflPlay; players: (HighlightedStarter & { start: number; end: number })[] };

async function espnJson(path: string, signal: AbortSignal) {
  const response = await fetch(`${ESPN}${path}`, { credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store", signal });
  if (!response.ok) throw new Error("ESPN activity is unavailable.");
  return response.json() as Promise<unknown>;
}

function playTime(play: NflPlay) {
  const gameClock = play.period ? `${play.period > 4 ? "OT" : `Q${play.period}`} ${play.clock ?? ""}` : "";
  const wallClock = play.timestamp ? new Date(play.timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
  return [gameClock, wallClock].filter(Boolean).join(" · ");
}

function BlueskyVideo({ media }: { media: Extract<BlueskyMedia, { type: "video" }> }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    if (element.canPlayType("application/vnd.apple.mpegurl")) { element.src = media.playlist; return; }
    if (!Hls.isSupported()) return;
    const player = new Hls();
    player.loadSource(media.playlist);
    player.attachMedia(element);
    return () => player.destroy();
  }, [media.playlist]);
  return <video ref={video} controls playsInline preload="metadata" poster={media.thumbnail} aria-label="Bluesky video" />;
}

function ActivityDrawer({ leagues, onClose }: { leagues: LeagueSnapshot[]; onClose: () => void }) {
  const [plays, setPlays] = useState<ActivityPlay[]>([]);
  const [posts, setPosts] = useState<BlueskyPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [newsLoading, setNewsLoading] = useState(true);
  const [newsError, setNewsError] = useState(false);
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() => Object.fromEntries(FEEDS.map(({ key }) => [key, true])));

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let inFlight = false;
    let hasLiveGame = false;
    const refresh = async () => {
      if (document.visibilityState !== "visible" || inFlight) return;
      inFlight = true;
      try {
        const games = parseNflScoreboard(await espnJson("scoreboard", controller.signal));
        const relevant = games.map((game) => ({ game, starters: startersInGame(leagues, game) })).filter(({ game, starters }) => starters.length && game.state !== "scheduled");
        hasLiveGame = relevant.some(({ game }) => game.state === "live");
        const results = await Promise.allSettled(relevant.map(async ({ game, starters }) => matchupPlays(parseNflPlays(await espnJson(`summary?event=${encodeURIComponent(game.id)}`, controller.signal)), starters).map((item) => ({ game, ...item }))));
        setPlays(results.flatMap((result) => result.status === "fulfilled" ? result.value : []).sort((a, b) => Date.parse(b.play.timestamp ?? "") - Date.parse(a.play.timestamp ?? "")).slice(0, 30));
        setError(results.length > 0 && results.every((result) => result.status === "rejected"));
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        inFlight = false;
        if (!controller.signal.aborted) { setLoading(false); if (hasLiveGame) timer = setTimeout(() => void refresh(), REFRESH_MS); }
      }
    };
    const resume = () => { if (document.visibilityState === "visible") { clearTimeout(timer); void refresh(); } };
    document.addEventListener("visibilitychange", resume);
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); document.removeEventListener("visibilitychange", resume); };
  }, [leagues]);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      if (document.visibilityState !== "visible") return;
      const results = await Promise.allSettled(SOURCES.map(async (source) => {
        const url = new URL(BLUESKY);
        url.searchParams.set("actor", source.actor);
        url.searchParams.set("filter", "posts_no_replies");
        url.searchParams.set("limit", "12");
        const response = await fetch(url, { cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", signal: controller.signal });
        if (!response.ok) throw new Error("Bluesky feed unavailable");
        return parseBlueskyFeed(await response.json() as unknown, source);
      }));
      if (!controller.signal.aborted) {
        setPosts(results.flatMap((result) => result.status === "fulfilled" ? result.value : []));
        setNewsError(results.every((result) => result.status === "rejected"));
        setNewsLoading(false);
        timer = setTimeout(() => void refresh(), NEWS_REFRESH_MS);
      }
    };
    const resume = () => { if (document.visibilityState === "visible") { clearTimeout(timer); void refresh(); } };
    document.addEventListener("visibilitychange", resume);
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); document.removeEventListener("visibilitychange", resume); };
  }, []);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const items = [
    ...(enabled.plays ? plays.map((item) => ({ kind: "play" as const, at: item.play.timestamp ?? item.game.date ?? "", item })) : []),
    ...posts.filter((item) => enabled[item.actor]).map((item) => ({ kind: "post" as const, at: item.createdAt, item })),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 50);

  return <aside className="activity-drawer" id="activity-drawer" aria-label="Activity feed">
    <header className="activity-drawer-head"><button className="activity-vertical-button" type="button" aria-label="Close activity feed" aria-controls="activity-drawer" aria-expanded={true} onClick={onClose} autoFocus><span>FEED</span><b aria-hidden="true">›</b></button><h2>Activity Feed</h2></header>
    <div className="activity-feed-toggles" aria-label="Activity feed sources">{FEEDS.map(({ key, label }) => <button type="button" aria-pressed={enabled[key]} key={key} onClick={() => setEnabled((current) => ({ ...current, [key]: !current[key] }))}>{label}</button>)}</div>
    <div className="activity-drawer-body">
      <section className="activity-feed" aria-labelledby="activity-feed-title">
        <div className="activity-section-head"><h3 id="activity-feed-title">Latest updates</h3></div>
        {error ? <p className="activity-message" role="status">Player plays are temporarily unavailable.</p> : null}
        {newsError ? <p className="activity-message" role="status">NFL news is temporarily unavailable.</p> : null}
        {loading || newsLoading ? <p className="activity-message" role="status">Loading activity…</p> : !items.length ? <p className="activity-message">No activity yet.</p> : null}
        {items.length ? <ol className="activity-list">{items.map((entry) => {
          if (entry.kind === "post") return <li className="activity-post" key={`post-${entry.item.actor}-${entry.item.id}`}><article><header>{entry.item.avatar ? <img src={entry.item.avatar} alt="" loading="lazy" /> : <span className="activity-avatar-fallback" aria-hidden="true">{entry.item.displayName[0]}</span>}<div><a href={entry.item.url} target="_blank" rel="noopener noreferrer"><strong>{entry.item.displayName}</strong><span>@{entry.item.actor}</span></a><time>{new Date(entry.item.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time></div></header><a className="activity-post-text" href={entry.item.url} target="_blank" rel="noopener noreferrer">{entry.item.text}</a>{entry.item.media.length ? <div className={`activity-media activity-media-${entry.item.media.length}`}>{entry.item.media.map((media, index) => media.type === "image" ? <a href={entry.item.url} target="_blank" rel="noopener noreferrer" key={`${media.url}-${index}`}><img src={media.url} alt={media.alt} loading="lazy" /></a> : <BlueskyVideo media={media} key={media.playlist} />)}</div> : null}</article></li>;
          const { game, play, players } = entry.item;
          let offset = 0;
          const highlighted = players.flatMap((player) => {
            const before = play.text.slice(offset, player.start);
            offset = player.end;
            return [before, <strong className={`nfl-${player.side}`} key={`${play.id}-${player.start}`}>{play.text.slice(player.start, player.end)}</strong>];
          });
          return <li className="activity-play" key={`play-${game.id}-${play.id}`}><time>PLAY · {game.awayTeam} @ {game.homeTeam} · {playTime(play)}</time><span>{highlighted}{play.text.slice(offset)}</span></li>;
        })}</ol> : null}
        <p className="activity-sources">News from verified Rapoport and ESPN Bluesky feeds, plus an unofficial NFL wire that republishes Schefter reports.</p>
      </section>
    </div>
  </aside>;
}

export function ActivityPanel({ leagues }: { leagues: LeagueSnapshot[] }) {
  const [open, setOpen] = useState(false);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const launch = useRef<HTMLButtonElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const dragging = useRef<number | null>(null);

  useEffect(() => {
    setOpen(localStorage.getItem("activity-panel-open") === "true");
    setWidth(clampWidth(Number(localStorage.getItem("activity-panel-width")) || DEFAULT_WIDTH));
    const fit = () => setWidth((current) => clampWidth(current));
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  useEffect(() => {
    const shell = host.current?.parentElement;
    shell?.style.setProperty("--activity-panel-width", `${width}px`);
    shell?.classList.toggle("has-activity-drawer", open);
    shell?.classList.toggle("has-activity-launch", !open);
    return () => shell?.classList.remove("has-activity-drawer", "has-activity-launch");
  }, [open, width]);

  const toggle = (next: boolean) => {
    localStorage.setItem("activity-panel-open", String(next));
    setOpen(next);
    if (!next) requestAnimationFrame(() => launch.current?.focus());
  };
  const resize = (clientX: number) => {
    dragging.current = clampWidth(window.innerWidth - clientX);
    host.current?.parentElement?.style.setProperty("--activity-panel-width", `${dragging.current}px`);
  };
  const finishResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragging.current === null) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setWidth(dragging.current);
    localStorage.setItem("activity-panel-width", String(dragging.current));
    dragging.current = null;
  };
  const nudge = (next: number) => {
    const value = clampWidth(next);
    setWidth(value);
    localStorage.setItem("activity-panel-width", String(value));
  };

  return <div ref={host} className="activity-panel">
    {open ? <><ActivityDrawer leagues={leagues} onClose={() => toggle(false)} /><div className="activity-resize-handle" role="separator" aria-label="Resize activity feed" aria-orientation="vertical" aria-valuemin={MIN_WIDTH} aria-valuemax={widthLimit()} aria-valuenow={width} tabIndex={0} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); resize(event.clientX); }} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) resize(event.clientX); }} onPointerUp={finishResize} onPointerCancel={finishResize} onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); nudge(width + (event.key === "ArrowLeft" ? 16 : -16)); } }} /></> : <button ref={launch} className="activity-vertical-button" type="button" aria-label="Open activity feed" aria-controls="activity-drawer" aria-expanded={false} onClick={() => toggle(true)}><span>FEED</span><b aria-hidden="true">‹</b></button>}
  </div>;
}
