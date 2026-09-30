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

/** Build a resolver from any absolute path to the id (absolute path) of the matching map node, or null. */
export function makeFileResolver(map: ProjectMap | null): FileResolver {
  if (!map) return () => null;
  const base = repoBase(map.root);
  const bases = [base, ...(map.formerRoots ?? [])]; // older threads name files where the repo used to live
  const ids = new Set(map.files.map((f) => f.path));
  const byRel = new Map<string, string>();
  for (const f of map.files) {
    const rel = repoRelative(f.path, base);
    if (rel !== null && !byRel.has(rel)) byRel.set(rel, f.path);
  }
  return (abs) => {
    if (!abs) return null;
    if (ids.has(abs)) return abs;
    for (const b of bases) {
      const rel = repoRelative(abs, b);
      if (rel !== null) return byRel.get(rel) ?? null;
    }
    return null;
  };
}
