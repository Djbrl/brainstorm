// Owned by the lead. Threads from before a repo moved.
// Claude Code files each thread under a folder named after where it ran (~/Documents/brainstorm →
// "-Users-dsy-Documents-brainstorm"). Move the repo to ~/brainstorm and its whole history stays under the old name,
// so the app would open on an empty sidebar. A former home is a project folder whose threads ran in a folder with
// the repo's name that no longer exists, or that now leads here (a symlink left behind by the move).
import { closeSync, existsSync, openSync, readSync, readdirSync, realpathSync } from "node:fs";
import { basename, join, resolve } from "node:path";

/** `root.replace(/[^A-Za-z0-9-]/g, "-")`, Claude Code's own project-folder naming. */
export const encodeRoot = (root: string) => resolve(root).replace(/[^A-Za-z0-9-]/g, "-");

/** The repo's main checkout: the root with any `/.claude/worktrees/<name>` suffix removed. */
export const repoBase = (root: string) => resolve(root).replace(/\/\.claude\/worktrees\/[^/]+$/, "");

/** True if a project folder belongs to `prefix`: the folder itself, a worktree or a subfolder of it, but not a
 * sibling that merely starts the same ("brainstorm2"). */
export const underPrefix = (projectDir: string, prefix: string) => projectDir === prefix || projectDir.startsWith(prefix + "-");

/** Where a few of the folder's threads ran (a folder can hold a thread that ran elsewhere, e.g. a scratch space). */
function cwdsOf(dir: string): string[] {
  let files: string[];
  try { files = readdirSync(dir).filter((f) => f.endsWith(".jsonl")).slice(0, 5); } catch { return []; }
  const out: string[] = [];
  for (const f of files) {
    let fd: number | undefined;
    try {
      fd = openSync(join(dir, f), "r");
      const buf = Buffer.alloc(256 * 1024);
      const n = readSync(fd, buf, 0, buf.length, 0);
      const m = /"cwd":"((?:[^"\\]|\\.)*)"/.exec(buf.toString("utf8", 0, n));
      if (m) out.push(JSON.parse(`"${m[1]}"`) as string);
    } catch { /* unreadable, try the next */ } finally { if (fd !== undefined) closeSync(fd); }
  }
  return out;
}

const real = (p: string) => { try { return realpathSync(p); } catch { return p; } };

const cache = new Map<string, string[]>();

/** The repo's other names: where it used to live, and its real path when opened through a symlink. Cached per root. */
export function formerRoots(projectsDir: string, root: string): string[] {
  const base = repoBase(root);
  const hit = cache.get(base);
  if (hit) return hit;
  const name = basename(base);
  const tail = "-" + name.replace(/[^A-Za-z0-9-]/g, "-");
  // Opened through the symlink the move left behind: new threads record the real path.
  const found: string[] = real(base) !== base ? [real(base)] : [];
  let dirs: string[] = [];
  try { dirs = readdirSync(projectsDir); } catch { /* no Claude Code history */ }
  for (const d of dirs) {
    if (!d.endsWith(tail) || d === encodeRoot(base)) continue;
    for (const cwd of cwdsOf(join(projectsDir, d))) {
      const old = repoBase(cwd);
      if (encodeRoot(old) !== d && !d.startsWith(encodeRoot(old) + "-")) continue; // ran elsewhere
      if (basename(old) !== name || old === base || found.includes(old)) continue;
      if (!existsSync(old) || real(old) === real(base)) found.push(old);
    }
  }
  cache.set(base, found);
  return found;
}
