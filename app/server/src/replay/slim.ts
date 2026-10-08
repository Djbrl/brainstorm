import type { Edge, FileNode, ProjectMap, Step } from "../types";

// Owned by the lead. A shared replay carries one thread, so it doesn't need the whole project's map (up to 3,000 files
// and their imports, megabytes). It keeps the files the thread touched, and a few around them so the map still reads
// as a project and not a handful of lonely dots: the files they import or are imported by first (those lines are
// drawn), then files from the same folders. The viewer lays files out by folder (web map/graph.ts), so the touched
// files' folders come with their paths.

/** Files kept around the touched ones, at most. */
export const NEIGHBOURS = 60;

const WORKTREE = /^(.*?)\/\.claude\/worktrees\/[^/]+(?:\/(.*))?$/;
const repoBase = (root: string) => root.replace(/\/+$/, "").replace(/\/\.claude\/worktrees\/[^/]+$/, "");
/** Path inside the repo for any checkout of it (the main one or a worktree), else null. Same as web lib/paths.ts. */
function repoRelative(abs: string, base: string): string | null {
  const m = abs.match(WORKTREE);
  if (m && m[1] === base) return m[2] ?? "";
  if (abs.startsWith(base + "/")) return abs.slice(base.length + 1);
  return null;
}
const dirOf = (p: string) => p.slice(0, p.lastIndexOf("/"));

/**
 * The map files a thread's steps name, matched the way the viewer matches them (web lib/paths.ts): the same path, or the
 * same path inside the repo from another checkout or a folder the repo lived in before.
 */
export function touchedFiles(map: ProjectMap, steps: Step[]): Set<string> {
  const ids = new Set(map.files.map((f) => f.path));
  const base = repoBase(map.root);
  const bases = [base, ...(map.formerRoots ?? [])];
  const byRel = new Map<string, string>();
  for (const f of map.files) {
    const rel = repoRelative(f.path, base);
    if (rel !== null && !byRel.has(rel)) byRel.set(rel, f.path);
  }
  const out = new Set<string>();
  for (const st of steps) {
    const abs = st.filePath;
    if (!abs) continue;
    if (ids.has(abs)) { out.add(abs); continue; }
    for (const b of bases) {
      const rel = repoRelative(abs, b);
      if (rel === null) continue;
      const hit = byRel.get(rel);
      if (hit) out.add(hit);
      break;
    }
  }
  return out;
}

/** The map a shared replay carries: the touched files, up to NEIGHBOURS around them, and the imports between those. */
export function slimMap(map: ProjectMap, steps: Step[], neighbours = NEIGHBOURS): ProjectMap {
  const touched = touchedFiles(map, steps);
  const byPath = new Map(map.files.map((f) => [f.path, f]));
  const score = new Map<string, number>();
  const add = (p: string, n: number) => { if (!touched.has(p) && byPath.has(p)) score.set(p, (score.get(p) ?? 0) + n); };
  // An import to or from a touched file counts most (its line shows on the map), each one more.
  for (const e of map.edges) {
    if (touched.has(e.from)) add(e.to, 10);
    if (touched.has(e.to)) add(e.from, 10);
  }
  const dirs = new Set([...touched].map(dirOf));
  for (const f of map.files) if (dirs.has(dirOf(f.path))) add(f.path, 1);
  // Nothing touched on the map (a thread that only talked): the most recently changed files, so the map isn't empty.
  if (!touched.size) for (const f of map.files) add(f.path, 0);
  const recent = (p: string) => byPath.get(p)?.lastChangedAt ?? "";
  const extra = [...score.keys()]
    .sort((a, b) => score.get(b)! - score.get(a)! || recent(b).localeCompare(recent(a)) || a.localeCompare(b))
    .slice(0, neighbours);
  const keep = new Set([...touched, ...extra]);
  const files: FileNode[] = map.files.filter((f) => keep.has(f.path));
  const edges: Edge[] = map.edges.filter((e) => keep.has(e.from) && keep.has(e.to));
  const used = new Set(files.map((f) => f.module));
  const { scanStopped: _s, unread: _u, ...rest } = map; // about the sharer's scan, not this thread
  return { ...rest, files, edges, modules: map.modules.filter((m) => used.has(m.id)), totalFiles: Math.max(map.totalFiles ?? 0, map.files.length) };
}
