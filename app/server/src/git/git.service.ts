import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { execFile } from "node:child_process";
import { existsSync, watch, type FSWatcher } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type { GitFileState, GitState, GitWorktree, Step } from "../types";
import { BusService } from "../core/bus.service";
import { EventsGateway } from "../core/events.gateway";
import { ListenerService } from "../listener/listener.service";
import { WorkspaceService } from "../workspace/workspace.service";

// Owner: git. The project's git state for the map's Git view: the branch, what isn't committed, what isn't pushed, and
// the repo's other checkouts (worktrees, where agents work) with what each has on its branch. Read with plain git
// commands (a status is 20–40 ms on this repo), worked out again a moment after something changes: the mapper's batch
// of changed files (your edits), a step (an agent edits or commits), the repo's refs (a commit, a branch switch, a push
// from a terminal). Never on a timer, except a slow check for what none of those see (edits in a worktree by hand).
// `git status` runs without optional locks, so it never rewrites the index and wakes the watch itself.

const run = promisify(execFile);
const SETTLE_MS = 600;          // changes come in bursts: work it out once they settle
const MIN_GAP_MS = 2000;        // and at most this often while they keep coming
const SLOW_CHECK_MS = 60_000;   // edits nobody announces (a worktree edited by hand)
const MAX_WORKTREES = 30;

@Injectable()
export class GitService implements OnModuleInit, OnModuleDestroy {
  private log = new Logger("git");
  private root: string | null = null;
  private state: GitState | null = null;
  private sent = "";
  private watcher?: FSWatcher;
  private timer?: NodeJS.Timeout;
  private slow?: NodeJS.Timeout;
  private running = false;
  private again = false;
  private lastRun = 0;

  constructor(private bus: BusService, private gateway: EventsGateway, private listener: ListenerService, private ws: WorkspaceService) {}

  onModuleInit() {
    this.bus.on("workspace", ({ root }) => this.setRoot(root));
    this.bus.on("files-changed", ({ root }) => { if (root === this.root) this.soon(); });
    this.bus.on("step", (s: Step) => { if (s.kind === "edit" || s.kind === "tool_result") this.soon(); });
    setTimeout(() => { const r = this.ws.status().root; if (r && !this.root) this.setRoot(r); }, 500);
    this.slow = setInterval(() => this.soon(), SLOW_CHECK_MS);
  }
  onModuleDestroy() { this.watcher?.close(); clearTimeout(this.timer); clearInterval(this.slow); }

  /** The state worked out last (null: no project, or not a git repo). */
  get(): GitState | null { return this.state; }

  private setRoot(root: string) {
    if (root === this.root) return;
    this.root = root; this.state = null; this.sent = "";
    this.watcher?.close(); this.watcher = undefined;
    void this.git(["rev-parse", "--git-common-dir"], root).then((dir) => {
      if (this.root !== root || !dir) return;
      const gitDir = resolve(root, dir.trim());
      try {
        // Refs, HEAD and the worktrees' HEADs: commits, branch switches, pushes. Not objects or logs (every commit
        // writes many), not the index (staging doesn't change what's committed).
        this.watcher = watch(gitDir, { recursive: true, persistent: false }, (_e, name) => {
          const n = name?.toString() ?? "";
          if (/^(objects|logs|lfs|hooks)[\\/]/.test(n) || /(^|[\\/])index(\.lock)?$/.test(n) || n.endsWith(".lock")) return;
          this.soon();
        });
        this.watcher.on("error", () => { this.watcher?.close(); this.watcher = undefined; });
      } catch { /* no recursive watch here: the steps, the mapper and the slow check still bring it up to date */ }
    }).catch(() => {});
    this.soon(0);
  }

  /** Work it out again once changes settle (and not more often than MIN_GAP_MS). */
  private soon(ms = SETTLE_MS) {
    if (!this.root) return;
    clearTimeout(this.timer);
    const wait = Math.max(ms, this.lastRun + MIN_GAP_MS - Date.now());
    this.timer = setTimeout(() => void this.refresh(), wait);
  }

  private async refresh() {
    if (this.running) { this.again = true; return; }
    const root = this.root;
    if (!root) return;
    this.running = true; this.lastRun = Date.now();
    try {
      const next = await this.read(root);
      if (this.root !== root) return;
      this.state = next;
      const key = JSON.stringify(next ? { ...next, at: "" } : null);
      if (key !== this.sent) { this.sent = key; this.gateway.broadcast({ type: "git", git: next }); }
    } catch (e) {
      this.log.warn(`git state: ${(e as Error).message}`);
    } finally {
      this.running = false;
      if (this.again) { this.again = false; this.soon(); }
    }
  }

