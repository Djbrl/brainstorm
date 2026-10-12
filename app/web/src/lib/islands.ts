// Files an agent touches outside the open project: an orchestrator thread editing another repo, a visitor
// from another project. The map draws them as small islands around the project, one per project (the folders Rundown
// knows as projects; else the folder under your home), holding only the files touched. Clicking one opens that project.
//
// Which islands: a thread of this project shows every project it reached; a visitor (a thread from elsewhere that touched
// this project) shows only the project it comes from, not the others it went on to. The most recent MAX_ISLANDS get
// their own island; the rest share one, "+N more projects", with a small island per project inside it.
import { useEffect, useMemo } from "react";
import type { AgentPresence, FileNode, ProjectMap, Session, Step } from "@contract";
import { outOfWorktree } from "@shared/paths";
import { isRecording, onStepsEvicted } from "./live";
import { repoBase, repoRelative } from "./paths";
import { get } from "./api";
import { sameStep } from "../step/format";
import { createAtom } from "./store";

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
  // The project's folder itself too (a step can name it: a listing, a search in it), not only what's inside.
  const at = abs.replace(/\/+$/, "");
  return [repoBase(map.root), ...(map.formerRoots ?? [])].some((b) => at === b || repoRelative(abs, b) !== null);
}

/**
 * A file the map shows outside the project: absolute and in none of the project's checkouts or former folders. Any
 * real file: another project, or a place that isn't one (the temporary files, Claude Code's own folder, the rest of the
 * computer: PLACES). It used to leave the hidden and system folders out, and an agent working only there (a reviewer
 * writing its reports in a temp folder) was on the map nowhere. The server puts agents on the same files
 * (agents.service.ts onMap).
 */
export function isOutside(abs: string | undefined, map: ProjectMap | null): abs is string {
  if (!abs || !map || !abs.startsWith("/") || inProject(abs, map)) return false;
  return !/^\/(dev|proc|sys)(\/|$)/.test(abs);
}

/** The places that aren't projects, each one island under its own name (the first that holds the file). A click on one
 *  shows the file (its path, Show in Finder) instead of opening it as a project. */
const PLACES: { test: (abs: string) => string | null; name: string }[] = [
  { name: "Temporary files", test: (a) => /^(\/private\/tmp|\/tmp|\/private\/var\/folders\/[^/]+\/[^/]+|\/var\/folders\/[^/]+\/[^/]+)(?=\/)/.exec(a)?.[1] ?? null },
  { name: "Claude Code's files", test: (a) => /^(\/(?:Users|home)\/[^/]+\/\.claude)(?=\/)/.exec(a)?.[1] ?? null },
  { name: "Codex's files", test: (a) => /^(\/(?:Users|home)\/[^/]+\/\.codex)(?=\/)/.exec(a)?.[1] ?? null },
  { name: "Library", test: (a) => /^(\/(?:Users|home)\/[^/]+\/Library)(?=\/)/.exec(a)?.[1] ?? null },
  // Another hidden folder in the home folder (~/.npm, ~/.config): one island each, named as it is.
  { name: "", test: (a) => /^(\/(?:Users|home)\/[^/]+\/\.[^/]+)(?=\/)/.exec(a)?.[1] ?? null },
  // Outside the home folders: the system's, the tools' (/usr, /opt, /etc).
  { name: "Elsewhere on this computer", test: (a) => (/^\/(?:Users|home)\//.test(a) ? null : "") },
];
const placeNames = new Map<string, string>();
/** The place a file is in, if it isn't in a project: its island's root (and its name, kept for `names`). */
function placeOf(abs: string): string | null {
  for (const p of PLACES) {
    const root = p.test(abs);
    if (root === null) continue;
    placeNames.set(root || "/", p.name || root.slice(root.lastIndexOf("/") + 1));
    return root || "/";
  }
  return null;
}
/** The name of the place a file is in ("Temporary files"), or null when it's in a project. */
export const placeName = (abs: string): string | null => { const r = placeOf(abs); return r === null ? null : placeNames.get(r) ?? null; };
/** Whether an island is one of those places (not a project to open). */
export const isPlaceRoot = (root: string) => placeNames.has(root);

// ---- the projects Rundown knows (the workspace picker's list), to name an island after its project ----
const roots = createAtom<string[] | null>(null);
let asked = false;
function loadRoots() {
  if (asked || isRecording()) return;
  asked = true;
  get<{ root: string }[]>("/api/workspace/suggestions")
    .then((list) => roots.set(list.map((s) => s.root.replace(/\/+$/, "")).sort((a, b) => b.length - a.length)))
    .catch(() => roots.set([]));
}
const useRoots = () => {
  useEffect(loadRoots, []);
  return roots.use();
};

/** One path per file whichever checkout the agent used: a worktree's copy (`<repo>/.claude/worktrees/<name>/x`) is the
 *  repo's `<repo>/x` on an island. */
export const islandPath = outOfWorktree;

/** Folders that hold projects rather than being one: a file in ~/Documents/x belongs to the project x, not to Documents
 *  (which the server refuses to open: workspace.service.ts tooBroad). */
const CONTAINERS = new Set(["Documents", "Desktop", "Downloads", "Library", "Pictures", "Movies", "Music", "Public", "Dropbox", "OneDrive"]);

/** The project a file belongs to: the deepest known project around it, else the folder right under the home folder (or
 *  under a folder of folders there, like ~/Documents). */
export function projectOf(abs: string, known: string[] | null): string {
  const hit = known?.find((r) => abs === r || abs.startsWith(r + "/"));
  if (hit) return hit;
  const place = placeOf(abs);
  if (place) return place;
  const m = /^(\/(?:Users|home)\/[^/]+)\/([^/]+)(?:\/([^/]+))?/.exec(abs);
  if (!m) return abs.slice(0, abs.lastIndexOf("/"));
  return CONTAINERS.has(m[2]) && m[3] ? `${m[1]}/${m[2]}/${m[3]}` : `${m[1]}/${m[2]}`;
}

/** The projects Rundown knows, deepest first (null until loaded). */
export const knownRoots = roots.get;
/** A visitor's home (see homeOf), with the projects known so far. */
export const visitorHome = (cwd: string | undefined, map: ProjectMap | null) => homeOf(cwd, map, roots.get());
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
    const place = placeNames.get(r);
    if (place) return [r, place];
    if ((count.get(base(r)) ?? 0) < 2) return [r, base(r)];
    const segs = r.split("/");
    return [r, segs.slice(-2).join("/")];
  }));
}

