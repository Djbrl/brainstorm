// What belongs on the map. One rule, shared by the file listing (git or walk), the watcher and live updates,
// so a folder the map never shows is also never read or watched.
import { extname } from "node:path";

/** Folders never looked into, by name. Every dot folder (.git, .idea, .venv, .next, .gradle, .yarn, .tox…) is skipped too. */
export const IGNORE_DIRS = new Set([
  // dependencies
  "node_modules", "bower_components", "jspm_packages", "vendor", "Pods", "Carthage", "site-packages", "venv", "__pycache__",
  // build output, generated code, caches
  "dist", "build", "out", "target", "coverage", "DerivedData", "storybook-static", "tmp", "temp",
  // Brainstorm's own data folder (app/server/data)
  "data",
]);
export const LOCKFILES = new Set(["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "Cargo.lock", "poetry.lock", "composer.lock"]);
export const SOURCE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs", ".java", ".md", ".json", ".css", ".html"]);
/**
 * At most this many files on the map: the first scan picks them (see select.ts), new files may add a few more (see
 * liveHeadroom), and files an agent edits always join. BRAINSTORM_MAX_FILES overrides it.
 */
export function maxFiles(): number {
  const n = Number(process.env.BRAINSTORM_MAX_FILES);
  return Number.isInteger(n) && n > 0 ? n : 800;
}
/** New files that appear while the map is open may take it this far past maxFiles(). */
export const liveHeadroom = () => Math.max(100, Math.round(maxFiles() / 8));

/** A folder name the map never looks inside. */
export function isIgnoredDirName(name: string): boolean {
  return name.startsWith(".") || IGNORE_DIRS.has(name) || name.endsWith(".egg-info");
}

/** A file name the map can show: a source extension, not a lockfile. */
export function isSourceName(name: string): boolean {
  return SOURCE_EXT.has(extname(name)) && !LOCKFILES.has(name);
}

const parts = (rel: string) => rel.split(/[\\/]/).filter((p) => p && p !== ".");
const outside = (rel: string) => !rel || rel.startsWith("..") || rel.startsWith("/") || /^[A-Za-z]:/.test(rel);

/** A path relative to the root (either separator) that belongs on the map: no ignored folder on the way, a source file name. */
export function isMappableRel(rel: string): boolean {
  if (outside(rel)) return false;
  const p = parts(rel);
  if (!p.length) return false;
  for (let i = 0; i < p.length - 1; i++) if (isIgnoredDirName(p[i])) return false;
  return isSourceName(p[p.length - 1]);
}

/**
 * A path relative to the root that sits in (or is) an ignored folder: nothing at or below it is on the map. Used on
 * watcher events, which don't say whether the path is a file: a last part that could be a source file (".eslintrc.json")
 * is kept.
 */
export function isInIgnoredDir(rel: string): boolean {
  if (outside(rel)) return true;
  const p = parts(rel);
  if (!p.length) return false;
  for (let i = 0; i < p.length - 1; i++) if (isIgnoredDirName(p[i])) return true;
  const last = p[p.length - 1];
  return isIgnoredDirName(last) && !isSourceName(last);
}

/** The map's module for a file: its first two folders ("packages/web"), or "." at the root. Either separator. */
export function moduleOf(rel: string): string {
  const folders = parts(rel).slice(0, -1).slice(0, 2);
  return folders.length ? folders.join("/") : ".";
}
