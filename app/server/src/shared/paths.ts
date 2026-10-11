// Paths, for the server and the web: git worktrees of a repo (Claude Code's `<repo>/.claude/worktrees/<name>`), a path
// inside a folder, and the folder names Claude Code keeps threads under. Plain string work, "/" paths, no Node imports.

const WORKTREE = /^(.*?)\/\.claude\/worktrees\/[^/]+(?:\/(.*))?$/;

/** The repo's main checkout: the root with any `/.claude/worktrees/<name>` suffix (and trailing slashes) removed. */
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

/** A worktree's path as the same path in its repo (".../repo/.claude/worktrees/x/src/a.ts" → ".../repo/src/a.ts"). */
export const outOfWorktree = (p: string) => p.replace(/\/\.claude\/worktrees\/[^/]+(?=\/|$)/, "");

/** The repo a path in a worktree belongs to (".../repo/.claude/worktrees/x/src/a.ts" → ".../repo"); other paths as they are. */
export const worktreeRepo = (p: string) => p.replace(/\/\.claude\/worktrees\/[^/]+(?:\/.*)?$/, "");

/** True if `p` is `root` or inside it. */
export const inside = (p: string, root: string) => p === root || p.startsWith(root.endsWith("/") ? root : root + "/");

/** A path, or one of its segments, as Claude Code spells it in its folder names: every character but a letter or a
 * digit becomes "-". */
export const sanitizeName = (s: string) => s.replace(/[^A-Za-z0-9]/g, "-");

/** Claude Code cuts a folder name at this many characters (and adds a hash of the path). */
export const MAX_NAME = 200;

/** Java's String.hashCode (32 bits, over UTF-16 code units), as Claude Code computes it for long folder names. */
function javaHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

/** The folder under ~/.claude/projects that Claude Code keeps the threads that ran in `path` in: the path sanitized
 * ("/Users/me/repo" → "-Users-me-repo"); a name over 200 characters is cut there, with "-" and the path's hash in
 * base 36 after it (Claude Code 2.1's naming, read from its code). */
export function claudeProjectDir(path: string): string {
  const name = sanitizeName(path);
  return name.length <= MAX_NAME ? name : `${name.slice(0, MAX_NAME)}-${Math.abs(javaHash(path)).toString(36)}`;
}
