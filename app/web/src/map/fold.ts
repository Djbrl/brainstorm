// Owner: map-fold. Folders open as you zoom, like a city map that shows its streets as you come closer: a folder whose
// circle is small on screen shows as one circle with its name and how many files it holds; as it grows past OPEN_PX
// its files fade in where they always are (graph.ts never moves them). The files you look at, an open thread's files,
// where a followed or working agent is: their folders show open at any zoom. Nothing here changes the layout, only
// what's drawn and what a click hits. "Group files into folders" in Settings turns it off (every folder open).
import { useSyncExternalStore } from "react";
import type { Graph, GNode } from "./graph";

const OPEN_PX = 80;     // a folder starts to open when its circle's radius on screen reaches this
const OPEN_SPAN = 0.45; // ... and is fully open this much bigger (its files fade in over the zoom in between)

/**
 * For this frame: how much each node shows (`shown`, 0…1: its folders' openness multiplied down) and how far each
 * folder is open (`open`). `forced`: folders that show open whatever the zoom. Returns a key that changes when what is
 * open (half way or more) changes, for the caches that depend on it (import lines, the files' label footprints).
 */
export function foldFrame(g: Graph, scale: number, forced: ReadonlySet<GNode>, on: boolean): number {
  let sig = 0, i = 0;
  for (const n of g.nodes) {
    const u = n.up;
    n.shown = u ? (u.shown ?? 1) * (u.open ?? 1) : 1;
    // Names hand over: a folder's own name (in its closed circle) is gone by a third open; what it holds names itself after.
    n.said = u ? (u.said ?? 1) * Math.max(0, Math.min(1, ((u.open ?? 1) - 0.34) / 0.5)) : 1;
    if (!n.dir) continue;
    i++;
    const px = n.r * scale;
    n.open = !on || forced.has(n) ? 1 : Math.max(0, Math.min(1, (px - OPEN_PX) / (OPEN_PX * OPEN_SPAN)));
    if (n.shown > 0 && n.open >= 0.5) sig = (sig * 31 + i) | 0;
  }
  return sig;
}

/** The folders a file sits in, to show it open (the file itself may be a folder's circle). */
export function openAround(n: GNode | undefined, into: Set<GNode>) {
  if (n?.dir) into.add(n);
  for (let u = n?.up; u; u = u.up) into.add(u);
}

// ---------- the setting (like map/prefs.ts) ----------
const KEY = "rundown-map-fold";
let foldOn = (() => { try { return localStorage.getItem(KEY) !== "0"; } catch { return true; } })();
const listeners = new Set<() => void>();
const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
const getFold = () => foldOn;
export function setFoldOn(on: boolean) {
  if (on === foldOn) return;
  foldOn = on;
  try { localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* not remembered, still applied */ }
  listeners.forEach((f) => f());
}
export const useFoldOn = () => useSyncExternalStore(subscribe, getFold, getFold);
