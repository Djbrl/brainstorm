// Every git this server runs (listing files, times, status) goes through these settings. A project copied from
// somewhere (a zip with its .git folder, not a fresh clone) can carry a .git/config that names a program for git to
// run: core.fsmonitor, a gpg.program for signed commits, or a filter, diff or merge driver that a .gitattributes line
// switches on (`* filter=x` with `filter.x.clean=<program>` runs it on the next `git status`). With these, git never
// runs any of them. Git reads GIT_CONFIG_COUNT/KEY/VALUE (2.31+) above the repo's own config.
import { Logger } from "@nestjs/common";
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

const SAFE: [string, string][] = [["core.fsmonitor", "false"], ["core.hooksPath", "/dev/null"], ["log.showSignature", "false"]];

/**
 * Drivers a repo's own config may name and keep: exactly what `git lfs install --local` and `git-crypt init` write.
 * Pinning these would make every file they handle look changed. Anything else, even a command that merely mentions
 * one of these tools, is pinned.
 */
const KNOWN: Record<string, Set<string>> = {
  "filter.clean": new Set(["git-lfs clean -- %f", '"git-crypt" clean']),
  "filter.smudge": new Set(["git-lfs smudge -- %f", '"git-crypt" smudge']),
  "filter.process": new Set(["git-lfs filter-process"]),
  "diff.textconv": new Set(['"git-crypt" diff']),
};
/** The keys of a driver that name a program. */
const COMMANDS = new Set(["filter.clean", "filter.smudge", "filter.process", "diff.textconv", "diff.command", "merge.driver"]);

const log = new Logger("Git");

function append(env: NodeJS.ProcessEnv, pins: [string, string][]): void {
  let n = Number(env.GIT_CONFIG_COUNT);
  if (!Number.isInteger(n) || n < 0) n = 0;
  for (const [key, value] of pins) { env[`GIT_CONFIG_KEY_${n}`] = key; env[`GIT_CONFIG_VALUE_${n}`] = value; n++; }
  env.GIT_CONFIG_COUNT = String(n);
}

/** The settings every git gets, in this process's own environment (main.ts, before anything runs git). */
export function protectGit(env: NodeJS.ProcessEnv = process.env): void { append(env, SAFE); }

function safeBase(): NodeJS.ProcessEnv { const env = { ...process.env }; append(env, SAFE); return env; }

/** What the repo's own config names: the pins, and what to check to know it still holds (files' mtimes, HEAD's text). */
type Found = { pins: [string, string][]; files: Map<string, number>; head: string; headText: string };
const cache = new Map<string, Found>();
const warned = new Set<string>();
const mtime = (f: string) => { try { return statSync(f).mtimeMs; } catch { return -1; } };
const text = (f: string) => { try { return readFileSync(f, "utf8"); } catch { return ""; } };
const git = (cwd: string, args: string[]) => execFileSync("git", args,
  { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"], timeout: 5000, windowsHide: true, env: safeBase() });
const exitCode = (e: unknown) => (e as { status?: number | null }).status;

/**
 * Pins for every filter, diff and merge driver the repo's own config names (the person's global config is theirs),
 * [] when `root` isn't in a repo, null when the config can't be read (then no git may run there).
 */
function driverPins(root: string): [string, string][] | null {
  const hit = cache.get(root);
  if (hit && text(hit.head) === hit.headText && [...hit.files].every(([f, m]) => mtime(f) === m)) return hit.pins;
  cache.delete(root);
  let paths: string[];
  try {
    paths = git(root, ["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir", "--git-path", "config.worktree", "--git-path", "HEAD"]).split("\n");
  } catch (e) { return exitCode(e) === 128 ? [] : null; }   // 128: not a repo (git then fails the same way); else: timed out, no git
  const [top, common, worktreeConfig, head] = paths;
  if (!top || !common || !head) return null;
  let out: string;
  try {
    // Reading config runs nothing. Only the driver and include entries, so a huge config of other keys still fits.
    // Entries are scope\0origin\0key\nvalue\0; origins are relative to the top of the repo.
    out = git(top, ["config", "--show-scope", "--show-origin", "--null", "--get-regexp", "^((filter|diff|merge)\\..*|include(if\\..*)?\\.path)$"]);
  } catch (e) {
    if (exitCode(e) !== 1) return null;   // 1: no such entries
    out = "";
  }
  // Watched: the repo's config files, every file they include (even before it exists), and HEAD (`includeIf "onbranch:"`).
  const files = new Map<string, number>();
  const watch = (f: string) => { if (!files.has(f)) files.set(f, mtime(f)); };
  watch(resolve(common, "config")); watch(worktreeConfig);
  const commands = new Map<string, string[]>();   // "kind\0name" -> the values of its command keys
  const parts = out.split("\0");
  for (let i = 0; i + 2 < parts.length; i += 3) {
    const scope = parts[i], origin = parts[i + 1], entry = parts[i + 2];
    if (scope !== "local" && scope !== "worktree") continue;
    const nl = entry.indexOf("\n"), key = nl < 0 ? entry : entry.slice(0, nl), value = nl < 0 ? "" : entry.slice(nl + 1);
    const file = origin.startsWith("file:") ? resolve(top, origin.slice(5)) : null;
    if (file) watch(file);
    if (/^include/i.test(key)) {
      if (file && value) watch(value.startsWith("~/") ? resolve(homedir(), value.slice(2)) : resolve(dirname(file), value));
      continue;
    }
    const m = /^(filter|diff|merge)\.(.+)\.([^.]+)$/i.exec(key);
    if (!m) continue;
    const kind = m[1].toLowerCase(), id = `${kind}\0${m[2]}`, command = `${kind}.${m[3].toLowerCase()}`;
    const list = commands.get(id) ?? commands.set(id, []).get(id)!;
    if (COMMANDS.has(command) && !KNOWN[command]?.has(value.trim())) list.push(value);
  }
  const pins: [string, string][] = [];
  for (const [id, unknown] of commands) {
    if (!unknown.length) continue;   // only known tools' commands (or none: they come from the person's own config)
    const [kind, name] = id.split("\0");
    if (kind === "filter") pins.push([`filter.${name}.clean`, "cat"], [`filter.${name}.smudge`, "cat"], [`filter.${name}.process`, ""], [`filter.${name}.required`, "false"]);
    else if (kind === "diff") pins.push([`diff.${name}.textconv`, ""], [`diff.${name}.command`, ""]);
    else pins.push([`merge.${name}.driver`, ""]);
  }
  cache.set(root, { pins, files, head, headText: text(head) });
  return pins;
}

/**
 * The environment for a git run in `root`: this process's own, plus the settings above, plus a pin for each driver the
 * repo's config names. Null when the repo's config can't be read (too big, git too slow): the caller must not run git
 * there, and acts as if it weren't a repo. Without a root (git config --global), only the settings above.
 */
export function gitEnv(): NodeJS.ProcessEnv;
export function gitEnv(root: string, extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv | null;
export function gitEnv(root?: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv | null {
  const env = { ...safeBase(), ...extra };
  if (!root) return env;
  const pins = driverPins(root);
  if (!pins) {
    if (!warned.has(root)) { warned.add(root); log.warn(`can't read the git settings of ${root}: git isn't run there`); }
    return null;
  }
  warned.delete(root);
  append(env, pins);
  return env;
}

/** gitEnv for a run in `root`, or a throw when git must not run there: for callers whose failure path already means "no git here". */
export function gitEnvOrThrow(root: string, extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = gitEnv(root, extra);
  if (!env) throw new Error(`can't read the git settings of ${root}`);
  return env;
}
