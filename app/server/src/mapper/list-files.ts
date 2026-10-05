// Which files a project has, for the map. A git repo asks git (`ls-files -co --exclude-standard`: tracked files plus
// new ones, minus .gitignore'd), anything else walks the folder. Both go through the same ignore rule. When there are
// more than the cap, it also says when each file last changed, so select.ts can choose deliberately.
import { execFileSync, spawn } from "node:child_process";
import { readdirSync, statSync, type Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { isIgnoredDirName, isMappableRel, isSourceName } from "./ignore";
import { recentCommitTimes, recentCommitTimesSync } from "./git-times";

export type Listing = {
  /** Every mappable file found, relative with "/" separators, sorted, at most CANDIDATE_LIMIT. */
  rels: string[];
  /** Of `rels`, the ones git tracks: only these can have a commit time. Undefined when not a git repo. */
  tracked?: Set<string>;
  /** How many mappable files exist (can exceed rels.length in a giant repo). */
  total: number;
  source: "git" | "walk";
  /** Only past the cap: when files last changed (s). Git: the newest of the last 1000 commits that touched the file, or the modification time of a new file. Walk: modification times. */
  changedAt?: Map<string, number>;
  /** Only past the cap: exact last-commit times (s) learned from that recent history. */
  recent?: Map<string, number>;
};

type Candidates = { rels: string[]; tracked?: Set<string>; total: number };

/** Stop collecting candidates past this many: enough to choose from, without holding a giant repo in memory. */
const CANDIDATE_LIMIT = 50_000;
/** Past the cap, stat at most this many files for their modification time. */
const STAT_LIMIT = 20_000;
const STAT_CONCURRENCY = 64;
const LS_ARGS = (root: string) => ["-C", root, "-c", "core.quotepath=off", "ls-files", "-z", "-t", "-c", "-o", "--exclude-standard"];

/** Parse `ls-files -z -t` entries ("H path", "? path"): mappable relative paths, and which of them are tracked. */
export function parseLsFiles(entries: Iterable<string>, out: { rels: string[]; tracked: Set<string>; total: number }) {
  for (const entry of entries) {
    if (entry.length < 3) continue;
    const tag = entry[0], rel = entry.slice(2);
    if (!isMappableRel(rel)) continue;
    out.total++;
    if (out.rels.length >= CANDIDATE_LIMIT) continue;
    out.rels.push(rel);
    if (tag !== "?") out.tracked.add(rel);
  }
}

function listing(cand: Candidates, source: Listing["source"], changedAt?: Map<string, number>, recent?: Map<string, number>): Listing {
  const rels = [...new Set(cand.rels)].sort(); // an unmerged file is listed once per stage
  return { rels, tracked: cand.tracked, total: Math.max(cand.total, rels.length), source, changedAt, recent };
}

// ---- git ----

function gitCandidates(root: string): Promise<Candidates | null> {
  return new Promise((resolveP) => {
    let child;
    try { child = spawn("git", LS_ARGS(root), { stdio: ["ignore", "pipe", "ignore"], windowsHide: true }); } catch { return resolveP(null); }
    const acc = { rels: [] as string[], tracked: new Set<string>(), total: 0 };
    let rest = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      const parts = (rest + chunk).split("\0");
      rest = parts.pop() ?? "";
      parseLsFiles(parts, acc);
    });
    child.on("error", () => resolveP(null));
    child.on("close", (code) => {
      if (rest) parseLsFiles([rest], acc);
      resolveP(code === 0 && acc.total ? acc : null); // not a repo, no git, or nothing mappable: walk instead
    });
  });
}

