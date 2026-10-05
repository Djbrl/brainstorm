// Owner: thread-replay foundation. Match a file an agent touched to a node on the map,
// even when the agent worked in another git worktree of the same repo.
import type { ProjectMap } from "@contract";

const WORKTREE = /^(.*?)\/\.claude\/worktrees\/[^/]+(?:\/(.*))?$/;

/** The repo's main checkout: the map root with any `/.claude/worktrees/<name>` suffix removed. */
export function repoBase(root: string): string {
  return root.replace(/\/+$/, "").replace(/\/\.claude\/worktrees\/[^/]+$/, "");
}

/**
 * Path relative to the repo, for any checkout of it:
 * `<base>/app/x.ts` and `<base>/.claude/worktrees/<name>/app/x.ts` both give `app/x.ts`.
 * Returns null for files outside the repo (scratch folders, other projects).
 */
export function repoRelative(abs: string, base: string): string | null {
  const m = abs.match(WORKTREE);
  if (m && m[1] === base) return m[2] ?? "";
  if (abs.startsWith(base + "/")) return abs.slice(base.length + 1);
  return null;
}

export type FileResolver = (abs: string | undefined) => string | null;

const noMap: FileResolver = () => null;

/**
 * The last resolver built. A resolver only depends on the map's root, former roots and file paths (in order), so a
 * new map that only changed a file's fields (every "file" message) gets the same resolver back: one build instead of
 * one per component, and threads built against it (lib/thread's cache) stay valid.
 */
let last: { root: string; formerRoots: string[]; paths: string[]; files: ProjectMap["files"]; version?: number; resolve: FileResolver } | null = null;

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Build a resolver from any absolute path to the id (absolute path) of the matching map node, or null.
 * `structureVersion` (optional): a number the store changes whenever a file is added or removed or the map is replaced;
 * when given and unchanged, the paths aren't compared again.
 */
export function makeFileResolver(map: ProjectMap | null, structureVersion?: number): FileResolver {
  if (!map) return noMap;
  const formerRoots = map.formerRoots ?? [];
  if (last && last.root === map.root && sameList(last.formerRoots, formerRoots) && last.paths.length === map.files.length) {
    const same = last.files === map.files
      || (structureVersion !== undefined && structureVersion === last.version)
      || map.files.every((f, i) => f.path === last!.paths[i]);
    if (same) { last.files = map.files; last.version = structureVersion; return last.resolve; }
  }
  const resolve = buildResolver(map);
  last = { root: map.root, formerRoots: [...formerRoots], paths: map.files.map((f) => f.path), files: map.files, version: structureVersion, resolve };
  return resolve;
}

function buildResolver(map: ProjectMap): FileResolver {
  const base = repoBase(map.root);
  const bases = [base, ...(map.formerRoots ?? [])]; // older threads name files where the repo used to live
  const ids = new Set(map.files.map((f) => f.path));
  const byRel = new Map<string, string>();
  for (const f of map.files) {
    const rel = repoRelative(f.path, base);
    if (rel !== null && !byRel.has(rel)) byRel.set(rel, f.path);
  }
  const seen = new Map<string, string | null>(); // a thread names the same files again and again
  const find = (abs: string) => {
    if (ids.has(abs)) return abs;
    for (const b of bases) {
      const rel = repoRelative(abs, b);
      if (rel !== null) return byRel.get(rel) ?? null;
    }
    return null;
  };
  return (abs) => {
    if (!abs) return null;
    let hit = seen.get(abs);
    if (hit === undefined) seen.set(abs, (hit = find(abs)));
    return hit;
  };
}
