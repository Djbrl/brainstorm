// What belongs on the map. One rule, shared by the file listing (git or walk), the watcher and live updates,
// so a folder the map never shows is also never read or watched.
import { extname } from "node:path";
import { env } from "../core/local";

/** Folders never looked into, by name. Every dot folder (.git, .idea, .venv, .next, .gradle, .yarn, .tox…) is skipped too. */
export const IGNORE_DIRS = new Set([
  // dependencies
  "node_modules", "bower_components", "jspm_packages", "vendor", "Pods", "Carthage", "site-packages", "venv", "__pycache__",
  // build output, generated code, caches
  "dist", "build", "out", "target", "coverage", "DerivedData", "storybook-static", "tmp", "temp",
  // Rundown's own data folder (app/server/data)
  "data",
]);
export const LOCKFILES = new Set(["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "Cargo.lock", "poetry.lock", "composer.lock"]);
/** Code, styles and docs. Widened 6 Oct 2026 (Vue, Svelte, Swift, Kotlin, Ruby, PHP, C-family...): a Nuxt or iOS project's
 * main files were missing from its map. Imports are read for JS/TS only. */
export const SOURCE_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs", ".java", ".md", ".json", ".css", ".html",
  ".vue", ".svelte", ".astro", ".scss", ".sass", ".less", ".swift", ".kt", ".kts", ".rb", ".php", ".c", ".h", ".cc", ".cpp",
  ".hpp", ".cs", ".m", ".mm", ".dart", ".scala", ".ex", ".exs", ".lua", ".sh", ".sql",
  // More C and C++ (CUDA, Arduino, inline headers), other languages, build and config files (6 Oct 2026).
  ".cxx", ".hh", ".hxx", ".ipp", ".inl", ".ino", ".cu", ".cuh", ".zig", ".nim", ".hs", ".ml", ".mli", ".clj", ".cljs",
  ".erl", ".hrl", ".r", ".jl", ".pl", ".pm", ".ps1", ".bash", ".zsh", ".fish", ".toml", ".yml", ".yaml", ".proto",
  ".graphql", ".gql", ".tf", ".hcl", ".nix", ".cmake", ".gradle", ".groovy", ".mk", ".dockerfile",
]);
/** Files known by their name, with no extension to go by: build, container and task files. */
export const SOURCE_NAMES = new Set([
  "Dockerfile", "Containerfile", "Makefile", "makefile", "GNUmakefile", "CMakeLists.txt", "Justfile", "justfile",
  "Rakefile", "Gemfile", "Procfile", "Vagrantfile", "Jenkinsfile", "Brewfile", "BUILD", "BUILD.bazel", "WORKSPACE",
  "meson.build", "Tiltfile", "Caddyfile",
]);
/**
 * At most this many files on the map: the first scan picks them (see select.ts), new files may add a few more (see
 * liveHeadroom), and files an agent edits always join. RUNDOWN_MAX_FILES overrides it.
 */
export function maxFiles(): number {
  const n = Number(env("MAX_FILES"));
  return Number.isInteger(n) && n > 0 ? n : 3000; // 800 until 6 Oct; the canvas pass made 5,000 smooth at 4× CPU (docs/performance.md)
}
/** New files that appear while the map is open may take it this far past maxFiles(). */
export const liveHeadroom = () => Math.max(100, Math.round(maxFiles() / 8));

/** A folder name the map never looks inside. */
export function isIgnoredDirName(name: string): boolean {
  return name.startsWith(".") || IGNORE_DIRS.has(name) || name.endsWith(".egg-info");
}

/** A file name the map can show: a source extension, not a lockfile. */
export function isSourceName(name: string): boolean {
  if (LOCKFILES.has(name)) return false;
  // Dockerfile.dev, Dockerfile.prod: still a Dockerfile.
  return SOURCE_EXT.has(extname(name)) || SOURCE_NAMES.has(name) || /^(Dockerfile|Containerfile)\./.test(name);
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
