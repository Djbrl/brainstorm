// Owner: map-fold. Folders on the map. A folder can show as one circle (folded) instead of its files: the map opens
// the biggest folders first until it shows about BUDGET circles, so a big project reads as a handful of folders and
// a small one stays nearly whole. A folded folder's circle takes the room its files would, where they would sit, so
// opening it (a click, a file you pick, an agent you follow working there) bursts it into its files in place and the
// rest of the map doesn't move. "Group files into folders" in Settings turns it off.
import { useMemo, useSyncExternalStore } from "react";
import type { Edge, FileNode, ProjectMap } from "@contract";

/** What a folded folder's circle stands for: the folder (relative to the root) and its files, all levels down. */
export type Fold = { rel: string; files: FileNode[] };
/** A circle on the map: a file, or a folded folder (its path is the folder's, ending in "/"). */
export type FoldFile = FileNode & { fold?: Fold };

const BUDGET = 70;      // about this many circles shown before you open anything
const MIN_FOLD = 3;     // a folder with fewer files never folds: a circle for two files hides more than it groups

type Dir = { rel: string; abs: string; files: FileNode[]; dirs: Dir[]; count: number };

/** The map's folders, from its files' paths (relative to the root). */
function tree(map: ProjectMap): Dir {
  const base = map.root.replace(/\/+$/, "");
  const top: Dir = { rel: "", abs: base, files: [], dirs: [], count: 0 };
  const byRel = new Map<string, Dir>([["", top]]);
  const dirOf = (rel: string): Dir => {
    let d = byRel.get(rel);
    if (d) return d;
    const cut = rel.lastIndexOf("/"), parent = dirOf(cut < 0 ? "" : rel.slice(0, cut));
    d = { rel, abs: base + "/" + rel, files: [], dirs: [], count: 0 };
    parent.dirs.push(d); byRel.set(rel, d);
    return d;
  };
  for (const f of map.files) {
    const rel = f.path.startsWith(base + "/") ? f.path.slice(base.length + 1) : f.path;
    const cut = rel.lastIndexOf("/");
    dirOf(cut < 0 ? "" : rel.slice(0, cut)).files.push(f);
  }
  const count = (d: Dir): number => (d.count = d.files.length + d.dirs.reduce((s, c) => s + count(c), 0));
  count(top);
  return top;
}

/** A folder that never shows as a circle: too few files, or only a way through to one subfolder ("src" in "web/src"). */
const passThrough = (d: Dir) => d.count < MIN_FOLD || (d.files.length === 0 && d.dirs.length === 1);
/** The circles an open folder shows: its files and its subfolders (opened through the pass-through ones). */
function cost(d: Dir): number { return d.files.length + d.dirs.reduce((s, c) => s + (passThrough(c) ? cost(c) : 1), 0); }
/** The folders open by default: the biggest first, while the map stays within BUDGET circles. */
function defaults(top: Dir): Set<string> {
  const open = new Set<string>();
  let shown = cost(top);
  const folded: Dir[] = [];
  const offer = (d: Dir) => { for (const c of d.dirs) if (passThrough(c)) offer(c); else folded.push(c); };
  offer(top);
  for (;;) {
    folded.sort((a, b) => b.count - a.count);
    const d = folded.shift();
    if (!d || shown + cost(d) - 1 > BUDGET) break;   // stop at the first that doesn't fit: what stays folded is smaller
    open.add(d.rel); shown += cost(d) - 1; offer(d);
  }
  return open;
}

export type Folding = {
  /** What the graph lays out: the files of open folders, a circle per folded folder, and the imports between them. */
  map: ProjectMap | null;
  /** Each file folded away: the id of the circle that holds it. */
  folded: Map<string, string>;
  /** Changes when what's folded changes (the graph's structure key). */
  key: string;
};

/**
 * What the map shows for `open`: folder paths (relative) opened by you, and files that must show (selected, in the
 * thread's focus, where a followed agent works), whose folders open with them.
 */
export function useFolding(map: ProjectMap | null, on: boolean, open: ReadonlySet<string>, show: readonly string[]): Folding {
  // Built again for every change to the files (a few milliseconds for 3,000): the circles carry their files' times.
  const top = useMemo(() => (map && on ? tree(map) : null), [on, map?.root, map?.files]);   // eslint-disable-line react-hooks/exhaustive-deps
  const auto = useMemo(() => (top ? defaults(top) : null), [top]);
  // Which folders are open: by default, by you, and around the files that must show.
  const openKey = useMemo(() => {
    if (!top || !auto || !map) return "";
    const base = map.root.replace(/\/+$/, ""), all = new Set([...auto, ...open]);
    for (const p of show) {
      const rel = p.startsWith(base + "/") ? p.slice(base.length + 1) : null;
      for (let cut = rel ? rel.lastIndexOf("/") : -1; cut > 0; cut = rel!.lastIndexOf("/", cut - 1)) all.add(rel!.slice(0, cut));
    }
    return [...all].sort().join("\n");
  }, [top, auto, open, show, map?.root]);   // eslint-disable-line react-hooks/exhaustive-deps
  return useMemo((): Folding => {
    if (!map || !top) return { map, folded: new Map(), key: "" };
    const isOpen = new Set(openKey.split("\n"));
    const files: FoldFile[] = [], folded = new Map<string, string>();
    const walk = (d: Dir) => {
      files.push(...d.files);
      for (const c of d.dirs) {
        if (passThrough(c) || isOpen.has(c.rel)) { walk(c); continue; }
        const id = c.abs + "/", inside: FileNode[] = [];
        const gather = (x: Dir) => { inside.push(...x.files); x.dirs.forEach(gather); };
        gather(c);
        let lines = 0, last: string | undefined, active: string | undefined;
        for (const f of inside) {
          folded.set(f.path, id); lines += f.lines;
          if (f.lastChangedAt && (!last || f.lastChangedAt > last)) last = f.lastChangedAt;
          active ??= f.activeSessionId;
        }
        const segs = c.rel.split("/");
        files.push({ path: id, module: segs.length > 1 ? segs.slice(0, 2).join("/") : segs[0], lines, lastChangedAt: last, activeSessionId: active, fold: { rel: c.rel, files: inside } });
      }
    };
    walk(top);
    if (!folded.size) return { map, folded, key: "" };
    const edges: Edge[] = [], seen = new Set<string>();
    for (const e of map.edges) {
      const from = folded.get(e.from) ?? e.from, to = folded.get(e.to) ?? e.to, k = from + "\n" + to;
      if (from !== to && !seen.has(k)) { seen.add(k); edges.push({ from, to }); }
    }
    return { map: { ...map, files, edges }, folded, key: openKey };
  }, [map, top, openKey]);
}

// ---------- the setting (like map/prefs.ts) ----------
const KEY = "brainstorm-map-fold";
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
