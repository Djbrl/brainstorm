// Every git this server runs (listing files, times, status) goes through these settings. A project copied from
// somewhere (a zip with its .git folder, not a fresh clone) can carry a .git/config that names a program for git to
// run: core.fsmonitor, a gpg.program for signed commits, or a filter, diff or merge driver that a .gitattributes line
// switches on (`* filter=x` with `filter.x.clean=<program>` runs it on the next `git status`). With these, git never
// runs any of them. Git reads GIT_CONFIG_COUNT/KEY/VALUE (2.31+) above the repo's own config.
import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

const SAFE: [string, string][] = [["core.fsmonitor", "false"], ["core.hooksPath", "/dev/null"], ["log.showSignature", "false"]];

function append(env: NodeJS.ProcessEnv, pins: [string, string][]): void {
  let n = Number(env.GIT_CONFIG_COUNT);
  if (!Number.isInteger(n) || n < 0) n = 0;
  for (const [key, value] of pins) { env[`GIT_CONFIG_KEY_${n}`] = key; env[`GIT_CONFIG_VALUE_${n}`] = value; n++; }
  env.GIT_CONFIG_COUNT = String(n);
}

/** The settings every git gets, in this process's own environment (main.ts, before anything runs git). */
export function protectGit(env: NodeJS.ProcessEnv = process.env): void { append(env, SAFE); }

/** What the project's own config (and the files it includes) names: drivers to pin, and the files to watch for changes. */
type Found = { pins: [string, string][]; files: Map<string, number> };
const cache = new Map<string, Found>();
const mtime = (f: string) => { try { return statSync(f).mtimeMs; } catch { return -1; } };

/** Pins for every filter, diff and merge driver the repo's own config names (the person's global config is theirs). */
function driverPins(root: string): [string, string][] {
  const hit = cache.get(root);
  if (hit && [...hit.files].every(([f, m]) => mtime(f) === m)) return hit.pins;
  let out: string;
  try {
    // Reading config runs nothing. Entries are scope\0origin\0key\nvalue\0.
    out = execFileSync("git", ["config", "--show-scope", "--show-origin", "--null", "--list"],
      { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"], timeout: 5000, windowsHide: true, env: safeBase() });
  } catch { cache.delete(root); return []; }   // not a repo (git then fails the same way), or no git
  const parts = out.split("\0");
  const drivers = new Set<string>(), files = new Map<string, number>();
  for (let i = 0; i + 2 < parts.length; i += 3) {
    const scope = parts[i], origin = parts[i + 1], entry = parts[i + 2];
    if (scope !== "local" && scope !== "worktree") continue;
    const nl = entry.indexOf("\n"), key = nl < 0 ? entry : entry.slice(0, nl), value = nl < 0 ? "" : entry.slice(nl + 1);
    const file = origin.startsWith("file:") ? resolve(root, origin.slice(5)) : null;
    if (file && !files.has(file)) files.set(file, mtime(file));
    // A file it includes can be a tracked one that a pull changes: watch it too, even before it exists.
    if (file && /^include(if\..*)?\.path$/i.test(key) && value) {
      const target = value.startsWith("~/") ? resolve(homedir(), value.slice(2)) : resolve(dirname(file), value);
      if (!files.has(target)) files.set(target, mtime(target));
    }
    const m = /^(filter|diff|merge)\.(.+)\.[^.]+$/i.exec(key);
    if (m) drivers.add(`${m[1].toLowerCase()}\0${m[2]}`);
  }
  const pins: [string, string][] = [];
  for (const d of drivers) {
    const [kind, name] = d.split("\0");
    if (kind === "filter") pins.push([`filter.${name}.clean`, "cat"], [`filter.${name}.smudge`, "cat"], [`filter.${name}.process`, ""], [`filter.${name}.required`, "false"]);
    else if (kind === "diff") pins.push([`diff.${name}.textconv`, ""], [`diff.${name}.command`, ""]);
    else pins.push([`merge.${name}.driver`, ""]);
  }
  if (files.size) cache.set(root, { pins, files }); // none: not a repo yet (a `git init` later must be seen)
  else cache.delete(root);
  return pins;
}

function safeBase(): NodeJS.ProcessEnv { const env = { ...process.env }; append(env, SAFE); return env; }

/**
 * The environment for a git run in `root`: this process's own, plus the settings above, plus a pin for each driver the
 * repo's config names. Without a root (git config --global), only the settings above. Worked out again when the
 * repo's config files change.
 */
export function gitEnv(root?: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env = { ...safeBase(), ...extra };
  if (root) append(env, driverPins(root));
  return env;
}
