// Owner: islands. Files an agent touches outside the open project: an orchestrator thread editing another repo, a visitor
// from another project. The map draws them as small islands around the project, one per project (the folders Rundown
// knows as projects; else the folder under your home), holding only the files touched. Clicking one opens that project.
//
// Which islands: a thread of this project shows every project it reached; a visitor (a thread from elsewhere that touched
// this project) shows only the project it comes from, not the others it went on to. The most recent MAX_ISLANDS get
// their own island; the rest share one, "+N more projects", with a small island per project inside it.
import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { AgentPresence, FileNode, ProjectMap, Session, Step } from "@contract";
import { isReplay } from "./live";
import { repoBase, repoRelative } from "./paths";

export type Island = {
  root: string; name: string; files: FileNode[];
  /** "+N more projects": the projects past MAX_ISLANDS, one small island each inside it. */
  more?: Island[];
};
/** The root of the island holding the projects past MAX_ISLANDS (not a folder). */
export const MORE_ROOT = "@more";
const MAX_ISLANDS = 8;

/** Inside the project: any of its checkouts or the folders it lived in before a move. */
function inProject(abs: string, map: ProjectMap): boolean {
  return [repoBase(map.root), ...(map.formerRoots ?? [])].some((b) => repoRelative(abs, b) !== null);
}

/**
 * A file the map could show as outside the project: absolute, in none of the project's checkouts or former folders, and
 * in someone's own folders (not the system's, not a hidden folder like ~/.claude where plans and scratch files live).
 * The server puts agents on the same files (agents.service.ts onMap).
 */
export function isOutside(abs: string | undefined, map: ProjectMap | null): abs is string {
  if (!abs || !map || !abs.startsWith("/") || inProject(abs, map)) return false;
  const home = /^\/(?:Users|home)\/[^/]+\/(.+)$/.exec(abs)?.[1];
  return !!home && !home.startsWith(".") && !home.startsWith("Library/");
}

// ---- the projects Rundown knows (the workspace picker's list), to name an island after its project ----
let roots: string[] | null = null, asked = false;
const subs = new Set<() => void>();
function loadRoots() {
  if (asked || isReplay()) return;
  asked = true;
  fetch("/api/workspace/suggestions").then((r) => r.json())
    .then((list: { root: string }[]) => { roots = list.map((s) => s.root.replace(/\/+$/, "")).sort((a, b) => b.length - a.length); subs.forEach((f) => f()); })
    .catch(() => { roots = []; });
}
const useRoots = () => {
  useEffect(loadRoots, []);
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => roots);
};

/** One path per file whichever checkout the agent used: a worktree's copy (`<repo>/.claude/worktrees/<name>/x`) is the
 *  repo's `<repo>/x` on an island. */
export const islandPath = (abs: string) => abs.replace(/\/\.claude\/worktrees\/[^/]+(?=\/|$)/, "");

/** The project a file belongs to: the deepest known project around it, else the folder right under the home folder. */
export function projectOf(abs: string, known: string[] | null): string {
  const hit = known?.find((r) => abs === r || abs.startsWith(r + "/"));
  if (hit) return hit;
  const m = /^(\/(?:Users|home)\/[^/]+\/[^/]+)(\/|$)/.exec(abs);
  return m ? m[1] : abs.slice(0, abs.lastIndexOf("/"));
}

/** The projects Rundown knows, deepest first (null until loaded). */
export const knownRoots = () => roots;
/** A visitor's home (see homeOf), with the projects known so far. */
export const visitorHome = (cwd: string | undefined, map: ProjectMap | null) => homeOf(cwd, map, roots);
/** A visitor's home: the project its thread works in, when that isn't this one (null for this project's own threads). */
function homeOf(cwd: string | undefined, map: ProjectMap | null, known: string[] | null): string | null {
  if (!cwd || !map || !cwd.startsWith("/") || inProject(cwd, map)) return null;
  return projectOf(cwd.replace(/\/+$/, ""), known);
}

