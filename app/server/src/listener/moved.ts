// Owned by the lead. Threads from before a repo moved.
// Claude Code files each thread under a folder named after where it ran (~/Documents/brainstorm →
// "-Users-dsy-Documents-brainstorm"). Move the repo to ~/brainstorm and its whole history stays under the old name,
// so the app would open on an empty sidebar. A former home is a project folder whose threads ran in a folder with
// the repo's name that no longer exists, or that now leads here (a symlink left behind by the move).
import { closeSync, existsSync, openSync, readSync, readdirSync, realpathSync, statSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";

/** A path, or one of its segments, as Claude Code spells it in its folder names: every character but a letter or a
 * digit becomes "-". */
export const sanitizeName = (s: string) => s.replace(/[^A-Za-z0-9]/g, "-");

/** Claude Code cuts a folder name at this many characters (and adds a hash of the path). */
const MAX_NAME = 200;

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

/** The repo's main checkout: the root with any `/.claude/worktrees/<name>` suffix removed. */
export const repoBase = (root: string) => resolve(root).replace(/\/\.claude\/worktrees\/[^/]+$/, "");

/** How a project folder (a name under ~/.claude/projects) relates to `root`: "own" when its threads ran in the root
 * itself; "maybe" when its name starts the same, which is a subfolder or a worktree of it but also a sibling ("app"
 * and "app-backend", "app.v2": every non-alphanumeric is "-"), so its threads' folders decide; else false. Both
 * Unicode forms of the root are tried: macOS records the decomposed one, a typed path is usually composed. */
export function folderOf(projectDir: string, root: string): "own" | "maybe" | false {
  let maybe = false;
  for (const form of new Set([resolve(root).normalize("NFC"), resolve(root).normalize("NFD")])) {
    if (projectDir === claudeProjectDir(form)) return "own";
    // Below the root: the root's name and "-", or, past 200 characters, the part of it that fits before the hash.
    const head = (sanitizeName(form) + "-").slice(0, MAX_NAME);
    if (projectDir.length > head.length && projectDir.startsWith(head)) maybe = true;
  }
  return maybe ? "maybe" : false;
}

/** True if `p` is `root` or inside it, whichever Unicode form either is in. */
export const within = (p: string, root: string) => {
  const a = p.normalize("NFC"), r = root.normalize("NFC");
  return a === r || a.startsWith(r.endsWith(sep) ? r : r + sep);
};

const CWD = /"cwd":"((?:[^"\\]|\\.)*)"/g;

/** The folders a Claude Code log's first lines say its thread ran in (`cwd`). With `first`, from the first lines that
 * say one (read 64 KB, then twice as much, …), else every one in the first `limit` bytes. Empty if none is written yet. */
export function fileCwds(file: string, { first = false, limit = 4 * 1024 * 1024 } = {}): string[] {
  let fd: number | undefined;
  const out = new Set<string>();
  try {
    fd = openSync(file, "r");
    let want = first ? 64 * 1024 : limit;
    for (;;) {
      const buf = Buffer.alloc(Math.min(want, limit));
      const n = readSync(fd, buf, 0, buf.length, 0);
      for (const m of buf.toString("utf8", 0, n).matchAll(CWD)) {
        try { out.add(JSON.parse(`"${m[1]}"`) as string); } catch { /* cut mid-escape */ }
      }
      if (out.size || n < buf.length || buf.length >= limit) break;
      want *= 2;
    }
  } catch { /* unreadable */ } finally { if (fd !== undefined) closeSync(fd); }
  return [...out];
}

/** Where a few of the folder's threads ran: every folder each one moved through, since a thread can start
 * elsewhere (a scratch space) and only later work in the repo. */
function cwdsOf(dir: string): string[] {
  let files: string[];
  try { files = readdirSync(dir).filter((f) => f.endsWith(".jsonl")).slice(0, 5); } catch { return []; }
  const out = new Set<string>();
  for (const f of files) for (const c of fileCwds(join(dir, f))) out.add(c);
  return [...out];
}

const real = (p: string) => { try { return realpathSync(p); } catch { return p; } };

/** The path a Claude Code project folder name spells ("-Users-me-old-name" → /Users/me/old-name), found by walking the disk
 * and following links (a rename leaves one behind). Null if no such path exists. */
function linkedPath(name: string): string | null {
  const walk = (dir: string, rest: string, depth: number): string | null => {
    if (!rest) return dir;
    if (depth > 12) return null;
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return null; }
    for (const e of entries) {
      const enc = sanitizeName(e);
      if (rest !== enc && !rest.startsWith(enc + "-")) continue;
      try { if (!statSync(join(dir, e)).isDirectory()) continue; } catch { continue; }
      const hit = rest === enc ? join(dir, e) : walk(join(dir, e), rest.slice(enc.length + 1), depth + 1);
      if (hit) return hit;
    }
    return null;
  };
  return name.startsWith("-") ? walk("/", name.slice(1), 0) : null;
}

const cache = new Map<string, string[]>();

/** The repo's other names: where it used to live (moved or renamed), and its real path when opened through a symlink. Cached per root. */
export function formerRoots(projectsDir: string, root: string): string[] {
  const base = repoBase(root);
  const hit = cache.get(base);
  if (hit) return hit;
  const name = basename(base);
  const tail = "-" + sanitizeName(name);
  // Opened through the symlink the move left behind: new threads record the real path.
  const found: string[] = real(base) !== base ? [real(base)] : [];
  let dirs: string[] = [];
  try { dirs = readdirSync(projectsDir); } catch { /* no Claude Code history */ }
  for (const d of dirs) {
    if (!d.endsWith(tail) || d === claudeProjectDir(base)) continue;
    for (const cwd of cwdsOf(join(projectsDir, d))) {
      const old = repoBase(cwd);
      if (!folderOf(d, old)) continue; // ran elsewhere
      if (basename(old) !== name || old === base || found.includes(old)) continue;
      if (!existsSync(old) || real(old) === real(base)) found.push(old);
    }
  }
  // Renamed, not just moved (~/brainstorm → ~/rundown): the old folder has another name, so only the link the rename left
  // behind tells. A project folder whose name spells a path that now leads here is a former home.
  for (const d of dirs) {
    if (d.endsWith(tail) || d.includes("--claude-worktrees-") || d === claudeProjectDir(base)) continue;
    const old = linkedPath(d);
    if (old && old !== base && !found.includes(old) && real(old) === real(base)) found.push(old);
  }
  cache.set(base, found);
  return found;
}
