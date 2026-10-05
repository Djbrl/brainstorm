// Owner: perf-canvas. Where each file sat on the map last time, per project and theme, kept in this browser
// (IndexedDB), so a reload opens on the settled map instead of laying out thousands of files again from scratch.
// Nothing leaves the machine. Any storage failure (private window, blocked site data, quota) just means no cache.
import { useEffect, useState } from "react";

const DB = "brainstorm-map";
const STORE = "positions";
const VERSION = 1;
/** One project: per theme, the files' ids and their positions (x, y pairs). */
type Saved = { v: number; themes: Record<string, { ids: string[]; xy: Float32Array; at: number }> };
export type Positions = Map<string, { x: number; y: number }>;

let opening: Promise<IDBDatabase | null> | null = null;
function db(): Promise<IDBDatabase | null> {
  if (opening) return opening;
  opening = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, VERSION);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return opening;
}

async function read(root: string): Promise<Saved | null> {
  const d = await db();
  if (!d) return null;
  return new Promise((resolve) => {
    try {
      const req = d.transaction(STORE, "readonly").objectStore(STORE).get(root);
      req.onsuccess = () => { const v = req.result as Saved | undefined; resolve(v && v.v === 1 ? v : null); };
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

const loaded = new Map<string, Saved | null>();   // per root, as read (and as last saved)

/** The positions saved for this project and theme (or, failing that, any theme's: better than random), or null. */
function pick(saved: Saved | null, theme: string): { pos: Positions; sameTheme: boolean } | null {
  if (!saved) return null;
  const t = saved.themes[theme] ?? Object.values(saved.themes).sort((a, b) => b.at - a.at)[0];
  if (!t) return null;
  const pos: Positions = new Map();
  for (let i = 0; i < t.ids.length; i++) pos.set(t.ids[i], { x: t.xy[2 * i], y: t.xy[2 * i + 1] });
  return { pos, sameTheme: t === saved.themes[theme] };
}

/**
 * The saved positions for `root` in `theme`: undefined while they're being read (at most `waitMs`), then the positions
 * or null. Read once per project per page: a theme switch later keeps the files where they are.
 */
export function useSavedPositions(root: string | null, theme: string, waitMs = 600): { pos: Positions; sameTheme: boolean } | null | undefined {
  const [state, setState] = useState<{ root: string; value: { pos: Positions; sameTheme: boolean } | null } | null>(null);
  useEffect(() => {
    if (!root) return;
    if (loaded.has(root)) { setState({ root, value: pick(loaded.get(root) ?? null, theme) }); return; }
    let done = false;
    const finish = (saved: Saved | null) => { if (done) return; done = true; loaded.set(root, saved); setState({ root, value: pick(saved, theme) }); };
    const t = setTimeout(() => finish(null), waitMs);
    read(root).then(finish, () => finish(null));
    return () => { clearTimeout(t); done = true; };
    // The theme is read once per project: switching it later must not reload (the map relaxes from where it is).
  }, [root, waitMs]);
  if (!root) return null;
  return state && state.root === root ? state.value : undefined;
}

/** Remember where the files are now, for this project and theme. */
export async function savePositions(root: string, theme: string, nodes: readonly { id: string; x?: number; y?: number }[]) {
  const ids: string[] = [], xy = new Float32Array(nodes.length * 2);
  for (const n of nodes) {
    if (n.x === undefined || n.y === undefined || !Number.isFinite(n.x) || !Number.isFinite(n.y)) continue;
    xy[ids.length * 2] = n.x; xy[ids.length * 2 + 1] = n.y; ids.push(n.id);
  }
  if (!ids.length) return;
  const saved: Saved = { v: 1, themes: { ...(loaded.get(root)?.themes ?? {}) } };
  saved.themes[theme] = { ids, xy: xy.slice(0, ids.length * 2), at: Date.now() };
  loaded.set(root, saved);
  const d = await db();
  if (!d) return;
  try { d.transaction(STORE, "readwrite").objectStore(STORE).put(saved, root); } catch { /* not remembered: fine */ }
}
