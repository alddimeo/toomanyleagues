"use client";

import { useEffect, useState } from "react";

export function useLiveNflGames(enabled = true) {
  const [live, setLive] = useState<boolean | null>(null);

  useEffect(() => {
    if (!enabled) { setLive(null); return; }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      if (cancelled || document.visibilityState !== "visible") return;
      try {
        const response = await fetch("/api/nfl/scoreboard", { cache: "no-store", credentials: "same-origin" });
        if (!response.ok) throw new Error("NFL scores unavailable");
        const value: unknown = await response.json();
        if (!cancelled) setLive(!!value && typeof value === "object" && Array.isArray((value as { games?: unknown }).games) &&
          (value as { games: { state?: string }[] }).games.some((game) => game?.state === "live"));
      } catch { if (!cancelled) setLive((current) => current === true ? true : null); }
      if (!cancelled) timer = setTimeout(() => void check(), 30_000);
    };
    const resume = () => { if (document.visibilityState === "visible") { clearTimeout(timer); void check(); } };
    document.addEventListener("visibilitychange", resume);
    void check();
    return () => { cancelled = true; clearTimeout(timer); document.removeEventListener("visibilitychange", resume); };
  }, [enabled]);

  return live;
}
