import { realpathSync } from "node:fs";
import { normalize, sep } from "node:path";

const real = (p: string) => { try { return realpathSync(p); } catch { return normalize(p); } };

/** `path` is inside one of `roots`, after following symlinks on both sides (a link in the project can't lead out). */
export function insideAny(path: string, roots: string[]): boolean {
  const p = real(path);
  return roots.some((r) => { const base = real(r).replace(/[\\/]+$/, "") + sep; return p.startsWith(base); });
}