function gitCandidatesSync(root: string): Candidates | null {
  try {
    const out = execFileSync("git", LS_ARGS(root), { encoding: "utf8", maxBuffer: 512 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"], timeout: 30_000, windowsHide: true });
    const acc = { rels: [] as string[], tracked: new Set<string>(), total: 0 };
    parseLsFiles(out.split("\0"), acc);
    return acc.total ? acc : null;
  } catch { return null; }
}

// ---- walk ----

const byName = (a: Dirent, b: Dirent) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/** Depth first, folders in name order, skipping ignored folders and symlinked folders (loops; git doesn't follow them either). */
async function walkCandidates(root: string): Promise<Candidates> {
  const acc: Candidates = { rels: [], total: 0 };
  const visit = async (dir: string, relDir: string): Promise<void> => {
    let entries: Dirent[];
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    entries.sort(byName);
    for (const e of entries) {
      if (acc.rels.length >= CANDIDATE_LIMIT) return;
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      let isFile = e.isFile();
      if (e.isSymbolicLink()) { try { isFile = (await stat(join(dir, e.name))).isFile(); } catch { continue; } }
      if (e.isDirectory()) { if (!isIgnoredDirName(e.name)) await visit(join(dir, e.name), rel); }
      else if (isFile && isSourceName(e.name)) { acc.rels.push(rel); acc.total++; }
    }
  };
  await visit(root, "");
  return acc;
}

function walkCandidatesSync(root: string): Candidates {
  const acc: Candidates = { rels: [], total: 0 };
  const visit = (dir: string, relDir: string): void => {
    let entries: Dirent[];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    entries.sort(byName);
    for (const e of entries) {
      if (acc.rels.length >= CANDIDATE_LIMIT) return;
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      let isFile = e.isFile();
      if (e.isSymbolicLink()) { try { isFile = statSync(join(dir, e.name)).isFile(); } catch { continue; } }
      if (e.isDirectory()) { if (!isIgnoredDirName(e.name)) visit(join(dir, e.name), rel); }
      else if (isFile && isSourceName(e.name)) { acc.rels.push(rel); acc.total++; }
    }
  };
  visit(root, "");
  return acc;
}

// ---- modification times (seconds) ----

async function mtimesOf(root: string, rels: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(STAT_CONCURRENCY, rels.length) }, async () => {
    while (next < rels.length) {
      const rel = rels[next++];
      try { out.set(rel, (await stat(join(root, rel))).mtimeMs / 1000); } catch { /* gone */ }
    }
  }));
  return out;
}

function mtimesOfSync(root: string, rels: string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const rel of rels) { try { out.set(rel, statSync(join(root, rel)).mtimeMs / 1000); } catch { /* gone */ } }
  return out;
}

const untrackedOf = (c: Candidates) => c.rels.filter((rel) => !c.tracked?.has(rel)).slice(0, STAT_LIMIT);
const merge = (recent: Map<string, number>, mtimes: Map<string, number>) => { const m = new Map(mtimes); for (const [k, v] of recent) m.set(k, v); return m; };

// ---- entry points ----

/** The project's files: git when it's a git repo, else a walk. Never blocks the event loop for long. */
export async function listProjectFiles(root: string, cap: number): Promise<Listing> {
  const git = await gitCandidates(root);
  if (git) {
    if (git.rels.length <= cap) return listing(git, "git");
    const [recent, mtimes] = await Promise.all([recentCommitTimes(root), mtimesOf(root, untrackedOf(git))]);
    return listing(git, "git", merge(recent, mtimes), recent);
  }
  const walked = await walkCandidates(root);
  if (walked.rels.length <= cap) return listing(walked, "walk");
  return listing(walked, "walk", await mtimesOf(root, walked.rels.slice(0, STAT_LIMIT)));
}

/** Same as listProjectFiles, blocking. Only for a caller that needs a map right now and has none cached. */
export function listProjectFilesSync(root: string, cap: number): Listing {
  const git = gitCandidatesSync(root);
  if (git) {
    if (git.rels.length <= cap) return listing(git, "git");
    const recent = recentCommitTimesSync(root);
    return listing(git, "git", merge(recent, mtimesOfSync(root, untrackedOf(git))), recent);
  }
  const walked = walkCandidatesSync(root);
  if (walked.rels.length <= cap) return listing(walked, "walk");
  return listing(walked, "walk", mtimesOfSync(root, walked.rels.slice(0, STAT_LIMIT)));
}

/** Of these relative paths, the ones .gitignore excludes (`git check-ignore --stdin`). Empty when git can't say. */
export function gitIgnored(root: string, rels: string[]): Promise<Set<string>> {
  return new Promise((resolveP) => {
    const out = new Set<string>();
    if (!rels.length) return resolveP(out);
    let child;
    try { child = spawn("git", ["-C", root, "check-ignore", "-z", "--stdin"], { stdio: ["pipe", "pipe", "ignore"], windowsHide: true }); } catch { return resolveP(out); }
    let buf = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d: string) => { buf += d; });
    child.on("error", () => resolveP(new Set()));
    child.on("close", (code) => {
      if (code !== 0) return resolveP(out); // 1: none ignored; 128: not a repo
      for (const p of buf.split("\0")) if (p) out.add(p);
      resolveP(out);
    });
    child.stdin.on("error", () => { /* git exited early */ });
    child.stdin.end(rels.join("\0") + "\0");
  });
}

/** Mappable files under a folder (for a folder that appeared while watching), at most `limit`. */
export async function listFolder(dir: string, limit: number): Promise<string[]> {
  const out: string[] = [];
  const visit = async (d: string): Promise<void> => {
    let entries: Dirent[];
    try { entries = await readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= limit) return;
      const abs = join(d, e.name);
      if (e.isDirectory()) { if (!isIgnoredDirName(e.name)) await visit(abs); }
      else if ((e.isFile() || e.isSymbolicLink()) && isSourceName(e.name)) out.push(abs);
    }
  };
  if (limit > 0) await visit(dir);
  return out;
}
