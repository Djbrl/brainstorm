// What makes the map draw a frame (redraw.ts draws only while something moves): a change to the picture, a replay
// step, an agent's move, files gliding to new places, a new edit's ripple, recency fading every few seconds, a web font
// arriving. Moved out of MapView.tsx; it owns the recency epoch the frame reads.
import { useEffect, useRef, type RefObject } from "react";
import type { FileNode } from "@contract";
import { clearTextWidths } from "./labels";
import { clearSprites } from "./sprites";
import { RIPPLE_MS, type Caches } from "./drawNode";
import type { Redraw } from "./redraw";
import { fadesFor } from "./color";
import { clock, isRecording } from "../lib/live";

export function useRedrawTriggers({ redraw, caches, files, tokens, tween, graph, picture, step, agents }: {
  redraw: Redraw; caches: RefObject<Caches>; files: FileNode[] | undefined; tokens: unknown;
  /** graph.ts's file glide, and the graph it belongs to. */
  tween: RefObject<unknown>; graph: unknown;
  /** Anything that changes the picture: one frame (the frame itself says if more must follow). Same length every render. */
  picture: readonly unknown[];
  /** A replay step (index, thread, mode): the tracer glides, a read flashes, an edit pulses (up to about a second). */
  step: readonly unknown[];
  /** The live agents: a new position, error or activity plays out (drawAgents). */
  agents: unknown;
}) {
  useEffect(() => { redraw.kick(); }, [redraw, ...picture]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { redraw.kick(1300); }, [redraw, ...step]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { redraw.kick(100); }, [redraw, agents]);
  // Files came or went: the frame keeps coming while the circles that moved glide (stepTween).
  useEffect(() => { if (tween.current) redraw.kick(700); }, [graph, redraw, tween]);

  // One-shot ripples: start one when a file receives a new agent edit (not on first load).
  const seenEdits = useRef<Map<string, FileNode> | null>(null);
  useEffect(() => {
    const list = files ?? [];
    const first = seenEdits.current === null;
    const seen = seenEdits.current ?? new Map<string, FileNode>();
    let started = false;
    for (const f of list) {
      const prev = seen.get(f.path);
      if (prev === f) continue;   // the store keeps unchanged files as they were: only the changed ones are compared
      if (!first && prev !== undefined && (prev.lastChangedAt !== f.lastChangedAt || prev.activeSessionId !== f.activeSessionId)
        && f.activeSessionId && f.lastChangedAt !== prev.lastChangedAt) { caches.current.ripples.set(f.path, performance.now()); started = true; }
      seen.set(f.path, f);
    }
    seenEdits.current = seen;
    if (started) redraw.kick(RIPPLE_MS);
  }, [files, redraw, caches]);

  // ---- colours: kept per file, worked out again when its time changes, and every few seconds (recency fades) ----
  // Only while a file on the map (or an island) is recent enough for its colour to still move: a map at rest draws
  // nothing every five seconds. A look over every file's time every five seconds (strings: no parsing) is a few µs.
  const epoch = useRef(0);
  const latest = useRef({ files, graph }); latest.current = { files, graph };
  useEffect(() => {
    const window = fadesFor(isRecording()) + 10_000;
    const t = setInterval(() => {
      const { files: fs, graph: g } = latest.current;
      let last = "";
      for (const f of fs ?? []) if (f.lastChangedAt && f.lastChangedAt > last) last = f.lastChangedAt;
      for (const n of (g as { nodes?: { file?: FileNode }[] } | null)?.nodes ?? []) { const at = n.file?.lastChangedAt; if (at && at > last) last = at; }
      if (last && clock() - Date.parse(last) < window) { epoch.current++; redraw.kick(); }
    }, 5000);
    return () => clearInterval(t);
  }, [redraw]);
  useEffect(() => { epoch.current++; clearSprites(); }, [tokens]);
  useEffect(() => {
    // A web font arrived: names were measured in the fallback font.
    const f = typeof document !== "undefined" ? document.fonts : undefined;
    if (!f) return;
    const done = () => { clearTextWidths(); redraw.kick(); };
    f.addEventListener?.("loadingdone", done);
    return () => f.removeEventListener?.("loadingdone", done);
  }, [redraw]);
  return epoch;
}
