import { BadRequestException, ConflictException, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { closeSync, existsSync, openSync, readdirSync, readSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";
import type { SetupStatus, SetupStep, WorkspaceSuggestion } from "../types";
import { DbService } from "../core/db.service";
import { BusService } from "../core/bus.service";
import { EventsGateway } from "../core/events.gateway";
import { ConfigService } from "../core/config.service";
import { ListenerService } from "../listener/listener.service";
import { MapperService } from "../mapper/mapper.service";
import { ReaderService } from "../reader/reader.service";
import { isIdleTranscript } from "./threads";
import { walkCandidates } from "../mapper/list-files";
import { env } from "../core/local";

const execFileP = promisify(execFile);
const encodeRoot = (root: string) => root.replace(/[^A-Za-z0-9-]/g, "-");
const real = (p: string) => { try { return realpathSync(p); } catch { return p; } };

/** Turn a Claude Code project folder name back into a real path by walking the filesystem ("-Users-me-my-app" → /Users/me/my-app). */
export function decodeProjectDir(name: string): string | null {
  const walk = (dir: string, rest: string, depth: number): string | null => {
    if (!rest) return dir;
    if (depth > 12) return null;
    let entries: string[];
    try { entries = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return null; }
    for (const e of entries) {
      const enc = encodeRoot(e);
      if (rest === enc) return join(dir, e);
      if (rest.startsWith(enc + "-")) { const hit = walk(join(dir, e), rest.slice(enc.length + 1), depth + 1); if (hit) return hit; }
    }
    return null;
  };
  return name.startsWith("-") ? walk("/", name.slice(1), 0) : null;
}

/** `claude` on PATH, else the usual install locations, else the copy bundled with the Claude desktop app. */
function claudeCandidates(): string[] {
  const home = homedir();
  const list = ["claude", join(home, ".local/bin/claude"), join(home, ".claude/local/claude"), "/opt/homebrew/bin/claude", "/usr/local/bin/claude"];
  const bundled = join(home, "Library/Application Support/Claude/claude-code");
  try {
    const versions = readdirSync(bundled).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const v of versions) list.push(join(bundled, v, "claude.app/Contents/MacOS/claude"));
  } catch { /* no desktop app */ }
  return list;
}
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const CWD_READ_BYTES = 64 * 1024;
const POLL_MS = 300;
const POLL_TIMEOUT_MS = 5 * 60_000;

// Owner: S (workspace setup, server).
@Injectable()
export class WorkspaceService implements OnModuleInit {
  private log = new Logger("Workspace");
  private root: string | null = null;
  private claudeStep: SetupStep = { id: "claude", label: "Connecting to your agents", state: "pending" };
  private nemotronStep: SetupStep = { id: "nemotron", label: "Nemotron for file summaries", state: "pending" };
  private anthropicStep: SetupStep = { id: "anthropic", label: "Claude for questions", state: "pending" };
  private lastBroadcast = "";
  private pollTimer?: NodeJS.Timeout;
  private gen = 0;

  constructor(
    private dbs: DbService,
    private bus: BusService,
    private gateway: EventsGateway,
    private cfg: ConfigService,
    private listener: ListenerService,
    private mapper: MapperService,
    private reader: ReaderService,
  ) {}

  onModuleInit() {
    this.dbs.db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`);
    // Started by the plugin for a project: that project wins over the saved one.
    const given = env("ROOT");
    if (given && this.isValidDir(given) && !tooBroad(given)) {
      this.log.log(`boot: workspace from the launcher ${given}`);
      this.setSetting("workspace", resolve(given));
      this.activate(resolve(given));
      return;
    }
    const saved = this.getSetting("workspace");
    if (saved && tooBroad(saved)) {
      // Saved before this guard (an island named after ~/Documents): mapping it would hang the server. Pick again.
      this.log.warn(`boot: the saved workspace ${saved} is a folder of folders, not a project: showing the setup screen`);
      this.dbs.db.prepare(`DELETE FROM settings WHERE key = 'workspace'`).run();
    } else if (saved && this.isValidDir(saved)) {
      this.log.log(`boot: applying saved workspace ${saved}`);
      this.activate(saved); // fire and forget: don't block startup
    } else {
      this.log.log(`boot: no saved workspace, the web will show the setup screen`);
    }
  }

  // ---- reads ----

  status(): SetupStatus {
    if (!this.root) return { root: null, name: null, ready: false, steps: [] };
    const scan = this.scanStep(this.root);
    const imports = this.importsStep(this.root);
    const summaries = this.summariesStep();
    // Nemotron (file summaries) is listed only where it's set up (NEMOTRON_URL): a hackathon extra most people won't have.
    const steps: SetupStep[] = process.env.NEMOTRON_URL
      ? [scan, imports, this.claudeStep, this.nemotronStep, this.anthropicStep, summaries]
      : [scan, imports, this.claudeStep, this.anthropicStep];
    const ready = scan.state === "done" && imports.state === "done" && this.claudeStep.state !== "error";
    return { root: this.root, name: basename(this.root), ready, steps };
  }

  /**
   * Every project an agent worked in on this machine (Claude Code's and Codex's), most recently active first (owner: S). Must stay fast (<300ms).
   * One entry per repo: its worktrees count towards it (even when every thread ran in a worktree), and so do the
   * folders it lived in before it moved (a symlink left behind, or a folder of the same name that's gone).
   */
  suggestions(): WorkspaceSuggestion[] {
    let dirs: string[] = [];
    try {
      dirs = readdirSync(this.cfg.claudeProjectsDir);
    } catch (e) {
      // No Claude Code here (a Codex-only machine): its projects are still listed below.
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") this.log.warn(`suggestions: cannot read ${this.cfg.claudeProjectsDir}: ${(e as Error).message}`);
    }

    const byRoot = new Map<string, WorkspaceSuggestion>();
    const ids = new Map<string, Set<string>>(); // thread ids per repo: a move can leave a copy of a thread in the old folder
    const add = (root: string, threads: Iterable<string>, lastActiveAt: string) => {
      const seen = ids.get(root) ?? ids.set(root, new Set()).get(root)!;
      for (const t of threads) seen.add(t);
      const existing = byRoot.get(root);
      if (!existing) byRoot.set(root, { root, name: basename(root), lastActiveAt, sessions: seen.size, exists: existsSync(root) });
      else {
        existing.sessions = seen.size;
        if (lastActiveAt > (existing.lastActiveAt ?? "")) existing.lastActiveAt = lastActiveAt;
      }
    };

    for (const d of dirs) {
      const dirPath = join(this.cfg.claudeProjectsDir, d);
      let dirStat;
      try { dirStat = statSync(dirPath); } catch { continue; }
      if (!dirStat.isDirectory()) continue;

      // Threads only (see threads.ts): a folder whose sessions were all slash commands still names a project.
      let jsonlFiles: { path: string; mtimeMs: number; idle: boolean }[];
      try {
        jsonlFiles = readdirSync(dirPath)
          .filter((f) => f.endsWith(".jsonl"))
          .map((f) => {
            const p = join(dirPath, f);
            const st = statSync(p);
            return { path: p, mtimeMs: st.mtimeMs, idle: isIdleTranscript(p, st.size) };
          });
      } catch { continue; }
      if (!jsonlFiles.length) continue;

      jsonlFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);
      // The folder name is the project root with every non [A-Za-z0-9-] char replaced by "-". A session's cwd can
      // drift into a subfolder, so try the cwds of the newest few sessions and their ancestors for an exact match.
      const decoded = decodeProjectDir(d);
      const cwds = jsonlFiles.slice(0, 5).map((f) => this.readCwd(f.path)).filter((c): c is string => !!c);
      if (!cwds.length && !decoded) continue;
      let root = decoded ?? resolve(cwds[0]);
      if (!decoded) outer: for (const c of cwds) {
        for (let cand = resolve(c); cand !== dirname(cand); cand = dirname(cand)) {
          if (encodeRoot(cand) === d) { root = cand; break outer; }
        }
      }
      if (/\/Library\/Application Support\//.test(root)) continue; // Claude Desktop's own scratch folders
      // A worktree (or a folder inside one) belongs to its repo; a folder reached through a symlink, to the real one.
      const threads = jsonlFiles.filter((f) => !f.idle);
      add(real(real(root).replace(/\/\.claude\/worktrees\/[^/]+(?:\/.*)?$/, "")), threads.map((f) => basename(f.path, ".jsonl")), new Date((threads[0] ?? jsonlFiles[0]).mtimeMs).toISOString());
    }

    // Codex's projects (its worktrees count as their repo; see CodexSource.projects).
    for (const [root, threads] of this.listener.codexProjects()) {
      if (/\/Library\/Application Support\//.test(root)) continue;
      const last = Math.max(...threads.map((t) => t.mtimeMs));
      add(real(real(root).replace(/\/\.claude\/worktrees\/[^/]+(?:\/.*)?$/, "")), threads.map((t) => t.id), new Date(last).toISOString());
    }

    // A repo that moved: its old folder is gone, and one of the same name has threads. Count them together.
    for (const old of [...byRoot.values()].filter((s) => !s.exists)) {
      const home = [...byRoot.values()].filter((s) => s.exists && s.name === old.name);
      if (home.length !== 1) continue;
      byRoot.delete(old.root);
      add(home[0].root, ids.get(old.root) ?? [], old.lastActiveAt ?? "");
    }

    return [...byRoot.values()].filter((s) => !tooBroad(s.root)).sort((a, b) => Number(b.exists) - Number(a.exists) || (b.lastActiveAt ?? "").localeCompare(a.lastActiveAt ?? ""));
  }

  // ---- writes ----

  async select(root: string, guest?: string, anyway = false): Promise<SetupStatus> {
    const abs = this.validateRoot(root);
    if (!anyway) await this.checkSize(abs);
    if (typeof guest === "string" && /^[\w-]{8,64}$/.test(guest)) this.listener.bringGuest(guest);
    this.setSetting("workspace", abs);
    this.activate(abs);
    return this.status();
  }

  // ---- validation ----
  // (tooBroad, below the class: a folder that holds folders of projects, never one to map)

  /**
   * A folder that isn't a git project and holds more than a few seconds' walk (photos, archives, a synced drive): asked
   * first (409, code "large"), then opened with `anyway`. A git project of any size is fine (git lists its files).
   */
  private async checkSize(abs: string) {
    if (inGitRepo(abs)) return;
    const quick = await walkCandidates(abs, { dirs: 5_000, ms: 1_500 });
    if (!quick.stopped) return;
    throw new ConflictException({
      statusCode: 409, code: "large",
      message: `${basename(abs)} isn't a git project and holds a lot of folders: Rundown would map only what it finds in a few seconds. Open it anyway, or pick the project's own folder inside it.`,
    });
  }

  private validateRoot(root: string): string {
    if (!root || typeof root !== "string") throw new BadRequestException("root is required");
    if (!isAbsolute(root)) throw new BadRequestException(`"${root}" must be an absolute path`);
    if (!existsSync(root)) throw new BadRequestException(`"${root}" does not exist`);
    if (!statSync(root).isDirectory()) throw new BadRequestException(`"${root}" is not a directory`);
    if (tooBroad(root)) throw new BadRequestException(`${resolve(root)} holds your folders, not one project. Pick the project's own folder inside it.`);
    return resolve(root);
  }

  private isValidDir(p: string): boolean {
    try { return isAbsolute(p) && existsSync(p) && statSync(p).isDirectory(); } catch { return false; }
  }

  // ---- settings persistence ----

  private getSetting(key: string): string | null {
    const row = this.dbs.db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  private setSetting(key: string, value: string) {
    this.dbs.db
      .prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run(key, value);
  }

  // ---- activation pipeline ----

  /** Set the active workspace, notify listener/mapper/reader, and start the checklist checks
   * (Claude CLI, Nemotron, Anthropic) in the background. Synchronous parts (map build) happen
   * inline since they're fast local fs work; the network/subprocess checks are not awaited. */
  private activate(abs: string) {
    this.root = abs;
    this.cfg.defaultRoot = abs;
    this.claudeStep = { id: "claude", label: "Connecting to your agents", state: "running" };
    this.nemotronStep = { id: "nemotron", label: "Nemotron for file summaries", state: "running" };
    this.anthropicStep = { id: "anthropic", label: "Claude for questions", state: "running" };

    this.bus.emit("workspace", { root: abs }); // listener re-scopes, mapper rebuilds+watches, reader re-summarizes

    this.startPolling();
    this.broadcastIfChanged();

    const gen = ++this.gen;
    this.runChecks(abs, gen).catch((e) => this.log.warn(`runChecks failed: ${(e as Error).message}`));
  }

  private async runChecks(root: string, gen: number) {
    const [claude, nemotron] = await Promise.all([this.checkClaude(root), this.checkNemotron()]);
    if (gen !== this.gen) return; // superseded by a newer select()
    this.claudeStep = claude;
    this.nemotronStep = nemotron;
    this.anthropicStep = this.checkAnthropic();
    this.broadcastIfChanged();
  }

  // ---- step: scan / imports (derived live from the mapper) ----

  private scanStep(root: string): SetupStep {
    const label = "Reading your code";
    const cached = this.mapper.getCached(root);
    if (cached) {
      // Past the file cap (mapper/ignore.ts), say so: "3,000 of 18,913 files", not a bare "3000 files".
      const shown = cached.map.files.length, total = cached.map.totalFiles ?? shown;
      const detail = total > shown ? `${shown.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} files on the map, the ones that matter most` : `${shown.toLocaleString("en-US")} files`;
      return { id: "scan", label, state: "done", detail };
    }
    if (this.mapper.isBuilding(root)) return { id: "scan", label, state: "running" };
    return { id: "scan", label, state: this.root === root ? "running" : "pending" };
  }

  private importsStep(root: string): SetupStep {
    const label = "Mapping imports";
    const cached = this.mapper.getCached(root);
    if (cached) {
      return {
        id: "imports", label, state: "done",
        detail: `${cached.map.edges.length} imports across ${cached.map.modules.length} modules`,
      };
    }
    if (this.mapper.isBuilding(root)) return { id: "imports", label, state: "running" };
    return { id: "imports", label, state: this.root === root ? "running" : "pending" };
  }

  // ---- step: claude ----

  /** Claude Code and Codex: which are here, and their threads in this project in the last day. */
  private async checkClaude(root: string): Promise<SetupStep> {
    const label = "Connecting to your agents";
    let versionRaw = "";
    for (const bin of claudeCandidates()) {
      try {
        const { stdout } = await execFileP(bin, ["--version"], { timeout: 3000 });
        versionRaw = stdout.trim().split("\n")[0] ?? "";
        if (versionRaw) break;
      } catch { /* try the next location */ }
    }
    const claude = this.countRecentSessions(root);
    const codex = this.countRecentCodex(root);
    const hasCodex = existsSync(join(this.cfg.codexDir, "sessions"));
    const threads = (n: number) => `${n} thread${n === 1 ? "" : "s"} in the last day`;
    const parts: string[] = [];
    if (versionRaw || claude) parts.push(`Claude Code${versionRaw ? ` ${versionRaw.match(/\d+\.\d+(\.\d+)?/)?.[0] ?? ""}`.trimEnd() : ""} · ${threads(claude)}`);
    if (hasCodex || codex) parts.push(`Codex · ${threads(codex)}`);
    if (!parts.length) return { id: "claude", label, state: "warn", detail: "Neither Claude Code nor Codex found: install one to follow agents live" };
    if (!claude && !codex) return { id: "claude", label, state: "warn", detail: `${parts.join(" · ").replace(/ · 0 threads in the last day/g, "")}. No threads in the last day: start an agent in this folder and they will appear live` };
    return { id: "claude", label, state: "done", detail: parts.join(" · ") };
  }

  /** Codex threads active in the last 24h in `root` (or its repo's checkouts, Codex worktrees included). */
  private countRecentCodex(root: string): number {
    const base = resolve(root).replace(/\/\.claude\/worktrees\/[^/]+$/, "");
    const now = Date.now();
    const ids = new Set<string>();
    for (const [r, list] of this.listener.codexProjects()) {
      if (r !== base && !r.startsWith(base + "/")) continue;
      for (const t of list) if (now - t.mtimeMs <= ONE_DAY_MS) ids.add(t.id);
    }
    return ids.size;
  }


  /** Threads (see threads.ts) active in the last 24h across the Claude Code project folders for `root` and its worktrees. */
  private countRecentSessions(root: string): number {
    const encoded = resolve(root).replace(/[^A-Za-z0-9-]/g, "-");
    let dirs: string[];
    try { dirs = readdirSync(this.cfg.claudeProjectsDir); } catch { return 0; }
    const ids = new Set<string>();
    const now = Date.now();
    for (const d of dirs) {
      if (d !== encoded && !d.startsWith(encoded + "-")) continue;
      const dirPath = join(this.cfg.claudeProjectsDir, d);
      let entries: string[];
      try { entries = readdirSync(dirPath); } catch { continue; }
      for (const name of entries) {
        if (!name.endsWith(".jsonl")) continue;
        try {
          const p = join(dirPath, name);
          const st = statSync(p);
          if (now - st.mtimeMs <= ONE_DAY_MS && !isIdleTranscript(p, st.size)) ids.add(basename(name, ".jsonl"));
        } catch { /* ignore */ }
      }
    }
    return ids.size;
  }

  // ---- step: nemotron ----

  private async checkNemotron(): Promise<SetupStep> {
    const label = "Nemotron for file summaries";
    if (!process.env.NEMOTRON_URL) return { id: "nemotron", label, state: "warn", detail: "not set up: file summaries are off" };
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      try {
        const res = await fetch(`${this.cfg.nemotron.url}/models`, {
          headers: this.cfg.nemotron.key ? { Authorization: `Bearer ${this.cfg.nemotron.key}` } : undefined,
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } finally {
        clearTimeout(timer);
      }
      return { id: "nemotron", label, state: "done", detail: "online" };
    } catch {
      return { id: "nemotron", label, state: "warn", detail: "offline: plain labels, no summaries" };
    }
  }

  // ---- step: anthropic ----

  private checkAnthropic(): SetupStep {
    const label = "Claude for questions";
    if (this.cfg.claude.key) return { id: "anthropic", label, state: "done", detail: "configured" };
    return { id: "anthropic", label, state: "warn", detail: "no API key: Ask is disabled" };
  }

  // ---- step: summaries (derived live from the reader) ----

  private summariesStep(): SetupStep {
    const label = "Summarizing files with Nemotron";
    if (this.nemotronStep.state === "warn") return { id: "summaries", label, state: "warn", detail: "skipped: Nemotron offline" };
    if (this.nemotronStep.state !== "done") return { id: "summaries", label, state: "pending" };
    const { done, total } = this.reader.summaryProgress();
    if (total === 0) return { id: "summaries", label, state: "pending", done: 0, total: 0 };
    return { id: "summaries", label, state: done >= total ? "done" : "running", done, total };
  }

  // ---- ws broadcast (throttled ~300ms) ----

  private startPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    const startedAt = Date.now();
    this.pollTimer = setInterval(() => {
      const s = this.status();
      this.broadcastIfChanged(s);
      const settled = s.ready && s.steps.every((st) => st.state !== "running");
      if (settled || Date.now() - startedAt > POLL_TIMEOUT_MS) {
        if (this.pollTimer) clearInterval(this.pollTimer);
        this.pollTimer = undefined;
      }
    }, POLL_MS);
  }

  private broadcastIfChanged(s?: SetupStatus) {
    const status = s ?? this.status();
    const serialized = JSON.stringify(status);
    if (serialized === this.lastBroadcast) return;
    this.lastBroadcast = serialized;
    this.gateway.broadcast({ type: "setup", status });
  }

  // ---- helpers ----

  /** Read the `cwd` field from the first ~64KB of a jsonl file, line by line. */
  private readCwd(file: string): string | null {
    let fd: number;
    try { fd = openSync(file, "r"); } catch { return null; }
    try {
      const buf = Buffer.alloc(CWD_READ_BYTES);
      const bytesRead = readSync(fd, buf, 0, CWD_READ_BYTES, 0);
      const text = buf.toString("utf8", 0, bytesRead);
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line) as { cwd?: unknown };
          if (typeof obj.cwd === "string" && obj.cwd) return obj.cwd;
        } catch { /* partial/invalid line (e.g. cut off at the 64KB boundary), skip */ }
      }
      return null;
    } catch {
      return null;
    } finally {
      closeSync(fd);
    }
  }
}