  private async git(args: string[], cwd: string): Promise<string> {
    const { stdout } = await run("git", ["--no-optional-locks", ...args], { cwd, maxBuffer: 64 * 1024 * 1024, timeout: 15_000, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" } });
    return stdout;
  }

  /** The whole state for a project root, or null if it isn't in a git repo. */
  async read(root: string): Promise<GitState | null> {
    let top: string;
    try { top = (await this.git(["rev-parse", "--show-toplevel"], root)).trim(); } catch { return null; }
    // Paths come from git relative to the repo's top; the map's root may be a folder inside it.
    const prefix = relative(top, root).split(sep).join("/");
    const toMap = (p: string): string | null => (!prefix ? p : p.startsWith(prefix + "/") ? p.slice(prefix.length + 1) : null);

    const status = parseStatus(await this.git(["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"], top));
    const uncommitted = remap(status.files, toMap);
    let unpushed: string[] | null = null;
    if (status.upstream) {
      unpushed = status.ahead ? names(await this.git(["diff", "--name-only", "-z", `${status.upstream}...HEAD`], top)).map(toMap).filter((p): p is string => !!p) : [];
    }

    // The other checkouts, and who works in them.
    const lines = (await this.git(["worktree", "list", "--porcelain"], top)).split("\n");
    const list: { path: string; head?: string; branch?: string }[] = [];
    for (const l of lines) {
      if (l.startsWith("worktree ")) list.push({ path: l.slice(9) });
      else if (l.startsWith("HEAD ") && list.length) list[list.length - 1].head = l.slice(5);
      else if (l.startsWith("branch ") && list.length) list[list.length - 1].branch = l.slice(7).replace(/^refs\/heads\//, "");
    }
    const sessions = this.listener.listSessions();
    const dates = new Map<string, string>();
    for (const l of (await this.git(["for-each-ref", "--format=%(refname:short)%09%(committerdate:iso-strict)", "refs/heads"], top)).split("\n")) {
      const [name, at] = l.split("\t"); if (name) dates.set(name, at);
    }
    const worktrees: GitWorktree[] = [];
    for (const w of list) {
      if (worktrees.length >= MAX_WORKTREES) break;
      if (!w.head || resolve(w.path) === resolve(top) || !existsSync(w.path)) continue;
      const ahead = Number((await this.git(["rev-list", "--count", `HEAD..${w.head}`], top)).trim()) || 0;
      const committed = ahead ? names(await this.git(["diff", "--name-only", "-z", `HEAD...${w.head}`], top)).map(toMap).filter((p): p is string => !!p) : [];
      let wUncommitted: Record<string, GitFileState> = {};
      try { wUncommitted = remap(parseStatus(await this.git(["status", "--porcelain=v2", "-z", "--untracked-files=all"], w.path)).files, toMap); } catch { /* gone meanwhile */ }
      const dir = resolve(w.path) + sep;
      const threads = sessions.filter((s) => s.cwd && (resolve(s.cwd) + sep).startsWith(dir)).map((s) => s.id).slice(0, 5);
      worktrees.push({ path: w.path, branch: w.branch ?? `detached at ${w.head.slice(0, 7)}`, ahead, merged: ahead === 0, committed, uncommitted: wUncommitted, threads,
        lastCommitAt: w.branch ? dates.get(w.branch) : undefined });
    }
    worktrees.sort((a, b) => Number(a.merged) - Number(b.merged) || (b.lastCommitAt ?? "").localeCompare(a.lastCommitAt ?? ""));
    return { root, branch: status.branch, upstream: status.upstream, ahead: status.ahead, behind: status.behind, uncommitted, unpushed, worktrees, at: new Date().toISOString() };
  }
}

/** NUL-separated names (`git diff --name-only -z`). */
const names = (out: string) => out.split("\0").filter(Boolean);
function remap(files: Record<string, GitFileState>, toMap: (p: string) => string | null) {
  const out: Record<string, GitFileState> = {};
  for (const [p, s] of Object.entries(files)) { const m = toMap(p); if (m) out[m] = s; }
  return out;
}

/** `git status --porcelain=v2 [--branch] -z`: the branch headers and each changed or untracked file's state. */
export function parseStatus(out: string): { branch: string | null; upstream?: string; ahead: number; behind: number; files: Record<string, GitFileState> } {
  const parts = out.split("\0");
  let branch: string | null = null, upstream: string | undefined, ahead = 0, behind = 0;
  const files: Record<string, GitFileState> = {};
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    if (!e) continue;
    if (e.startsWith("# branch.head ")) { const h = e.slice(14); branch = h === "(detached)" ? null : h; }
    else if (e.startsWith("# branch.upstream ")) upstream = e.slice(18);
    else if (e.startsWith("# branch.ab ")) { const m = /\+(\d+) -(\d+)/.exec(e); if (m) { ahead = +m[1]; behind = +m[2]; } }
    else if (e.startsWith("? ")) files[e.slice(2)] = "untracked";
    else if (e.startsWith("u ")) files[e.split(" ").slice(10).join(" ")] = "conflict";
    else if (e.startsWith("1 ") || e.startsWith("2 ")) {
      const f = e.split(" "), xy = f[1];
      const path = f.slice(e.startsWith("1 ") ? 8 : 9).join(" ");
      if (e.startsWith("2 ")) i++;   // a rename's old path follows in its own field
      files[path] = /D/.test(xy) ? "deleted" : /A/.test(xy) ? "added" : e.startsWith("2 ") ? "renamed" : "modified";
    }
  }
  return { branch, upstream, ahead, behind, files };
}