type Touch = { edited?: string; at: string };
/** Count one touch of an outside file (path → its last edit, and its last touch). `only`: a visitor's home project. */
function addTouch(out: Map<string, Touch>, raw: string | undefined, ts: string, edit: boolean, only: string | null, map: ProjectMap | null, known: string[] | null) {
  if (!isOutside(raw, map)) return;
  if (/^\/(?:Users|home)(?:\/[^/]+)?\/?$/.test(raw)) return;   // the home folder itself (`ls ~`), not a file
  const p = islandPath(raw);
  if (only && projectOf(p, known) !== only) return;
  const was = out.get(p);
  out.set(p, { edited: edit && (!was?.edited || ts > was.edited) ? ts : was?.edited, at: !was || ts > was.at ? ts : was.at });
}

/** Per thread, the steps read so far and what they touched outside: a list that only grew is read from where it stopped. */
const stepTouches = new Map<string, { steps: Step[]; map: ProjectMap | null; known: string[] | null; home: string | null; out: Map<string, Touch> }>();
onStepsEvicted((ids) => { for (const sid of ids) stepTouches.delete(sid); });
function stepsTouched(sid: string, steps: Step[] | undefined, map: ProjectMap | null, known: string[] | null, home: string | null): Map<string, Touch> {
  if (!steps?.length) return new Map();
  let c = stepTouches.get(sid);
  stepTouches.delete(sid);
  let from = 0;
  // The same steps first (ids: a relabelled step is a new object with the same path), and nothing else changed.
  if (c && c.map === map && c.known === known && c.home === home && steps.length >= c.steps.length
    && c.steps.every((x, i) => sameStep(x, steps[i]))) from = c.steps.length;
  else c = { steps, map, known, home, out: new Map() };
  const out = from === steps.length ? c.out : new Map(c.out); // a new map when it changes: the memo above keys on it
  for (let i = from; i < steps.length; i++) {
    const s = steps[i];
    if (s.filePath && (s.kind === "edit" || s.kind === "tool_call")) addTouch(out, s.filePath, s.ts, s.kind === "edit", home, map, known);
    if (s.reads) for (const r of s.reads) addTouch(out, r, s.ts, false, home, map, known);   // what its commands read (cat, sed -n, grep…)
  }
  stepTouches.set(sid, { steps, map, known, home, out });
  if (stepTouches.size > 4) stepTouches.delete(stepTouches.keys().next().value!);
  return out;
}

/**
 * The islands for this frame: the outside files of the open thread's steps, and those the live agents on the map are on
 * or went through (a visitor's: only those in the project it comes from). Same files, same islands (and the same
 * objects), so the layout only changes when one comes or goes.
 */
export function useIslands(map: ProjectMap | null, thread: Session | undefined, steps: Step[] | undefined, agents: AgentPresence[], sessions: Session[]): Island[] {
  const known = useRoots();
  // What decides whether a path is outside, and whose: the project's folders (not its files: a file message makes a new
  // map object, and the islands don't depend on it) and the projects known.
  const root = map?.root ?? "", former = map?.formerRoots?.join("\n") ?? "";
  const scope = useMemo(() => (map ? { root, files: [], edges: [], modules: [], formerRoots: map.formerRoots } as ProjectMap : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [!!map, root, former]);
  const threadHome = homeOf(thread?.cwd, scope, known);
  // The thread's steps, read once each: a live step adds to what the earlier ones gave (stepsTouched).
  const fromSteps = useMemo(() => stepsTouched(thread?.id ?? "", steps, scope, known, threadHome), [thread?.id, steps, scope, known, threadHome]);
  const touched = useMemo(() => {
    const out = new Map(fromSteps);
    const cwdOf = new Map(sessions.map((s) => [s.id, s.cwd]));
    for (const a of agents) {
      const only = homeOf(cwdOf.get(a.sessionId), scope, known);
      addTouch(out, a.file, a.ts, false, only, scope, known);
      for (const m of a.trail) addTouch(out, m.file, m.ts, m.action === "edit" || m.action === "write", only, scope, known);
    }
    return out;
  }, [fromSteps, agents, sessions, scope, known]);
  const sig = useMemo(() => [...touched].map(([p, t]) => `${p}@${t.edited ?? ""}`).sort().join("\n") + "|" + (known?.length ?? -1), [touched, known]);
  return useMemo(() => {
    const by = new Map<string, { files: FileNode[]; at: string }>();
    for (const [path, t] of touched) {
      const root = projectOf(path, known);
      const isle = by.get(root) ?? by.set(root, { files: [], at: "" }).get(root)!;
      // A place's files (scratch reports, saved outputs, a copy of the repo: often hundreds) as small dots, so its island
      // doesn't outgrow the project; a project's at a file's usual size.
      isle.files.push({ path, module: "outside", lines: placeNames.has(root) ? 6 : 40, ...(t.edited ? { lastChangedAt: t.edited } : {}) });
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
