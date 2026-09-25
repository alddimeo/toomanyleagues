"use client";

import { useEffect, useRef, useState } from "react";
import type { LeagueSnapshot } from "@/lib/types";
import { NflDrawer } from "@/components/NflDrawer";

const MIN_WIDTH = 320;
const DEFAULT_WIDTH = 390;
const widthLimit = () => Math.max(MIN_WIDTH, Math.min(900, (typeof window === "undefined" ? 1416 : window.innerWidth) - 656));
const clampWidth = (width: number) => Math.min(widthLimit(), Math.max(MIN_WIDTH, width));

export function NflPanel({ leagues }: { leagues: LeagueSnapshot[] }) {
  const [open, setOpen] = useState(false);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const launch = useRef<HTMLButtonElement>(null);
  const dragging = useRef<number | null>(null);
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setOpen(localStorage.getItem("nfl-panel-open") === "true");
    setWidth(clampWidth(Number(localStorage.getItem("nfl-panel-width")) || DEFAULT_WIDTH));
    const fit = () => setWidth((current) => clampWidth(current));
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  useEffect(() => {
    const shell = host.current?.parentElement;
    shell?.style.setProperty("--nfl-panel-width", `${width}px`);
    shell?.classList.toggle("has-nfl-drawer", open);
    shell?.classList.toggle("has-nfl-launch", !open);
    return () => { shell?.classList.remove("has-nfl-drawer", "has-nfl-launch"); };
  }, [open, width]);

  const toggle = (next: boolean) => {
    localStorage.setItem("nfl-panel-open", String(next));
    setOpen(next);
    if (!next) requestAnimationFrame(() => launch.current?.focus());
  };
  const resize = (next: number) => {
    dragging.current = clampWidth(next);
    host.current?.parentElement?.style.setProperty("--nfl-panel-width", `${dragging.current}px`);
  };
  const finishResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragging.current === null) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setWidth(dragging.current);
    localStorage.setItem("nfl-panel-width", String(dragging.current));
    dragging.current = null;
  };
  const nudge = (next: number) => {
    const value = clampWidth(next);
    setWidth(value);
    localStorage.setItem("nfl-panel-width", String(value));
  };

  return <div ref={host} className="nfl-panel">
    {open ? <><NflDrawer leagues={leagues} onClose={() => toggle(false)} /><div className="nfl-resize-handle" role="separator" aria-label="Resize NFL scores" aria-orientation="vertical" aria-valuemin={MIN_WIDTH} aria-valuemax={widthLimit()} aria-valuenow={width} tabIndex={0} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); resize(event.clientX); }} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) resize(event.clientX); }} onPointerUp={finishResize} onPointerCancel={finishResize} onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); nudge(width + (event.key === "ArrowRight" ? 16 : -16)); } }} /></> : <button ref={launch} className="nfl-vertical-button" type="button" aria-label="Open NFL scores" aria-controls="nfl-drawer" aria-expanded={false} onClick={() => toggle(true)}><span>NFL</span><b aria-hidden="true">›</b></button>}
  </div>;
}