/** Folders that hold your other folders: mapping one reads everything in it (and would hang the server for minutes).
 *  Home and above it are never a workspace; the folders below are, when they're a git project. */
const CONTAINERS = new Set(["Documents", "Desktop", "Downloads", "Library", "Pictures", "Movies", "Music", "Public", "Applications", "Dropbox", "OneDrive", "iCloud Drive", "Google Drive"]);
export function tooBroad(root: string, homeDir = homedir()): boolean {
  const abs = resolve(root).replace(/\/+$/, "") || "/";
  const home = homeDir.replace(/\/+$/, "");
  if (abs === "/" || home === abs || home.startsWith(abs + "/")) return true;   // the disk, a folder above home, home itself
  const rest = abs.startsWith(home + "/") ? abs.slice(home.length + 1) : null;
  // ~/Documents, ~/Desktop, ~/Downloads…, unless it's a git project itself (some keep their Documents in git)
  return rest !== null && !rest.includes("/") && CONTAINERS.has(rest) && !existsSync(join(abs, ".git"));
}

/** Inside a git working tree: the folder or one above it has a .git (a folder, or a file in a worktree). */
function inGitRepo(abs: string): boolean {
  for (let d = abs; ; d = dirname(d)) {
    if (existsSync(join(d, ".git"))) return true;
    if (dirname(d) === d) return false;
  }
}