/** Names that say which project: the folder's name, with its parent when two islands share one ("Documents/x"). */
function names(rootsList: string[]): Map<string, string> {
  const base = (r: string) => r.slice(r.lastIndexOf("/") + 1);
  const count = new Map<string, number>();
  for (const r of rootsList) count.set(base(r), (count.get(base(r)) ?? 0) + 1);
  return new Map(rootsList.map((r) => {
    if ((count.get(base(r)) ?? 0) < 2) return [r, base(r)];
    const segs = r.split("/");
    return [r, segs.slice(-2).join("/")];
  }));
}

/**
 * The islands for this frame: the outside files of the open thread's steps, and those the live agents on the map are on
 * or went through (a visitor's: only those in the project it comes from). Same files, same islands (and the same
 * objects), so the layout only changes when one comes or goes.
 */
export function useIslands(map: ProjectMap | null, thread: Session | undefined, steps: Step[] | undefined, agents: AgentPresence[], sessions: Session[]): Island[] {
  const known = useRoots();
  const touched = useMemo(() => {
    const out = new Map<string, { edited?: string; at: string }>(); // path → its last edit, and its last touch
    const add = (raw: string | undefined, ts: string, edit: boolean, only: string | null) => {
      if (!isOutside(raw, map)) return;
      const p = islandPath(raw);
      if (only && projectOf(p, known) !== only) return;
      const was = out.get(p);
      out.set(p, { edited: edit && (!was?.edited || ts > was.edited) ? ts : was?.edited, at: !was || ts > was.at ? ts : was.at });
    };
    const threadHome = homeOf(thread?.cwd, map, known);
    for (const s of steps ?? []) if (s.filePath && (s.kind === "edit" || s.kind === "tool_call")) add(s.filePath, s.ts, s.kind === "edit", threadHome);
    const cwdOf = new Map(sessions.map((s) => [s.id, s.cwd]));
    for (const a of agents) {
      const only = homeOf(cwdOf.get(a.sessionId), map, known);
      add(a.file, a.ts, false, only);
      for (const m of a.trail) add(m.file, m.ts, m.action === "edit" || m.action === "write", only);
    }
    return out;
  }, [map, thread?.cwd, steps, agents, sessions, known]);
  const sig = [...touched].map(([p, t]) => `${p}@${t.edited ?? ""}`).sort().join("\n") + "|" + (known?.length ?? -1);
  return useMemo(() => {
    const by = new Map<string, { files: FileNode[]; at: string }>();
    for (const [path, t] of touched) {
      const root = projectOf(path, known);
      const isle = by.get(root) ?? by.set(root, { files: [], at: "" }).get(root)!;
      isle.files.push({ path, module: "outside", lines: 40, ...(t.edited ? { lastChangedAt: t.edited } : {}) });
      if (t.at > isle.at) isle.at = t.at;
    }
    const named = names([...by.keys()]);
    const all = [...by].map(([root, v]) => ({ root, name: named.get(root)!, files: v.files.sort((a, b) => a.path.localeCompare(b.path)), at: v.at }));
    // The most recent get their own island, in a stable order (by name); the rest go in "+N more projects".
    const recent = [...all].sort((a, b) => b.at.localeCompare(a.at));
    const own = recent.slice(0, all.length > MAX_ISLANDS ? MAX_ISLANDS - 1 : MAX_ISLANDS).sort((a, b) => a.name.localeCompare(b.name));
    const rest = recent.slice(own.length).sort((a, b) => a.name.localeCompare(b.name));
    const strip = ({ root, name, files }: Island) => ({ root, name, files });
    const out: Island[] = own.map(strip);
    if (rest.length) out.push({ root: MORE_ROOT, name: `${rest.length} more projects`, files: [], more: rest.map(strip) });
    return out;
    // Rebuilt when a file comes or is edited again (the map only lays out again when the files themselves change).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
}
