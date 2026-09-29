"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Player, Team } from "@/lib/types";
import { normalizeNflTeam, type NflGame } from "@/lib/nfl";
import { playerStatPoints, playerStatsWithDefaults } from "@/lib/player-stats";
import { teamProjectionState } from "@/lib/projections";
import { ProjectionValue } from "@/components/ProjectionValue";

type Scoreboard = { games: NflGame[] };
const scoreboardCache = new Map<string, { expiresAt: number; request: Promise<Scoreboard> }>();

function loadScoreboard(season: number, week: number) {
  const key = `${season}:${week}`;
  const cached = scoreboardCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.request;
  const request = fetch(`/api/nfl/scoreboard?season=${season}&week=${week}`, { cache: "no-store", credentials: "same-origin" })
    .then(async (response) => {
      if (!response.ok) throw new Error("NFL game data unavailable");
      const value = await response.json() as { games?: unknown };
      if (!Array.isArray(value.games)) throw new Error("Invalid NFL game data");
      return value as Scoreboard;
    });
  scoreboardCache.set(key, { expiresAt: Date.now() + 25_000, request });
  return request;
}

function score(game: NflGame) {
  return `${game.awayTeam} ${game.awayScore ?? "—"} – ${game.homeTeam} ${game.homeScore ?? "—"}`;
}

function period(game: NflGame) {
  if (game.period === null) return "Live";
  return game.period <= 4 ? `Q${game.period}` : game.period === 5 ? "OT" : `${game.period - 4}OT`;
}

function kickoff(value: string | null) {
  if (!value) return "Kickoff time unavailable";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).format(new Date(value));
}

function useNflScoreboard(season: number, week: number) {
  const [scoreboard, setScoreboard] = useState<Scoreboard | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    setScoreboard(null);
    setUnavailable(false);
    if (!season || !week) {
      setUnavailable(true);
      return;
    }
    let active = true;
    const refresh = () => void loadScoreboard(season, week).then((value) => {
      if (active) { setScoreboard(value); setUnavailable(false); }
    }).catch(() => {
      if (active) setUnavailable(true);
    });
    refresh();
    const timer = window.setInterval(refresh, 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [season, week]);

  return { scoreboard, unavailable };
}

function usePlayerGame(player: Player, season: number, week: number) {
  const team = normalizeNflTeam(player.nflTeam);
  const { scoreboard, unavailable } = useNflScoreboard(season, week);

  const game = scoreboard?.games.find((item) => item.homeTeam === team || item.awayTeam === team);
  return { game, state: game?.state ?? (scoreboard ? 'bye' as const : undefined), scoreboard, unavailable };
}

export function PlayerProjection({ player, season, week }: { player: Player; season: number; week: number }) {
  const { state } = usePlayerGame(player, season, week);
  return <ProjectionValue value={player.projection} baseline={player.pregameProjection} state={state} />;
}

export function TeamProjection({ team, season, week }: { team: Team; season: number; week: number }) {
  const { scoreboard } = useNflScoreboard(season, week);
  return <ProjectionValue value={team.projection} baseline={team.pregameProjection} state={teamProjectionState(team, scoreboard?.games ?? [])} teamTotal />;
}

export function PlayerGameStatus({ player, season, week }: { player: Player; season: number; week: number }) {
  const { game, state, scoreboard, unavailable } = usePlayerGame(player, season, week);
  const label = game?.state === "final"
    ? `Final · ${score(game)}`
    : game?.state === "live"
      ? `${period(game)}${game.clock ? ` ${game.clock}` : ""} · ${score(game)}`
      : game
        ? kickoff(game.date)
        : scoreboard
          ? "Bye week"
        : unavailable
          ? "Game info unavailable"
          : "Loading game info";

  return <small className="player-game-status" data-state={state} title={label}>{label}</small>;
}

export function PlayerDetailsButton({ player, season, week }: { player: Player; season: number; week: number }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const image = player.headshot && /^https?:\/\//i.test(player.headshot) ? player.headshot : null;
  const stats = Object.entries(playerStatsWithDefaults(player));
  const statPoints = playerStatPoints(player);
  const points = typeof player.points === "number" && Number.isFinite(player.points) ? player.points.toFixed(2) : "—";

  return <>
    <button className="player-name-button" type="button" aria-haspopup="dialog" onClick={() => { dialog.current?.showModal(); setOpen(true); }}>{player.name}</button>
    <dialog className="player-modal" ref={dialog} aria-labelledby={titleId} onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }} onClose={() => setOpen(false)}>
      <div className="player-modal-head"><div>{image ? <img src={image} alt="" /> : null}<span><small>{player.position || "PLAYER"} · {player.nflTeam || "NFL"}</small><h2 id={titleId}>{player.name}</h2></span></div><button type="button" aria-label="Close player details" onClick={() => dialog.current?.close()}>×</button></div>
      <div className="player-modal-summary"><span>{player.slot || "Roster"}</span><strong><span className="player-modal-points">{points}</span> fantasy points</strong></div>
      {open ? <><PlayerProjection player={player} season={season} week={week} /><PlayerGameStatus player={player} season={season} week={week} /></> : null}
      {stats.length ? <table className="player-modal-stats"><thead><tr><th scope="col">Stat</th><th scope="col">Value</th><th scope="col">Fantasy pts</th></tr></thead><tbody>{stats.map(([label, value]) => <tr key={label}><th scope="row">{label}</th><td>{String(value)}</td><td>{statPoints[label] ? statPoints[label].toFixed(2) : "—"}</td></tr>)}</tbody></table> : null}
    </dialog>
  </>;
}
