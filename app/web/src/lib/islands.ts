// Owner: islands. Files an agent touches outside the open project: an orchestrator thread editing another repo, a visitor
// from another project. The map draws them as small islands beside the project, one per project (the folders Rundown
// knows as projects; else the folder under your home), holding only the files touched. Clicking one opens that project.
import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { AgentPresence, FileNode, ProjectMap, Step } from "@contract";
import { isReplay } from "./live";
import { repoBase, repoRelative } from "./paths";

export type Island = { root: string; name: string; files: FileNode[] };

/**
 * A file the map could show as outside the project: absolute, in none of the project's checkouts or former folders, and
 * in someone's own folders (not the system's, not a hidden folder like ~/.claude where plans and scratch files live).
 */
export function isOutside(abs: string | undefined, map: ProjectMap | null): abs is string {
  if (!abs || !map || !abs.startsWith("/")) return false;
  const bases = [repoBase(map.root), ...(map.formerRoots ?? [])];
  if (bases.some((b) => repoRelative(abs, b) !== null)) return false;
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

/** The project a file belongs to: the deepest known project around it, else the folder right under the home folder. */
function projectOf(abs: string, known: string[] | null): string {
  const hit = known?.find((r) => abs.startsWith(r + "/"));
  if (hit) return hit;
  const m = /^(\/(?:Users|home)\/[^/]+\/[^/]+)\//.exec(abs);
  return m ? m[1] : abs.slice(0, abs.lastIndexOf("/"));
}

/**
 * The islands for this frame: the outside files of the open thread's steps, and those the live agents on the map are on
 * or went through. Same files, same islands (and the same objects), so the layout only changes when one comes or goes.
 */
export function useIslands(map: ProjectMap | null, steps: Step[] | undefined, agents: AgentPresence[]): Island[] {
  const known = useRoots();
  const touched = useMemo(() => {
    const out = new Map<string, string | undefined>(); // path → its last edit
    const add = (p: string | undefined, editedAt?: string) => {
      if (!isOutside(p, map)) return;
      const was = out.get(p);
      if (!out.has(p) || (editedAt && (!was || editedAt > was))) out.set(p, editedAt ?? was);
    };
    for (const s of steps ?? []) if (s.filePath && (s.kind === "edit" || s.kind === "tool_call")) add(s.filePath, s.kind === "edit" ? s.ts : undefined);
    for (const a of agents) {
      add(a.file);
      for (const m of a.trail) add(m.file, m.action === "edit" || m.action === "write" ? m.ts : undefined);
    }
    return out;
  }, [map, steps, agents]);
  const sig = [...touched].map(([p, at]) => `${p}@${at ?? ""}`).sort().join("\n") + "|" + (known?.length ?? -1);
  return useMemo(() => {
    const by = new Map<string, FileNode[]>();
    for (const [path, at] of touched) {
      const root = projectOf(path, known);
      (by.get(root) ?? by.set(root, []).get(root)!).push({ path, module: "outside", lines: 40, ...(at ? { lastChangedAt: at } : {}) });
    }
    return [...by].sort(([a], [b]) => a.localeCompare(b)).map(([root, files]) => ({
      root, name: root.slice(root.lastIndexOf("/") + 1), files: files.sort((a, b) => a.path.localeCompare(b.path)),
    }));
    // Rebuilt when a file comes or is edited again (the map only lays out again when the files themselves change).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
}
