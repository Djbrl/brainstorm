// When each mapped file was last committed, from `git log --name-only`, read as a stream in the background.
// It stops as soon as every wanted file has a time, and in any case after `maxCommits` commits or `timeoutMs`,
// so a repo with a long history never blocks the server or fills memory.
import { execFileSync, spawn } from "node:child_process";

export type GitTimesOptions = { maxCommits?: number; timeoutMs?: number };

/** Feed `git log --name-only --format=%x01%ct` lines; remembers the newest commit time per wanted path (every path when `wanted` is undefined). */
export class GitLogParser {
  readonly times = new Map<string, number>();
  private current = 0;
  private left: number;
  commits = 0;
  constructor(private wanted?: Set<string>) { this.left = wanted ? wanted.size : Infinity; }
  /** True once every wanted path has a time. */
  get done() { return this.left === 0; }
  line(line: string) {
    if (line.charCodeAt(0) === 1) { this.current = Number(line.slice(1)) || 0; this.commits++; return; }
    const rel = line.trim();
    if (!rel || (this.wanted && !this.wanted.has(rel)) || this.times.has(rel)) return;
    this.times.set(rel, this.current);
    this.left--;
  }
}

const RECENT_ARGS = (root: string, n: number) => ["-C", root, "-c", "core.quotepath=off", "log", `--max-count=${n}`, "--name-only", "--format=%x01%ct"];

/** Every path touched by the last `n` commits, with its newest commit time (s): where the work is happening. Empty when git can't say. */
export function recentCommitTimes(root: string, n = 1000, timeoutMs = 5000): Promise<Map<string, number>> {
  return new Promise((resolveP) => {
    const parser = new GitLogParser();
    let child;
    try { child = spawn("git", RECENT_ARGS(root, n), { stdio: ["ignore", "pipe", "ignore"], windowsHide: true, timeout: timeoutMs }); } catch { return resolveP(parser.times); }
    let rest = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      const lines = (rest + chunk).split("\n");
      rest = lines.pop() ?? "";
      for (const l of lines) parser.line(l);
    });
    child.on("error", () => resolveP(parser.times));
    child.on("close", () => { if (rest) parser.line(rest); resolveP(parser.times); });
  });
}

export function recentCommitTimesSync(root: string, n = 1000, timeoutMs = 5000): Map<string, number> {
  const parser = new GitLogParser();
  try {
    const out = execFileSync("git", RECENT_ARGS(root, n), { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"], timeout: timeoutMs, windowsHide: true });
    for (const l of out.split("\n")) parser.line(l);
  } catch { /* not a repo, no commits yet, or no git */ }
  return parser.times;
}

/** Newest commit time (seconds) of each wanted path ("/" separators, relative to the root). Never rejects: an empty map when git can't answer. */
export function gitLastCommitTimes(root: string, wanted: Set<string>, opts: GitTimesOptions = {}): Promise<{ times: Map<string, number>; commits: number; complete: boolean; error?: string }> {
  const maxCommits = opts.maxCommits ?? 20_000;
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const parser = new GitLogParser(wanted);
  if (!wanted.size) return Promise.resolve({ times: parser.times, commits: 0, complete: true });
  return new Promise((resolveP) => {
    let child;
    try {
      child = spawn("git", ["-C", root, "-c", "core.quotepath=off", "log", `--max-count=${maxCommits}`, "--name-only", "--format=%x01%ct"], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    } catch (e) { return resolveP({ times: parser.times, commits: 0, complete: false, error: (e as Error).message }); }
    let rest = "", stderr = "", settled = false, stoppedEarly = false;
    const finish = (error?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveP({ times: parser.times, commits: parser.commits, complete: parser.done, error });
    };
    const stop = () => { stoppedEarly = true; child.kill(); finish(); };
    const timer = setTimeout(stop, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (settled) return;
      const lines = (rest + chunk).split("\n");
      rest = lines.pop() ?? "";
      for (const l of lines) { parser.line(l); if (parser.done) return stop(); }
    });
    child.stderr.on("data", (d: Buffer) => { if (stderr.length < 2000) stderr += d.toString(); });
    child.on("error", (e) => finish(e.message));
    child.on("close", (code) => {
      if (rest) parser.line(rest);
      finish(code === 0 || stoppedEarly ? undefined : stderr.trim() || `git exited with ${code}`);
    });
  });
}
