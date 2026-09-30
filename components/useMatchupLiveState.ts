"use client";

import { useEffect, useRef, useState } from "react";
import type { LeagueSnapshot } from "@/lib/types";
import { normalizeNflTeam, parseNflLiveSituation, parseNflScoreboard, type NflGame } from "@/lib/nfl";
import { startersMentioned, type HighlightedStarter } from "@/lib/nfl-highlights";

const ESPN = "https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/";
const LIVE_REFRESH_MS = 15_000;
const IDLE_REFRESH_MS = 30_000;
const FLASH_MS = 10_000;

export type MatchupLiveState = {
  teams: Record<string, "field" | "redzone">;
  flashes: Record<string, string>;
};

export const playerLiveKey = (name: string) => name.trim().toLowerCase();

async function espnJson(path: string, signal: AbortSignal) {
  const response = await fetch(`${ESPN}${path}`, { credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store", signal });
  if (!response.ok) throw new Error("ESPN live status is unavailable.");
  return response.json() as Promise<unknown>;
}

function playersInGame(leagues: LeagueSnapshot[], game: NflGame): HighlightedStarter[] {
  const players = new Map<string, HighlightedStarter>();
  for (const player of leagues.flatMap((league) => league.teams.flatMap((team) => team.players))) {
    const nflTeam = normalizeNflTeam(player.nflTeam);
    if (!nflTeam || (nflTeam !== game.homeTeam && nflTeam !== game.awayTeam)) continue;
    const key = `${playerLiveKey(player.name)}:${nflTeam}`;
    if (!players.has(key)) players.set(key, { name: player.name, nflTeam, side: "both" });
  }
  return [...players.values()];
}

export function useMatchupLiveState(leagues: LeagueSnapshot[]): MatchupLiveState {
  const [state, setState] = useState<MatchupLiveState>({ teams: {}, flashes: {} });
  const leaguesRef = useRef(leagues);
  const seenPlays = useRef(new Set<string>());
  const initializedGames = useRef(new Set<string>());
  const flashTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  leaguesRef.current = leagues;

  useEffect(() => () => {
    for (const timer of flashTimers.current.values()) clearTimeout(timer);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;

    const flash = (name: string, eventId: string) => {
      const key = playerLiveKey(name);
      setState((current) => ({ ...current, flashes: { ...current.flashes, [key]: eventId } }));
      const previous = flashTimers.current.get(key);
      if (previous) clearTimeout(previous);
      flashTimers.current.set(key, setTimeout(() => {
        setState((current) => {
          if (current.flashes[key] !== eventId) return current;
          const flashes = { ...current.flashes };
          delete flashes[key];
          return { ...current, flashes };
        });
        flashTimers.current.delete(key);
      }, FLASH_MS));
    };

    const refresh = async () => {
      if (inFlight || document.visibilityState !== "visible") return;
      inFlight = true;
      let hasLiveGame = false;
      try {
        const games = parseNflScoreboard(await espnJson("scoreboard", controller.signal));
        const liveGames = games.filter((game) => game.state === "live");
        hasLiveGame = liveGames.length > 0;
        const results = await Promise.allSettled(liveGames.map(async (game) => ({
          game,
          situation: parseNflLiveSituation(await espnJson(`summary?event=${encodeURIComponent(game.id)}`, controller.signal)),
        })));
        const teams: MatchupLiveState["teams"] = {};
        for (const result of results) {
          if (result.status !== "fulfilled") continue;
          const { game, situation } = result.value;
          if (situation.possessionTeam) teams[situation.possessionTeam] = situation.redZone ? "redzone" : "field";
          const players = playersInGame(leaguesRef.current, game);
          const initialized = initializedGames.current.has(game.id);
          for (const play of situation.scoringPlays) {
            const eventId = `${game.id}:${play.id}`;
            if (seenPlays.current.has(eventId)) continue;
            seenPlays.current.add(eventId);
            const scoredRecently = play.timestamp !== null && Date.now() - Date.parse(play.timestamp) >= -5_000 && Date.now() - Date.parse(play.timestamp) <= FLASH_MS;
            if (initialized || scoredRecently) for (const player of startersMentioned(play.text, players)) flash(player.name, eventId);
          }
          initializedGames.current.add(game.id);
        }
        setState((current) => ({ ...current, teams }));
      } catch {
        // Keep the last known state through a transient ESPN failure.
      } finally {
        inFlight = false;
        if (!controller.signal.aborted) timer = setTimeout(() => void refresh(), hasLiveGame ? LIVE_REFRESH_MS : IDLE_REFRESH_MS);
      }
    };

    const resume = () => {
      if (document.visibilityState !== "visible") return;
      clearTimeout(timer);
      void refresh();
    };
    document.addEventListener("visibilitychange", resume);
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", resume);
    };
  }, []);

  return state;
}
