"use client";

import { useEffect, useMemo, useState } from "react";
import type { LeagueSnapshot } from "@/lib/types";
import { nflTeamLogoUrl, parseNflPlays, parseNflScoreboard, type NflGame, type NflPlay } from "@/lib/nfl";
import { startersInGame, startersMentioned } from "@/lib/nfl-highlights";

const ESPN = "https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/";
const REFRESH_MS = 15_000;

function gameStatus(game: NflGame) {
  if (game.state === "final") return "Final";
  if (game.state === "live") return game.period && game.period > 4 ? `OT ${game.clock ?? ""}` : `Q${game.period ?? "?"} ${game.clock ?? ""}`;
  return game.date ? new Date(game.date).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }) : "Scheduled";
}

function playTime(play: NflPlay) {
  const gameClock = play.period ? `${play.period > 4 ? "OT" : `Q${play.period}`} ${play.clock ?? ""}` : "";
  const wallClock = play.timestamp ? new Date(play.timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
  return [gameClock, wallClock].filter(Boolean).join(" · ");
}

async function espnJson(path: string, signal: AbortSignal) {
  const response = await fetch(`${ESPN}${path}`, { credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store", signal });
  if (!response.ok) throw new Error("ESPN scores are unavailable.");
  return response.json() as Promise<unknown>;
}

export function NflDrawer({ leagues, onClose }: { leagues: LeagueSnapshot[]; onClose: () => void }) {
  const [games, setGames] = useState<NflGame[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [plays, setPlays] = useState<NflPlay[]>([]);
  const [scoresError, setScoresError] = useState(false);
  const [playsError, setPlaysError] = useState(false);
  const [loadingScores, setLoadingScores] = useState(true);
  const [loadingPlays, setLoadingPlays] = useState(false);
  const [showPlayers, setShowPlayers] = useState(false);
  const selectedGame = games.find((game) => game.id === selected);
  const selectedStarters = useMemo(() => selectedGame ? startersInGame(leagues, selectedGame) : [], [leagues, selectedGame]);
  const orderedGames = [...games].sort((a, b) => {
    const rank = (game: NflGame) => game.state === "live" ? 0 : game.state === "scheduled" ? 1 : 2;
    return rank(a) - rank(b) || Date.parse(a.date ?? "") - Date.parse(b.date ?? "") || a.id.localeCompare(b.id);
  });

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let inFlight = false;
    let hasLiveGame = false;
    const refresh = async () => {
      if (document.visibilityState !== "visible" || inFlight) return;
      inFlight = true;
      try {
        const nextGames = parseNflScoreboard(await espnJson("scoreboard", controller.signal));
        setGames(nextGames);
        hasLiveGame = nextGames.some((game) => game.state === "live");
        setScoresError(false);
      } catch {
        if (!controller.signal.aborted) setScoresError(true);
      } finally {
        inFlight = false;
        if (!controller.signal.aborted) { setLoadingScores(false); if (hasLiveGame) timer = setTimeout(() => void refresh(), REFRESH_MS); }
      }
    };
    const resume = () => {
      if (document.visibilityState === "visible") { clearTimeout(timer); void refresh(); }
    };
    document.addEventListener("visibilitychange", resume);
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); document.removeEventListener("visibilitychange", resume); };
  }, []);

  useEffect(() => {
    if (!selected) return;
    const isLive = selectedGame?.state === "live";
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let inFlight = false;
    setPlays([]);
    setLoadingPlays(true);
    const refresh = async () => {
      if (document.visibilityState !== "visible" || inFlight) return;
      inFlight = true;
      try {
        setPlays(parseNflPlays(await espnJson(`summary?event=${encodeURIComponent(selected)}`, controller.signal)));
        setPlaysError(false);
      } catch {
        if (!controller.signal.aborted) setPlaysError(true);
      } finally {
        inFlight = false;
        if (!controller.signal.aborted) { setLoadingPlays(false); if (isLive) timer = setTimeout(() => void refresh(), REFRESH_MS); }
      }
    };
    const resume = () => {
      if (document.visibilityState === "visible") { clearTimeout(timer); void refresh(); }
    };
    document.addEventListener("visibilitychange", resume);
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); document.removeEventListener("visibilitychange", resume); };
  }, [selected, selectedGame?.state]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return <aside className="nfl-drawer" id="nfl-drawer" aria-label="NFL scores">
    <header className="nfl-drawer-head"><div><h2>Live Scores</h2></div><button className="nfl-vertical-button" type="button" aria-label="Close NFL scores" aria-controls="nfl-drawer" aria-expanded={true} onClick={onClose} autoFocus><span>NFL</span><b aria-hidden="true">‹</b></button></header>
    <div className="nfl-drawer-legend"><label><input type="checkbox" checked={showPlayers} onChange={(event) => setShowPlayers(event.target.checked)} /> Show players</label>{showPlayers ? <div className="nfl-drawer-key"><span className="nfl-you">Your starter</span><span className="nfl-opponent">Opponent starter</span><span className="nfl-both">Both across leagues</span></div> : null}</div>
    {scoresError ? <p className="nfl-drawer-message" role="status">NFL scores are temporarily unavailable.</p> : null}
    {loadingScores ? <p className="nfl-drawer-message" role="status">Loading NFL games…</p> : !games.length ? <p className="nfl-drawer-message">No NFL games are scheduled this week.</p> : null}
    <div className="nfl-drawer-games">
      {orderedGames.map((game) => {
        const starters = startersInGame(leagues, game);
        const open = selected === game.id;
        return <section className={`nfl-game${open ? " is-open" : ""}`} key={game.id}>
          <button className="nfl-game-button" type="button" aria-expanded={open} onClick={() => setSelected(open ? null : game.id)}>
            <span className={`nfl-game-status${game.state === "live" ? " is-live" : ""}`}>{gameStatus(game)}</span>
            <span className="nfl-game-score"><span className="nfl-game-team"><img src={nflTeamLogoUrl(game.awayTeam)} alt="" /><span>{game.awayName}</span></span><strong>{game.state === "scheduled" ? "–" : game.awayScore ?? "–"}</strong><span className="nfl-game-team"><img src={nflTeamLogoUrl(game.homeTeam)} alt="" /><span>{game.homeName}</span></span><strong>{game.state === "scheduled" ? "–" : game.homeScore ?? "–"}</strong></span>
            {showPlayers && starters.length ? <span className="nfl-game-starters">{starters.map((player) => <span className={`nfl-${player.side}`} key={`${player.nflTeam}:${player.name}`}>{player.name}</span>)}</span> : null}
          </button>
          {open ? <div className="nfl-game-plays" aria-label={`Recent plays for ${game.awayTeam} at ${game.homeTeam}`}>
            <h3>Recent plays</h3>
            {playsError ? <p className="nfl-drawer-message" role="status">Plays are temporarily unavailable.</p> : null}
            {loadingPlays ? <p className="nfl-drawer-message">Loading plays…</p> : !plays.length ? <p className="nfl-drawer-message">No plays yet.</p> : <ol>{plays.map((play) => {
              const mentioned = startersMentioned(play.text, selectedStarters);
              let offset = 0;
              const text = mentioned.flatMap((player) => {
                const before = play.text.slice(offset, player.start);
                offset = player.end;
                return [before, <strong className={`nfl-${player.side}`} key={player.start}>{play.text.slice(player.start, player.end)}</strong>];
              });
              return <li key={play.id}><time>{playTime(play)}</time><span>{text}{play.text.slice(offset)}</span></li>;
            })}</ol>}
          </div> : null}
        </section>;
      })}
    </div>
  </aside>;
}
