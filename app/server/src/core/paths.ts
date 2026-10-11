// Paths on this machine, for the server: one copy of "inside the root". `inside` (shared/paths.ts) is the plain string
// test, the root included; `relativeTo` is the path below a root (the root itself excluded); `real` follows links.
// On purpose elsewhere: listener/moved.ts `within` (either Unicode form), mapper/ignore.ts `outside` (a relative path,
// either separator).
import { realpathSync } from "node:fs";
import { isAbsolute, relative } from "node:path";
import { inside } from "../shared/paths";

export { inside };

/** The path with every link followed; the path as given when it doesn't exist (or can't be read). */
export const real = (p: string) => { try { return realpathSync(p); } catch { return p; } };

/** `p` relative to `root` when it is below it ("src/a.ts"); null for the root itself and anything outside. */
export function relativeTo(p: string, root: string): string | null {
  const r = relative(root, p);
  return r && !r.startsWith("..") && !isAbsolute(r) ? r : null;
}

/** `path` is below one of `roots`, after following links on both sides (a link in the project can't lead out). */
export const insideAny = (path: string, roots: string[]) => { const p = real(path); return roots.some((r) => relativeTo(p, real(r)) !== null); };
