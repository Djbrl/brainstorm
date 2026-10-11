import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { createHash } from "node:crypto";
import { closeSync, existsSync, fstatSync, openSync, readdirSync, readSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Harness, Session, Step } from "../shared/contract";
import { DbService } from "../core/db.service";
import { BusService } from "../core/bus.service";
import { EventsGateway } from "../core/events.gateway";
import { ConfigService } from "../core/config.service";
import { safely } from "../core/safely";
import { formerRoots, repoBase, within } from "./moved";
import { ClaudeSource } from "./claude.source";
import { CodexSource } from "./codex.source";
import type { LogFile, LogSource, NewStep, Scope, Sink } from "./source";
import { promptTitle, storedTitle, titleOfPrompt, UNTITLED } from "./text";
import { maskSecrets } from "../privacy/mask";
import { CommandEdits } from "./command-edits";
import { commandReads } from "./command-writes";
import { backfillAgentIds } from "./agent-ids";

// Tail the coding agents' session logs (log sources: claude.source.ts for ~/.claude/projects, codex.source.ts
// for ~/.codex/sessions), store the Steps they parse, emit them on the bus and broadcast them over ws.

export { sanitizeText, promptTitle } from "./text";

// All of a project's history is loaded: the last two weeks first (the first screen), then older threads a file at a time.
const RECENT_MS = 14 * 24 * 60 * 60 * 1000;
const IDLE_AFTER_MS = 2 * 60 * 1000;
/** `worked`: an agent called a tool or edited a file in the thread (one that only answered a slash command didn't). */
type SessionRow = { id: string; cwd: string; title: string; started_at: string; last_event_at: string; custom_title: number; title_set: number; worked: number; harness: string };
type BatchSession = SessionRow & { isNew: boolean; dirty: boolean };

/** One chunk of lines being stored: passed down the parse, so reads of several files can interleave. */
type Batch = {
  /** The line being parsed is history: stored, not broadcast as live activity. */
  quiet: boolean;
  /** Session rows this chunk touched, written once at its end. */
  sessions: Map<string, BatchSession>;
  /** Live steps and session announcements, in order, sent once the chunk is committed. */
  events: ({ step: Step } | { session: string } | { turnEnded: string })[];
  announced: Set<string>;
  /** Each touched session's next seq before the chunk, put back if it rolls back. */
  seqBefore: Map<string, number | undefined>;
  /** Seqs taken back from `kept` (thread, step id, seq), put back if it rolls back. */
  keptUsed: [string, string, number][];
  /** Threads that got history stored (told to the pages, see noticeStored). */
  quietSessions: Set<string>;
};

/** A log being read: where it's at, and its complete lines read and not stored yet. */
type Cursor = {
  file: string;
  source: LogSource;
  fd: number;
  /** Its size when opened: what this pass reads. */
  size: number;
  /** Next byte to read, and the offset after the last line stored. */
  pos: number;
  committed: number;
  /** Lines ending at or before this byte offset are history. */
  quietUntil: number;
  /** Which file this is (another at the same path is another log), and a hash of its first line. */
  ino: number;
  head?: string;
  /** Its thread's reset count when opened (see resetThread). */
  reset: number;
  /** The start of a line not complete yet; inside a line longer than maxLineBytes (dropped up to its end). */
  pending: Buffer | null;
  skipping: boolean;
  /** Lines read and not handed out yet: lines[next…]. */
  lines: Line[];
  next: number;
  reads: number;
  /** The time of its last line that had one. */
  lastTs: number;
};
/** A complete line: buf[start, end), the offset after it, and (logs merged) its time and its parse. start === end: no
 * line to store, only an offset to move past (an empty or over-long line). */
type Line = { c: Cursor; buf: Buffer; start: number; end: number; at: number; ts: number; obj?: unknown; err?: string };
type ReadEntry = { again?: number; done?: Promise<void> };

/** A hash of a log's first line (of its first 4 KB, if longer), or undefined while it isn't written: the same path
 * with another first line is another log. */
function headOf(fd: number, size: number): string | undefined {
  const buf = Buffer.alloc(Math.min(4096, size));
  const n = readSync(fd, buf, 0, buf.length, 0);
  const nl = buf.subarray(0, n).indexOf(0x0a);
  if (nl === -1 && n < 4096) return undefined;
  return createHash("sha1").update(buf.subarray(0, nl === -1 ? n : nl + 1)).digest("hex");
}

/** How long a live command's file edits wait for the mapper to see the files change (it batches changes for 100 ms). */
const COMMAND_EDIT_WAIT_MS = 1_500;
/** Read size per step of a file. */
const CHUNK_BYTES = 4 * 1024 * 1024;
/** Lines stored per transaction, about: the server answers requests between batches. */
const BATCH_BYTES = 1024 * 1024;
/** A longer line is skipped (with a warning) instead of buffered. The longest seen in real logs is 13 MB (a pasted image). */
const MAX_LINE_BYTES = 16 * 1024 * 1024;
const NL = 0x0a;
/** A chunk the database wouldn't take (busy past its timeout, disk full) is read again this soon, at most RETRY_MAX
 * times in a row; after that, on the log's next change. */
const RETRY_MS = 1_000;
const RETRY_MAX = 30;
/** While a long history read goes on, the pages are told which threads got steps every this many batches. */
const NOTICE_EVERY = 4;
const yieldToLoop = () => new Promise<void>((r) => setImmediate(r));
const isSqliteError = (e: unknown) => String((e as { code?: unknown })?.code ?? "").startsWith("ERR_SQLITE");

@Injectable()
export class ListenerService implements OnModuleInit, OnModuleDestroy {
  private log = new Logger("Listener");
  // The active workspace's roots scope every source (set on "workspace", owner: S).
  private activeRoot: string | null = null;
  /** The active root and the folders the repo lived in before it moved (see moved.ts). */
  private roots: string[] = [];
  /** Visitors: threads from other projects whose steps touched this one's files (an orchestrator editing it), shown and
   *  read live like its own. From the stored steps when the project opens, and the thread you came with (an island). */
  private visitors = new Set<string>();
  private guestFiles: string[] = [];
  private pendingGuest?: string;
  private offsets = new Map<string, number>();
  /** Which file each offset is in (inode, first line's hash; see headOf), to notice a log replaced or cut short. */
  private idents = new Map<string, { ino?: number | null; head?: string | null }>();
  /** Per file, how many times its thread was read again from the start (a pass that began before stops). */
  private resets = new Map<string, number>();
  /** Steps of a thread being read again from the start, by id: each comes back with the seq it had. */
  private kept = new Map<string, Map<string, number>>();
  /** Threads that got history stored since the pages were last told (noticeStored). */
  private storedQuietly = new Set<string>();
  private nextSeq = new Map<string, number>();
  private ready = false;
  /** Where the agents' logs come from: Claude Code's, then Codex's. Built in onModuleInit (it needs the config). */
  private sources: LogSource[] = [];
  private codex?: CodexSource;
  /** Files changed through shell commands, made edits of their thread (command-edits.ts). */
  /** Each built map's .gitignore folders (see the bus's "map-rules"), so command edits follow the map's rules. */
  private mapRules = new Map<string, Set<string> | undefined>();
  private commandEdits = new CommandEdits((p) => this.isWithinRoot(p), () => this.activeRoot, () => (this.activeRoot ? this.mapRules.get(this.activeRoot) : undefined));
  /** Live command edits waiting for the mapper to see their files change, each with how to store them at once
   * (without a diff) if the server stops first. */
  private commandTimers = new Map<NodeJS.Timeout, () => void>();
  private retryTimers = new Map<string, NodeJS.Timeout>();
  private retryCount = new Map<string, number>();
  /** Closes every source's watcher (tests read files themselves). */
  readonly watcher = {
    close: async () => { await Promise.all(this.sources.map((s) => s.close())); },
    /** Every folder the sources watch (chokidar's getWatched, for tests). */
    getWatched: (): Record<string, string[]> => Object.assign({}, ...this.sources.map((s) => s.getWatched?.() ?? {})),
  };
  /** Bytes read per chunk, stored per transaction, and the longest line kept. Fields so tests can make them small. */
  chunkBytes = CHUNK_BYTES;
  batchBytes = BATCH_BYTES;
  maxLineBytes = MAX_LINE_BYTES;
  /** Resolves once the HTTP server listens: history is read after that, so the app answers from the first second. */
  private listening!: Promise<void>;
  private isListening = false;
  /** Files being read now, and the next pass to make once the current one ends (the file changed meanwhile). */
  private reading = new Map<string, ReadEntry>();
  /** Each file's size when the backfill listed it: lines up to there are history, anything after is live. */
  private historyEnd = new Map<string, number>();
  private backfillGen = 0;
  private st!: ReturnType<ListenerService["prepare"]>;
  /** listSessions' rows: filtered, titles cleaned, newest first. Dropped when a session row is written or the
   * workspace changes; status and deleted threads are worked out on each call. */
  private sessionsCache: SessionRow[] | null = null;
  private destroyed = false;
  /** The one-time pass that gives older subagent steps their agent id (see agent-ids.ts); resolves when it's over. */
  agentIdsDone?: Promise<void>;

  constructor(
    private dbs: DbService,
    private bus: BusService,
    private gateway: EventsGateway,
    private cfg: ConfigService,
    @Optional() private adapterHost?: HttpAdapterHost,
  ) {}

  onModuleInit() {
    const db = this.dbs.db;
    db.exec(`CREATE TABLE IF NOT EXISTS listener_offsets (file TEXT PRIMARY KEY, offset INTEGER NOT NULL)`);
    db.exec(`CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY, cwd TEXT NOT NULL, title TEXT NOT NULL,
      started_at TEXT NOT NULL, last_event_at TEXT NOT NULL,
      custom_title INTEGER NOT NULL DEFAULT 0, title_set INTEGER NOT NULL DEFAULT 0
    )`);
    db.exec(`CREATE TABLE IF NOT EXISTS steps (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, seq INTEGER NOT NULL, ts TEXT NOT NULL, kind TEXT NOT NULL,
      text TEXT, tool TEXT, input TEXT, file_path TEXT, diff TEXT, label TEXT, risk TEXT,
      is_subagent INTEGER NOT NULL DEFAULT 0
    )`);
    // `sessions.worked`, kept up to date as steps are stored, instead of a scan of every step per list.
    if (!(db.prepare(`PRAGMA table_info(sessions)`).all() as { name: string }[]).some((c) => c.name === "worked")) {
      db.exec("BEGIN");
      try {
        db.exec(`ALTER TABLE sessions ADD COLUMN worked INTEGER NOT NULL DEFAULT 0`);
        db.exec(`UPDATE sessions SET worked = 1 WHERE id IN (SELECT DISTINCT session_id FROM steps WHERE kind IN ('tool_call', 'edit'))`);
        db.exec("COMMIT");
      } catch (e) { db.exec("ROLLBACK"); throw e; }
    }
    // Pairs a tool result with its call exactly (older rows are paired by order).
    const stepCols = (db.prepare(`PRAGMA table_info(steps)`).all() as { name: string }[]).map((c) => c.name);
    // Which coding agent a thread ran in (null: Claude Code, every thread stored before).
    if (!(db.prepare(`PRAGMA table_info(sessions)`).all() as { name: string }[]).some((c) => c.name === "harness")) db.exec(`ALTER TABLE sessions ADD COLUMN harness TEXT`);
    if (!stepCols.includes("tool_use_id")) db.exec(`ALTER TABLE steps ADD COLUMN tool_use_id TEXT`);
    // Which subagent a step comes from, so parallel subagents stay apart after a reload. Steps stored
    // before then get theirs from their logs, once (see agent-ids.ts).
    if (!stepCols.includes("agent_id")) db.exec(`ALTER TABLE steps ADD COLUMN agent_id TEXT`);
    // Which file an offset is in, to notice a log replaced or cut short (see openLog).
    const offsetCols = (db.prepare(`PRAGMA table_info(listener_offsets)`).all() as { name: string }[]).map((c) => c.name);
    if (!offsetCols.includes("ino")) db.exec(`ALTER TABLE listener_offsets ADD COLUMN ino INTEGER`);
    if (!offsetCols.includes("head")) db.exec(`ALTER TABLE listener_offsets ADD COLUMN head TEXT`);
    db.exec(`CREATE INDEX IF NOT EXISTS steps_session_seq ON steps(session_id, seq)`);
    db.exec(`CREATE INDEX IF NOT EXISTS steps_label ON steps(kind, label)`);
    // "was this file touched by a step?" for the picture endpoint (image/).
    db.exec(`CREATE INDEX IF NOT EXISTS steps_file ON steps(file_path)`);
    // Compacted-conversation recaps were stored as prompts; they read as the agent's text.
    db.exec(`UPDATE steps SET kind = 'text' WHERE kind = 'prompt' AND text LIKE 'This session is being continued from a previous conversation%'`);
    // Claude Code's threads were stored with harness NULL (so a re-read of its logs, which deletes
    // by harness, would have kept them); titles are masked like every other text; times ahead of the clock were kept.
    this.once("listener: harness claude", () => db.exec(`UPDATE sessions SET harness = 'claude' WHERE harness IS NULL`));
    this.once("listener: titles masked", () => {
      const set = db.prepare(`UPDATE sessions SET title = ? WHERE id = ?`);
      for (const r of db.prepare(`SELECT id, title FROM sessions`).all() as { id: string; title: string }[]) {
        const masked = maskSecrets(r.title);
        if (masked !== r.title) set.run(masked, r.id);
      }
    });
    this.once("listener: no future times", () => {
      const now = new Date().toISOString();
      db.prepare(`UPDATE sessions SET last_event_at = ? WHERE julianday(last_event_at) > julianday(?)`).run(now, now);
    });
    this.st = this.prepare();

    const warn = (e: Error) => this.log.warn(`watcher error: ${e.message}`);
    this.codex = new CodexSource(this.cfg.codexDir, warn);
    this.sources = [new ClaudeSource(this.cfg.claudeProjectsDir, warn), this.codex];
    this.rereadChangedSources();

    for (const row of db.prepare(`SELECT file, offset, ino, head FROM listener_offsets`).all() as { file: string; offset: number; ino: number | null; head: string | null }[]) {
      this.offsets.set(row.file, row.offset);
      this.idents.set(row.file, { ino: row.ino, head: row.head });
    }
    for (const row of db.prepare(`SELECT session_id, MAX(seq) as m FROM steps GROUP BY session_id`).all() as { session_id: string; m: number }[]) {
      this.nextSeq.set(row.session_id, row.m + 1);
    }
    this.listening = this.whenListening();
    this.agentIdsDone = this.fillAgentIds();

    // Start out scoped to the configured default root (repo root, or MAP_ROOT) until a workspace
    // is explicitly chosen (WorkspaceService then emits "workspace" and we re-scope, see below).
    this.setRoot(this.cfg.defaultRoot);
    this.bus.on("workspace", ({ root }) => this.onWorkspaceChanged(root));
    this.bus.on("file-content", (c) => this.commandEdits.fileChanged(c));
    this.bus.on("map-rules", ({ root, ignoredDirs }) => {
      this.mapRules.delete(root);
      this.mapRules.set(root, ignoredDirs);
      if (this.mapRules.size > 8) this.mapRules.delete(this.mapRules.keys().next().value!);
    });

    let waiting = this.sources.length;
    for (const source of this.sources) {
      source.watch(this.scope(), {
        add: (f) => this.onAdd(f),
        change: (f) => void this.runFile(f, this.historyEnd.get(f) ?? 0),
        ready: () => {
          if (--waiting > 0) return;
          this.ready = true;
          this.backfillForNewFilter(); // the whole history, once the server is up
          this.log.log(`watching ${this.cfg.claudeProjectsDir} and ${this.cfg.codexDir} live (roots: ${this.roots.join(", ")})`);
        },
      });
    }
  }

  /** Run `fn` once per database (in a transaction), remembered in `settings` under `key`. */
  private once(key: string, fn: () => void) {
    const db = this.dbs.db;
    db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`);
    if (db.prepare(`SELECT 1 FROM settings WHERE key = ?`).get(key)) return;
    db.exec("BEGIN IMMEDIATE");
    try {
      fn();
      db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)`).run(key, new Date().toISOString());
      db.exec("COMMIT");
    } catch (e) { db.exec("ROLLBACK"); throw e; }
  }

  /** A source whose reading changed since its threads were stored (its `version`) has them read again: its threads and
   * steps are dropped and its files read from the start (in the background, like any history). */
  private rereadChangedSources() {
    const db = this.dbs.db;
    db.exec(`CREATE TABLE IF NOT EXISTS source_versions (harness TEXT PRIMARY KEY, version INTEGER NOT NULL)`);
    for (const source of this.sources) {
      if (source.version === undefined) continue;
      const row = db.prepare(`SELECT version FROM source_versions WHERE harness = ?`).get(source.harness) as { version: number } | undefined;
      if (row?.version === source.version) continue;
      const files = (db.prepare(`SELECT file FROM listener_offsets`).all() as { file: string }[]).map((r) => r.file).filter((f) => source.owns(f));
      const ids = (db.prepare(`SELECT id FROM sessions WHERE harness = ?`).all(source.harness) as { id: string }[]).map((r) => r.id);
      db.exec("BEGIN");
      try {
        db.prepare(`DELETE FROM steps WHERE session_id IN (SELECT id FROM sessions WHERE harness = ?)`).run(source.harness);
        const gone = db.prepare(`DELETE FROM sessions WHERE harness = ?`).run(source.harness).changes;
        const del = db.prepare(`DELETE FROM listener_offsets WHERE file = ?`);
        for (const f of files) del.run(f);
        db.prepare(`INSERT INTO source_versions (harness, version) VALUES (?, ?) ON CONFLICT(harness) DO UPDATE SET version = excluded.version`).run(source.harness, source.version);
        db.exec("COMMIT");
        for (const id of ids) this.nextSeq.delete(id);
        for (const f of files) this.offsets.delete(f);
        this.sessionsCache = null;
        if (gone) this.log.log(`${source.harness}: its logs are read differently now: ${gone} thread(s) read again`);
      } catch (e) { db.exec("ROLLBACK"); throw e; }
    }
  }

  async onModuleDestroy() {
    this.backfillGen++; // stops a backfill between files
    // A command's file edits still waiting for the mapper: stored now, without a diff (the offset is past its line,
    // so they would never be read again).
    for (const [t, now] of this.commandTimers) { clearTimeout(t); now(); }
    this.commandTimers.clear();
    this.destroyed = true;
    for (const t of this.retryTimers.values()) clearTimeout(t);
    await this.agentIdsDone;
    await this.watcher.close();
  }

  /** Once the server is up, in the background: subagent steps stored before agent_id was kept get it from their logs. */
  private async fillAgentIds() {
    await this.listening;
    if (this.destroyed) return;
    const started = Date.now();
    try {
      const r = await backfillAgentIds(this.dbs.db, { stopped: () => this.destroyed });
      if (r && (r.files || r.missing)) this.log.log(`agent ids: ${r.filled} subagent step(s) given theirs from ${r.files} log(s) (${r.missing} gone) in ${Date.now() - started} ms`);
    } catch (e) {
      if (!this.destroyed) this.log.warn(`agent ids: the pass failed, tried again next start: ${(e as Error).message}`);
    }
  }

  /** Resolves when the HTTP server is listening (at once in tests, where there is none). */
  private whenListening(): Promise<void> {
    const server = this.adapterHost?.httpAdapter?.getHttpServer?.() as { listening?: boolean; once?: (e: string, f: () => void) => void } | undefined;
    return new Promise<void>((res) => {
      const done = () => { this.isListening = true; res(); };
      if (!server || typeof server.once !== "function") setImmediate(done);
      else if (server.listening) done();
      else server.once("listening", done);
    });
  }

  private prepare() {
    const db = this.dbs.db;
    // A shell command's reads, worked out from its text when steps are read (any thread, old ones too): see readsJson.
    db.function("step_reads", { deterministic: true }, (tool, input, cwd) => readsJson(tool as string | null, input as string | null, cwd as string | null));
    return {
      insertStep: db.prepare(
        `INSERT OR IGNORE INTO steps (id, session_id, seq, ts, kind, text, tool, input, file_path, diff, label, risk, is_subagent, tool_use_id, agent_id)
         VALUES (@id, @session_id, @seq, @ts, @kind, @text, @tool, @input, @file_path, @diff, @label, @risk, @is_subagent, @tool_use_id, @agent_id)`,
      ),
      sessionRow: db.prepare(`SELECT * FROM sessions WHERE id = ?`),
      insertSession: db.prepare(`INSERT INTO sessions (id, cwd, title, started_at, last_event_at, custom_title, title_set, worked, harness) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
      updateSession: db.prepare(`UPDATE sessions SET cwd = ?, title = ?, started_at = ?, last_event_at = ?, title_set = ?, custom_title = ?, worked = ? WHERE id = ?`),
      allSessions: db.prepare(`SELECT * FROM sessions ORDER BY last_event_at DESC`),
      saveOffset: db.prepare(`INSERT INTO listener_offsets (file, offset, ino, head) VALUES (?, ?, ?, ?) ON CONFLICT(file) DO UPDATE SET offset = excluded.offset, ino = excluded.ino, head = excluded.head`),
      stepById: db.prepare(`SELECT * FROM steps WHERE id = ?`),
      stepThread: db.prepare(`SELECT session_id FROM steps WHERE id = ?`),
      stepsOf: db.prepare(`SELECT * FROM steps WHERE session_id = ? ORDER BY seq ASC`),
      stepsAfter: db.prepare(`SELECT * FROM steps WHERE session_id = ? AND seq > ? ORDER BY seq ASC`),
      stepsJson: db.prepare(stepsJsonSql(`session_id = ?`)),
      stepsJsonAfter: db.prepare(stepsJsonSql(`session_id = ? AND seq > ?`)),
      stepTouches: db.prepare(`SELECT 1 FROM steps WHERE file_path = ? LIMIT 1`),
      visitorsOf: db.prepare(`SELECT DISTINCT st.session_id, s.cwd FROM steps st JOIN sessions s ON s.id = st.session_id WHERE st.file_path >= ? AND st.file_path < ?`),
      stepPos: db.prepare(`SELECT session_id, seq FROM steps WHERE id = ?`),
      stepsBefore: db.prepare(`SELECT * FROM steps WHERE session_id = ? AND seq < ? ORDER BY seq DESC LIMIT ?`),
      stepLabel: db.prepare(`SELECT label, risk FROM steps WHERE id = ?`),
      updateLabel: db.prepare(`UPDATE steps SET label = ?, risk = ? WHERE id = ?`),
      unlabeled: db.prepare(`SELECT * FROM steps WHERE kind IN ('edit','tool_call','prompt') AND label IS NULL ORDER BY ts DESC LIMIT ?`),
    };
  }

  // ---- workspace switching (owner: S) ----

  private setRoot(root: string) {
    this.activeRoot = resolve(root);
    // Opened from a worktree: the whole repo's threads (its main checkout and every worktree), not just this one's.
    const base = repoBase(this.activeRoot);
    this.roots = [...new Set([this.activeRoot, base, ...formerRoots(this.cfg.claudeProjectsDir, this.activeRoot)])];
    this.findVisitors();
    this.sessionsCache = null;
  }

  private scope(): Scope {
    return { roots: this.roots, guests: { ids: this.visitors, files: this.guestFiles } };
  }

  /** Threads from other projects shown here as visitors (they touched this project's files). */
  isVisitor(id: string) { return this.visitors.has(id); }

  /** The next project opened (from an island on the map) brings this thread along as a visitor. */
  bringGuest(sessionId: string) { this.pendingGuest = sessionId; }

  /** Which threads from elsewhere touched this project's files (stored steps, by the file index), and their transcripts. */
  private findVisitors() {
    this.visitors = new Set(this.pendingGuest ? [this.pendingGuest] : []);
    this.pendingGuest = undefined;
    if (!this.st) return;
    for (const r of this.roots) {
      const rows = this.st.visitorsOf.all(r + "/", r + "0") as { session_id: string; cwd: string }[]; // "0" sorts right after "/"
      for (const row of rows) if (!this.isWithinRoot(row.cwd)) this.visitors.add(row.session_id);
    }
    // Their transcripts, to read live: Claude Code's are named by the thread (Codex's are found by id in its source).
    this.guestFiles = [];
    let dirs: string[] = [];
    if (this.visitors.size) { try { dirs = readdirSync(this.cfg.claudeProjectsDir); } catch { /* no Claude Code */ } }
    for (const id of this.visitors) {
      for (const d of dirs) {
        const f = join(this.cfg.claudeProjectsDir, d, `${id}.jsonl`);
        if (existsSync(f)) { this.guestFiles.push(f); break; }
      }
    }
    if (this.visitors.size) this.log.log(`visitors: ${this.visitors.size} thread(s) from other projects touched ${this.activeRoot}`);
  }

  private sourceOf(file: string): LogSource | undefined {
    return this.sources.find((s) => s.owns(file));
  }

  private onWorkspaceChanged(root: string) {
    this.setRoot(root);
    this.log.log(`workspace changed: now reading the agents' logs for ${this.roots.join(", ")}`);
    this.backfillForNewFilter();
  }

  /** Read every thread of the open project, from every source, newest first, once the server is up: a chunk at a
   * time, so the app stays responsive and live steps keep flowing. Quietly: history isn't live activity (no step
   * broadcasts, map touches, agent markers or labels), only new threads are announced. What a file had when it was
   * listed is history; whatever it gains after is live. Reuses the offset bookkeeping, so nothing duplicates. */
  private backfillForNewFilter() {
    const scope = this.scope();
    const files: LogFile[] = [];
    for (const source of this.sources) {
      files.push(...source.list(scope));
      if (this.ready) source.rescope(scope);
    }
    files.sort((a, b) => b.mtimeMs - a.mtimeMs);
    this.historyEnd.clear();
    for (const f of files) if ((this.offsets.get(f.path) ?? 0) < f.size) this.historyEnd.set(f.path, f.size);
    void this.readHistory(++this.backfillGen, files);
  }

  private async readHistory(gen: number, files: { path: string; mtimeMs: number }[]) {
    await this.listening;
    if (gen !== this.backfillGen) return;
    const started = Date.now();
    const todo = files.filter((f) => this.historyEnd.has(f.path));
    const recent = todo.filter((f) => started - f.mtimeMs <= RECENT_MS).length;
    // A thread's logs (its own and its subagents') are read together, their lines in time order: its steps are
    // numbered in the order things happened, not in the order the files were read.
    const threads = new Map<string, string[]>();
    for (const f of todo) {
      const source = this.sourceOf(f.path);
      const key = `${source?.harness}\n${source?.threadOf?.(f.path) ?? f.path}`;
      const list = threads.get(key);
      if (list) list.push(f.path); else threads.set(key, [f.path]);
    }
    this.log.log(`backfill: reading ${todo.length} of ${files.length} jsonl file(s) (${threads.size} thread(s)), newest first (${recent} from the last two weeks)`);
    for (const paths of threads.values()) {
      if (gen !== this.backfillGen) return; // the workspace changed again: that backfill takes over
      const left = paths.filter((p) => this.historyEnd.has(p)); // not read meanwhile (it changed, and was read up to its end)
      if (!left.length) continue;
      // The thread's own log first, where lines have the same time (it's the shorter path, for both sources).
      left.sort((a, b) => a.length - b.length || (a < b ? -1 : 1));
      await this.runFiles(left);
      await yieldToLoop();
    }
    this.log.log(`backfill: finished ${todo.length} file(s) in ${Date.now() - started} ms`);
  }

  // ---- file tailing ----

  private onAdd(file: string) {
    // A new thread (or subagent) is live from its first line; a file the backfill listed is read by it. Chokidar's
    // first scan (before ready) is left to the backfill.
    if (this.ready && !this.historyEnd.has(file)) void this.runFile(file, 0);
  }

  /** Read what `file` gained since its offset. One pass at a time per file: a change during a pass queues another.
   * Lines ending at or before byte `quietUntil` are history (not broadcast). Never rejects. */
  private runFile(file: string, quietUntil: number): Promise<void> {
    const cur = this.reading.get(file);
    if (cur) {
      cur.again = Math.min(cur.again ?? Infinity, quietUntil);
      return cur.done!;
    }
    const entry: ReadEntry = { again: quietUntil };
    this.reading.set(file, entry);
    entry.done = (async () => {
      try {
        while (entry.again !== undefined) {
          const q = entry.again;
          entry.again = undefined;
          await this.readLogs([{ file, quietUntil: q }]);
        }
      } catch (e) {
        this.log.warn(`handleFile(${file}) failed: ${(e as Error).message}`);
      } finally {
        this.reading.delete(file);
        this.historyRead(file);
      }
    })();
    return entry.done;
  }

  /** Read one thread's logs as one pass, their lines merged by time (history: lines up to each file's historyEnd are
   * quiet). Waits for a pass on any of them to end first; a change during the pass is read after it. Never rejects. */
  private async runFiles(files: string[]): Promise<void> {
    if (files.length === 1) return this.runFile(files[0], this.historyEnd.get(files[0]) ?? 0);
    while (files.some((f) => this.reading.has(f))) await Promise.all(files.map((f) => this.reading.get(f)?.done));
    const entries = files.map((f) => { const e: ReadEntry = {}; this.reading.set(f, e); return e; });
    const done = (async () => {
      try {
        await this.readLogs(files.map((f) => ({ file: f, quietUntil: this.historyEnd.get(f) ?? 0 })));
      } catch (e) {
        this.log.warn(`reading ${files[0]} and its subagents' logs failed: ${(e as Error).message}`);
      } finally {
        for (const f of files) this.reading.delete(f);
      }
      await Promise.all(files.map((f, k) => (entries[k].again !== undefined ? this.runFile(f, entries[k].again) : undefined)));
      for (const f of files) this.historyRead(f);
    })();
    for (const e of entries) e.done = done;
    return done;
  }

  /** A file the backfill listed is history no more once it's read up to where it was listed. */
  private historyRead(file: string) {
    const end = this.historyEnd.get(file);
    if (end !== undefined && (this.offsets.get(file) ?? 0) >= end) this.historyEnd.delete(file);
  }

  /** Read what `logs` gained since their offsets, chunkBytes at a time, split on newline bytes before decoding (a
   * multibyte character never spans one), and store the complete lines about batchBytes per transaction, each log's
   * offset after its last line stored with them, yielding in between. A partial last line waits for the next change.
   * Several logs (a thread's own and its subagents') are merged by their lines' times. When it's done, and every few
   * batches, the threads that got history are told to the pages (noticeStored). */
  private async readLogs(logs: { file: string; quietUntil: number }[]): Promise<void> {
    const cursors: Cursor[] = [];
    try {
      for (const { file, quietUntil } of logs) {
        const c = this.openLog(file, quietUntil);
        if (c) cursors.push(c);
      }
      const merge = cursors.length > 1;
      // A thread read again from the start meanwhile (resetThread): this pass stops, and each log is read again after it.
      const stale = () => {
        if (!cursors.some((c) => (this.resets.get(c.file) ?? 0) !== c.reset)) return false;
        for (const c of cursors) void this.runFile(c.file, c.quietUntil);
        return true;
      };
      let batch: Line[] = [];
      let bytes = 0;
      let commits = 0;
      for (;;) {
        let next: Cursor | undefined;
        for (const c of cursors) {
          while (c.next === c.lines.length && c.pos < c.size) await this.fill(c, merge);
          if (c.next < c.lines.length && (!next || c.lines[c.next].ts < next.lines[next.next].ts)) next = c;
        }
        if (!next) break;
        const l = next.lines[next.next++];
        batch.push(l);
        bytes += l.end - l.start + 1;
        if (bytes < this.batchBytes) continue;
        if (stale() || !this.commitLines(batch)) return;
        batch = [];
        bytes = 0;
        if (++commits % NOTICE_EVERY === 0) this.noticeStored();
        await yieldToLoop();
      }
      if (batch.length && !stale()) this.commitLines(batch);
    } finally {
      for (const c of cursors) closeSync(c.fd);
      this.noticeStored();
    }
  }

  /** A log to read from its offset, or undefined if it's not the project's, gone, or has nothing new. A log replaced
   * or cut short since (another file at its path, another first line, or shorter than its offset) has its thread
   * read again from the start (resetThread). */
  private openLog(file: string, quietUntil: number): Cursor | undefined {
    const source = this.sourceOf(file);
    if (!source || !source.inScope(file, this.scope())) return undefined;
    let fd: number;
    let st: { size: number; ino: number };
    try { fd = openSync(file, "r"); st = fstatSync(fd); } catch { return undefined; } // gone
    let prev = this.offsets.get(file) ?? 0;
    const head = headOf(fd, st.size);
    const known = this.idents.get(file);
    if (prev > 0 && (st.size < prev || (known?.ino != null && known.ino !== st.ino) || (known?.head != null && head !== undefined && head !== known.head))) {
      try { this.resetThread(file, source); } catch (e) { closeSync(fd); throw e; }
      prev = 0;
      quietUntil = Math.max(quietUntil, st.size); // what it has now is history; the pages catch up (noticeStored)
    }
    if (st.size <= prev) { closeSync(fd); return undefined; }
    return {
      file, source, fd, size: st.size, pos: prev, committed: prev, quietUntil, ino: st.ino, head, reset: this.resets.get(file) ?? 0,
      pending: null, skipping: false, lines: [], next: 0, reads: 0, lastTs: -Infinity,
    };
  }

  /** Read a log's next chunk into its cursor's lines (with each line's time when logs are merged). */
  private async fill(c: Cursor, merge: boolean) {
    if (c.reads++) await yieldToLoop();
    if (c.next === c.lines.length) { c.lines = []; c.next = 0; }
    const want = Math.min(this.chunkBytes, c.size - c.pos);
    const chunk = Buffer.allocUnsafe(want);
    const n = readSync(c.fd, chunk, 0, want, c.pos);
    if (n <= 0) { c.size = c.pos; return; }
    const chunkStart = c.pos;
    c.pos += n;
    let data = chunk.subarray(0, n);
    let dataStart = chunkStart;
    if (c.skipping) {
      const nl = data.indexOf(NL);
      if (nl === -1) return;
      c.skipping = false;
      data = data.subarray(nl + 1);
      dataStart = chunkStart + nl + 1;
      c.lines.push({ c, buf: data, start: 0, end: 0, at: dataStart, ts: c.lastTs }); // past the long line
    }
    const work: Buffer = c.pending ? Buffer.concat([c.pending, data]) : data;
    const workStart = dataStart - (c.pending ? c.pending.length : 0);
    c.pending = null;
    let s = 0;
    for (let e = work.indexOf(NL); e !== -1; s = e + 1, e = work.indexOf(NL, s)) {
      const l: Line = { c, buf: work, start: s, end: e, at: workStart + e + 1, ts: c.lastTs };
      if (e - s > this.maxLineBytes) {
        this.log.warn(`skipping a line over ${Math.round(this.maxLineBytes / 1048576)} MB in ${c.file} (byte ${workStart + s})`);
        l.end = l.start; // only its offset is kept
      } else if (merge && e > s) {
        try { l.obj = JSON.parse(work.toString("utf8", s, e)); } catch (err) { l.err = (err as Error).message; }
        const t = Date.parse((l.obj as { timestamp?: unknown } | undefined)?.timestamp as string);
        if (!Number.isNaN(t)) l.ts = c.lastTs = t; // a line without a time stays where it is in its log
      }
      c.lines.push(l);
    }
    const rest = work.subarray(s);
    if (rest.length > this.maxLineBytes) {
      this.log.warn(`skipping a line over ${Math.round(this.maxLineBytes / 1048576)} MB in ${c.file} (byte ${workStart + s})`);
      c.skipping = true;
    } else if (rest.length) c.pending = Buffer.from(rest); // a copy: don't keep the whole chunk alive
  }

  /** Store `lines` (of one or more logs) and each log's offset after its last one in one transaction, then announce
   * what was live. On a database error nothing of it is kept (seqs put back, offsets unchanged) and each log is read
   * again in a second (retrySoon); returns false then. */
  private commitLines(lines: Line[]): boolean {
    const db = this.dbs.db;
    const batch: Batch = { quiet: true, sessions: new Map(), events: [], announced: new Set(), seqBefore: new Map(), keptUsed: [], quietSessions: new Set() };
    const sinks = new Map<LogSource, Sink>();
    const ends = new Map<Cursor, number>();
    try {
      // IMMEDIATE: the write lock from the start. A transaction that reads first (is this step stored?) and writes after
      // can't wait for a lock another program holds (busy_timeout): it fails at once.
      db.exec("BEGIN IMMEDIATE");
      for (const l of lines) {
        const c = l.c;
        ends.set(c, l.at);
        if (l.end <= l.start) continue; // an empty or over-long line
        batch.quiet = l.at <= c.quietUntil;
        let obj = l.obj;
        if (obj === undefined && l.err === undefined) {
          try { obj = JSON.parse(l.buf.toString("utf8", l.start, l.end)); } catch (err) { l.err = (err as Error).message; }
        }
        if (l.err !== undefined) this.log.warn(`bad jsonl line in ${c.file}: ${l.err}`);
        if (!obj) continue;
        let sink = sinks.get(c.source);
        if (!sink) sinks.set(c.source, (sink = this.sinkFor(batch, c.source.harness)));
        try { c.source.parse(c.file, obj, sink); } catch (err) {
          if (isSqliteError(err)) throw err; // the database, not the line: roll the batch back
          this.log.warn(`bad jsonl line in ${c.file}: ${(err as Error).message}`);
        }
      }
      this.flushSessions(batch);
      for (const [c, at] of ends) this.st.saveOffset.run(c.file, at, c.ino, c.head ?? null);
      db.exec("COMMIT");
    } catch (e) {
      try { db.exec("ROLLBACK"); } catch { /* already rolled back */ }
      for (const [id, n] of batch.seqBefore) if (n === undefined) this.nextSeq.delete(id); else this.nextSeq.set(id, n);
      for (const [sid, id, seq] of batch.keptUsed) { const m = this.kept.get(sid) ?? new Map<string, number>(); m.set(id, seq); this.kept.set(sid, m); }
      for (const c of new Set(lines.map((l) => l.c))) {
        this.log.warn(`storing ${c.file} from byte ${c.committed} failed, tried again in a moment: ${(e as Error).message}`);
        this.retrySoon(c.file, c.quietUntil);
      }
      return false;
    }
    for (const [c, at] of ends) {
      c.committed = at;
      this.retryCount.delete(c.file);
      this.setOffset(c.file, at);
      this.idents.set(c.file, { ino: c.ino, head: c.head });
    }
    for (const sid of batch.quietSessions) this.storedQuietly.add(sid);
    this.announce(batch);
    return true;
  }

  /** A log was replaced or cut short: its thread's steps are dropped and all its logs read again from the start. The
   * steps that come back keep their seq (`kept`): a re-read never renumbers a step a page already has. */
  private resetThread(file: string, source: LogSource) {
    const thread = source.threadOf?.(file);
    const files = thread === undefined ? [file] : [...this.offsets.keys()].filter((f) => f === file || (source.owns(f) && source.threadOf!(f) === thread));
    this.log.warn(`${file} was replaced or cut short: ${thread === undefined ? "it is" : `its thread's logs are`} read again from the start`);
    const db = this.dbs.db;
    db.exec("BEGIN IMMEDIATE");
    try {
      if (thread !== undefined) {
        const keep = this.kept.get(thread) ?? new Map<string, number>();
        for (const r of db.prepare(`SELECT id, seq FROM steps WHERE session_id = ?`).all(thread) as { id: string; seq: number }[]) keep.set(r.id, r.seq);
        this.kept.set(thread, keep);
        db.prepare(`DELETE FROM steps WHERE session_id = ?`).run(thread);
      }
      for (const f of files) this.st.saveOffset.run(f, 0, null, null);
      db.exec("COMMIT");
    } catch (e) { try { db.exec("ROLLBACK"); } catch { /* already rolled back */ } throw e; }
    for (const f of files) {
      this.setOffset(f, 0);
      this.idents.delete(f);
      this.resets.set(f, (this.resets.get(f) ?? 0) + 1);
      if (f !== file) void this.runFile(f, Infinity);
    }
  }

  /** Tell the pages which threads got history stored since the last notice, and their last seq: a page that loaded
   * one of them before has a part of it, and fetches the rest. */
  private noticeStored() {
    if (!this.storedQuietly.size) return;
    for (const sessionId of this.storedQuietly) {
      const next = this.nextSeq.get(sessionId);
      if (next !== undefined) this.gateway.broadcast({ type: "steps-stored", sessionId, lastSeq: next - 1 });
    }
    this.storedQuietly.clear();
  }

  /** Read `file` again in RETRY_MS, instead of waiting for it to grow: a finished thread's last steps would otherwise
   * stay missing until its next line, maybe hours later. */
  private retrySoon(file: string, quietUntil: number) {
    if (this.destroyed || this.retryTimers.has(file)) return;
    const n = (this.retryCount.get(file) ?? 0) + 1;
    if (n > RETRY_MAX) { this.retryCount.delete(file); return; }
    this.retryCount.set(file, n);
    const t = setTimeout(() => { this.retryTimers.delete(file); void this.runFile(file, quietUntil); }, RETRY_MS);
    t.unref?.();
    this.retryTimers.set(file, t);
  }

  /** Sets where reading a log resumes (tests use it to replay a restart mid-file). */
  saveOffset(file: string, offset: number) {
    this.st.saveOffset.run(file, offset, null, null);
    this.setOffset(file, offset);
    this.idents.delete(file);
  }
  private setOffset(file: string, offset: number) {
    this.offsets.set(file, offset);
  }

  // ---- what sources store ----

  /** What a source's parse stores into this chunk: steps numbered in order, threads created with its harness. */
  private sinkFor(b: Batch, harness: Harness): Sink {
    const sink: Sink = {
      step: (parsed: NewStep, opts) => {
        const id = this.ownId(parsed);
        if (id === undefined) return;
        const s = id === parsed.id ? parsed : { ...parsed, id };
        const step = inStoredOrder(s, this.keptSeq(b, s) ?? this.allocSeq(b, s.sessionId));
        this.storeStep(b, step, harness, opts);
        // A shell command that finished: the files it changed become edits too (command-edits.ts). In history at once,
        // without a diff; live a moment later, once the mapper has seen the files change.
        const done = this.commandEdits.step(step, opts?.cwd || this.batchSession(b, step.sessionId)?.cwd || "");
        if (!done) return;
        if (b.quiet) { for (const e of this.commandEdits.editsFor(done, step.ts, false)) sink.step(e, { cwd: "" }); return; }
        const store = (live: boolean) => safely(this.log, "storing a command's file edits", () => this.storeCommandEdits(done, step.ts, harness, live));
        const timer = setTimeout(() => { this.commandTimers.delete(timer); store(true); }, COMMAND_EDIT_WAIT_MS);
        this.commandTimers.set(timer, () => store(false));
      },
      customTitle: (sessionId, title) => this.setCustomTitle(b, sessionId, title, harness),
      turnEnded: (sessionId) => { if (!b.quiet) b.events.push({ turnEnded: sessionId }); },
    };
    return sink;
  }

  /** A live command's file edits, in a transaction of their own, then announced like any live step. `live: false`
   * (the server is stopping): without a diff, and quietly. */
  private storeCommandEdits(done: Parameters<CommandEdits["editsFor"]>[0], ts: string, harness: Harness, live = true) {
    if (this.destroyed) return;
    const edits = this.commandEdits.editsFor(done, ts, live);
    if (!edits.length) return;
    const db = this.dbs.db;
    const b: Batch = { quiet: !live, sessions: new Map(), events: [], announced: new Set(), seqBefore: new Map(), keptUsed: [], quietSessions: new Set() };
    try {
      db.exec("BEGIN IMMEDIATE");
      for (const e of edits) {
        const id = this.ownId(e);
        if (id !== undefined) this.storeStep(b, inStoredOrder({ ...e, id }, this.allocSeq(b, e.sessionId)), harness, { cwd: "" });
      }
      this.flushSessions(b);
      db.exec("COMMIT");
    } catch (e) {
      try { db.exec("ROLLBACK"); } catch { /* already rolled back */ }
      for (const [id, n] of b.seqBefore) if (n === undefined) this.nextSeq.delete(id); else this.nextSeq.set(id, n);
      this.log.warn(`storing a command's file edits failed: ${(e as Error).message}`);
      return;
    }
    this.announce(b);
  }

  /** The id a parsed step is stored under in its thread, or undefined if the thread has it already. Claude Code copies
   * earlier lines, uuid and all, into a resumed or forked thread's log, and repeats some lines within a log: a line the
   * thread has keeps its first place, and a copy of another thread's line gets an id of its own (`<id>@<thread>`), so
   * it never takes that thread's step. Ids stored before stay as they were (links, screenshots and answers use them). */
  private ownId(s: NewStep): string | undefined {
    const at = this.st.stepThread.get(s.id) as { session_id: string } | undefined;
    if (!at) return s.id;
    if (at.session_id === s.sessionId) return undefined;
    const own = `${s.id}@${s.sessionId}`;
    return this.st.stepThread.get(own) ? undefined : own;
  }

  /** The seq a step had before its thread was read again from the start (resetThread), if it had one. */
  private keptSeq(b: Batch, s: NewStep): number | undefined {
    const kept = this.kept.get(s.sessionId);
    const seq = kept?.get(s.id);
    if (seq === undefined) return undefined;
    kept!.delete(s.id);
    if (!kept!.size) this.kept.delete(s.sessionId);
    b.keptUsed.push([s.sessionId, s.id, seq]);
    return seq;
  }

  private allocSeq(b: Batch, sessionId: string): number {
    const cur = this.nextSeq.get(sessionId);
    if (!b.seqBefore.has(sessionId)) b.seqBefore.set(sessionId, cur);
    const n = cur ?? 0;
    this.nextSeq.set(sessionId, n + 1);
    return n;
  }

  // ---- storage + broadcast ----

  private storeStep(b: Batch, step: Step, harness: Harness, opts?: { cwd?: string; promptTitle?: string }) {
    this.st.insertStep.run({
      id: step.id,
      session_id: step.sessionId,
      seq: step.seq,
      ts: step.ts,
      kind: step.kind,
      text: step.text ?? null,
      tool: step.tool ?? null,
      input: step.input !== undefined ? JSON.stringify(step.input) : null,
      file_path: step.filePath ?? null,
      diff: step.diff ? JSON.stringify(step.diff) : null,
      label: step.label ?? null,
      risk: step.risk ? JSON.stringify(step.risk) : null,
      is_subagent: step.isSubagent ? 1 : 0,
      tool_use_id: step.toolUseId ?? null,
      agent_id: step.agentId ?? null,
    });
    this.upsertSession(b, step.sessionId, harness, opts?.cwd ?? "", step.ts, opts?.promptTitle, step.kind === "tool_call" || step.kind === "edit");
    // A thread working elsewhere that touches this project's files: from now on it's a visitor here.
    if (step.filePath && this.activeRoot && !this.visitors.has(step.sessionId) && this.isWithinRoot(step.filePath)) {
      const cwd = opts?.cwd || this.batchSession(b, step.sessionId)?.cwd || "";
      if (cwd && !this.isWithinRoot(cwd)) { this.visitors.add(step.sessionId); this.sessionsCache = null; }
    }
    if (b.quiet) b.quietSessions.add(step.sessionId);
    else {
      if (step.kind === "tool_call" && step.tool === "Bash" && !step.reads) {
        const r = readsOf(step.tool, step.input, opts?.cwd || this.batchSession(b, step.sessionId)?.cwd || this.cwdOf(step.sessionId));
        if (r.reads) step.reads = r.reads;
      }
      b.events.push({ step });
    }
  }

  /** The chunk's copy of a session row (read once per chunk), or undefined if there is none yet. */
  private batchSession(b: Batch, sessionId: string): BatchSession | undefined {
    let r = b.sessions.get(sessionId);
    if (!r) {
      const row = this.st.sessionRow.get(sessionId) as SessionRow | undefined;
      if (!row) return undefined;
      r = { ...row, isNew: false, dirty: false };
      b.sessions.set(sessionId, r);
    }
    return r;
  }

  private announceSession(b: Batch, sessionId: string) {
    if (b.announced.has(sessionId)) return;
    b.announced.add(sessionId);
    b.events.push({ session: sessionId });
  }

  private upsertSession(b: Batch, sessionId: string, harness: Harness, cwd: string, ts: string, rawPrompt?: string, worked = false) {
    const promptTextForTitle = rawPrompt ? titleOfPrompt(rawPrompt) : undefined;
    // A time ahead of the clock (a wrong clock, a log from another machine) is stored as now: the thread would read
    // "running" until the clock caught up.
    const at = Date.parse(ts);
    if (at > Date.now()) ts = new Date().toISOString();
    const row = this.batchSession(b, sessionId);
    if (!row) {
      const title = promptTextForTitle ?? UNTITLED;
      b.sessions.set(sessionId, {
        id: sessionId, cwd, title, started_at: ts, last_event_at: ts, custom_title: 0, title_set: promptTextForTitle ? 1 : 0,
        worked: worked ? 1 : 0, harness, isNew: true, dirty: true,
      });
      this.announceSession(b, sessionId);
      return;
    }
    let title = row.title;
    let titleSet = row.title_set;
    if (!row.custom_title && !row.title_set && promptTextForTitle) {
      title = promptTextForTitle;
      titleSet = 1;
    }
    const lastEventAt = !(Date.parse(row.last_event_at) >= Date.parse(ts)) ? ts : row.last_event_at; // as times, not strings
    // A thread starts with its earliest step (its logs aren't always read in time order).
    if (Date.parse(ts) < Date.parse(row.started_at)) Object.assign(row, { started_at: ts, dirty: true });
    const newCwd = cwd || row.cwd;
    const titleOrCwdChanged = title !== row.title || newCwd !== row.cwd;
    if (titleOrCwdChanged || lastEventAt !== row.last_event_at || titleSet !== row.title_set) {
      Object.assign(row, { cwd: newCwd, title, last_event_at: lastEventAt, title_set: titleSet, dirty: true });
    }
    if (worked && !row.worked) Object.assign(row, { worked: 1, dirty: true });
    if (titleOrCwdChanged) this.announceSession(b, sessionId);
  }

  private setCustomTitle(b: Batch, sessionId: string, customTitle: string, harness: Harness) {
    const row = this.batchSession(b, sessionId);
    const now = new Date().toISOString();
    const title = storedTitle(customTitle, Infinity);
    if (!row) {
      b.sessions.set(sessionId, {
        id: sessionId, cwd: "", title, started_at: now, last_event_at: now, custom_title: 1, title_set: 1, worked: 0,
        harness, isNew: true, dirty: true,
      });
    } else {
      Object.assign(row, { title, custom_title: 1, title_set: 1, dirty: true });
    }
    this.announceSession(b, sessionId);
  }

  /** Write the chunk's session rows, each once. */
  private flushSessions(b: Batch) {
    for (const r of b.sessions.values()) {
      if (!r.dirty) continue;
      if (r.isNew) this.st.insertSession.run(r.id, r.cwd, r.title, r.started_at, r.last_event_at, r.custom_title, r.title_set, r.worked, r.harness);
      else this.st.updateSession.run(r.cwd, r.title, r.started_at, r.last_event_at, r.title_set, r.custom_title, r.worked, r.id);
      this.sessionsCache = null;
    }
  }

  /** After the commit: new threads and title changes (once the server is up), live steps in order. Each step goes to
   * the bus first, then over the socket as the same object (the reader adds its label to it in between). */
  private announce(b: Batch) {
    for (const ev of b.events) {
      try {
        if ("session" in ev) {
          if (this.ready || this.isListening) this.broadcastSession(ev.session);
        } else if ("turnEnded" in ev) {
          if (this.ready) this.bus.emit("turn-ended", { sessionId: ev.turnEnded });
        } else if (this.ready) {
          const step = ev.step;
          this.bus.emit("step", step);
          this.gateway.broadcast({ type: "step", step });
          if (step.kind === "edit" && step.filePath) {
            this.bus.emit("file-touched", { path: step.filePath, sessionId: step.sessionId, ts: step.ts });
          }
        }
      } catch (e) {
        this.log.warn(`announcing a step failed: ${(e as Error).message}`);
      }
    }
  }

  private broadcastSession(sessionId: string) {
    const s = this.getSession(sessionId);
    if (s) {
      this.bus.emit("session", s);
      this.gateway.broadcast({ type: "session", session: s });
    }
  }

  // ---- reads (public API) ----

  /** Every folder Codex worked in, with its threads' files (the workspace picker; see CodexSource.projects). */
  codexProjects(): Map<string, { id: string; mtimeMs: number }[]> {
    return (this.codex ?? new CodexSource(this.cfg.codexDir)).projects();
  }

  /** Codex threads whose log changed since `sinceMs`, any project (for "agents in other projects"). */
  codexRecent(sinceMs: number) {
    return (this.codex ?? new CodexSource(this.cfg.codexDir)).recent(sinceMs);
  }

  /** The folders whose threads this workspace shows: the open root, its repo, the folders it lived in before a move. */
  scopeRoots(): string[] { return this.roots; }

  private rowToSession(row: SessionRow): Session {
    const idle = !(Date.parse(row.last_event_at) >= Date.now() - IDLE_AFTER_MS); // a time that doesn't parse: idle
    const home = this.homeOf(row.cwd);
    return { id: row.id, cwd: row.cwd, title: row.title, startedAt: row.started_at, lastEventAt: row.last_event_at, status: idle ? "idle" : "running", harness: row.harness === "codex" ? "codex" : "claude", ...(home && home !== row.cwd ? { home } : {}) };
  }

  /** A thread folder's repo, its real path (see Session.home), remembered per folder. */
  private homes = new Map<string, string>();
  private homeOf(cwd: string): string {
    if (!cwd) return cwd;
    let h = this.homes.get(cwd);
    if (h === undefined) {
      let real = cwd;
      try { real = realpathSync(cwd); } catch { /* gone: as it was */ }
      this.homes.set(cwd, (h = repoBase(real)));
      if (this.homes.size > 2000) this.homes.delete(this.homes.keys().next().value!);
    }
    return h;
  }

  getSession(id: string): Session | undefined {
    const row = this.st.sessionRow.get(id) as SessionRow | undefined;
    return row ? this.rowToSession(row) : undefined;
  }

  /** Only sessions whose cwd is the active workspace root or inside it (owner: S). Called every 2 s (attention) and by
   * most endpoints: the filtered rows are cached, and only the time-dependent parts are recomputed. */
  listSessions(): Session[] {
    this.sessionsCache ??= this.shownSessionRows();
    let rows = this.sessionsCache;
    for (const source of this.sources) {
      const hidden = source.hidden?.(this.offsets.keys());
      if (hidden) rows = rows.filter((r) => !hidden(r.id));
    }
    return rows.map((r) => this.rowToSession(r));
  }

  private shownSessionRows(): SessionRow[] {
    const rows = this.st.allSessions.all() as SessionRow[];
    // Titles stored before promptTitle() existed can still start with Claude Code's wrapper tags.
    const cleaned = rows.map((r) => (r.custom_title ? r : { ...r, title: promptTitle(r.title) ?? UNTITLED }));
    // A thread where no agent did anything but answer a slash command (opening this app, /compact) isn't work to show.
    const idle = (r: SessionRow) => !r.worked && (r.title.startsWith("/") || r.title === UNTITLED);
    const shown = cleaned.filter((r) => !idle(r));
    if (!this.activeRoot) return shown;
    return shown.filter((r) => this.isWithinRoot(r.cwd) || this.visitors.has(r.id));
  }

  private isWithinRoot(cwd: string): boolean {
    if (!cwd || !this.activeRoot) return false;
    let abs: string;
    try { abs = resolve(cwd); } catch { return false; }
    return this.roots.some((r) => within(abs, r)); // either Unicode form: macOS records the decomposed one
  }

  private rowToStep(row: any): Step {
    return {
      id: row.id, sessionId: row.session_id, seq: row.seq, ts: row.ts, kind: row.kind,
      text: row.text ?? undefined,
      tool: row.tool ?? undefined,
      input: row.input ? JSON.parse(row.input) : undefined,
      filePath: row.file_path ?? undefined,
      diff: row.diff ? JSON.parse(row.diff) : undefined,
      label: row.label ?? undefined,
      risk: row.risk ? JSON.parse(row.risk) : undefined,
      isSubagent: !!row.is_subagent,
      ...(row.agent_id ? { agentId: row.agent_id } : {}),
      ...(row.tool_use_id ? { toolUseId: row.tool_use_id } : {}),
      ...readsOf(row.tool, row.input, this.cwdOf(row.session_id)),
    };
  }

  /** A thread's folder, for its commands' relative paths (cached: rowToStep runs for every step of a long thread). */
  private cwds = new Map<string, string>();
  private cwdOf(sessionId: string): string {
    let c = this.cwds.get(sessionId);
    if (c === undefined) { c = ((this.st.sessionRow.get(sessionId) as { cwd?: string } | undefined)?.cwd) ?? ""; if (c) this.cwds.set(sessionId, c); }
    return c;
  }

  getStep(id: string): Step | undefined {
    const row = this.st.stepById.get(id);
    return row ? this.rowToStep(row) : undefined;
  }

  /** A session's steps in order; with `afterSeq`, only the ones after it. */
  listSteps(sessionId: string, afterSeq?: number): Step[] {
    const rows = afterSeq === undefined ? this.st.stepsOf.all(sessionId) : this.st.stepsAfter.all(sessionId, afterSeq);
    return rows.map((r) => this.rowToStep(r));
  }

  /** `JSON.stringify(listSteps(sessionId, afterSeq))`, byte for byte, built from the stored JSON text without parsing
   * it (GET /sessions/:id/steps: a long thread is thousands of steps). */
  listStepsJson(sessionId: string, afterSeq?: number): string {
    const row = (afterSeq === undefined ? this.st.stepsJson.get(sessionId) : this.st.stepsJsonAfter.get(sessionId, afterSeq)) as { out: string };
    return row.out;
  }

  /** Whether some thread's step referenced this file (an agent read or changed it): the only files the picture endpoint serves. */
  stepTouches(path: string): boolean {
    return !!this.st.stepTouches.get(path);
  }

  /** The n steps immediately before `stepId` in the same session, chronological order. */
  stepsBefore(stepId: string, n: number): Step[] {
    const target = this.st.stepPos.get(stepId) as { session_id: string; seq: number } | undefined;
    if (!target) return [];
    return this.st.stepsBefore.all(target.session_id, target.seq, n).map((r) => this.rowToStep(r)).reverse();
  }

  /** Store a step's label and risk, and tell the pages (`broadcast: false` when the step hasn't gone out yet, so the
   * label rides on it). */
  updateStep(id: string, patch: { label?: string; risk?: string[] }, opts: { broadcast?: boolean } = {}) {
    const row = this.st.stepLabel.get(id) as { label: string | null; risk: string | null } | undefined;
    if (!row) return;
    const label = patch.label !== undefined ? patch.label : row.label;
    const risk = patch.risk !== undefined ? JSON.stringify(patch.risk) : row.risk;
    this.st.updateLabel.run(label ?? null, risk ?? null, id);
    if (opts.broadcast !== false) this.gateway.broadcast({ type: "step-update", id, label: patch.label, risk: patch.risk });
  }

  /** Most recent steps of kind edit/tool_call/prompt with no label yet — for the reader's (B) backfill. */
  unlabeledSteps(limit: number): Step[] {
    return this.st.unlabeled.all(limit).map((r) => this.rowToStep(r));
  }
}

/** A step with its keys in the order rowToStep gives them: the object sent live serializes like the stored one. */
function inStoredOrder(s: NewStep, seq: number): Step {
  const out: Record<string, unknown> = { id: s.id, sessionId: s.sessionId, seq, ts: s.ts, kind: s.kind };
  for (const k of ["text", "tool", "input", "filePath", "diff", "label", "risk"] as const) if (s[k] !== undefined) out[k] = s[k];
  out.isSubagent = !!s.isSubagent;
  if (s.agentId) out.agentId = s.agentId;
  if (s.toolUseId) out.toolUseId = s.toolUseId;
  return out as Step;
}

/** A text column as JSON, as JSON.stringify gives it for the value node:sqlite reads (which stops at a NUL char). */
const jq = (c: string) => `CASE WHEN instr(${c}, char(0)) > 0 THEN json_quote(substr(${c}, 1, instr(${c}, char(0)) - 1)) ELSE json_quote(${c}) END`;
/** A steps row as the JSON of rowToStep(row), built by SQLite: same keys, same order, same escapes; input, diff and
 * risk are stored as JSON already and go in as they are. */
const STEP_JSON = `'{"id":' || ${jq("id")} || ',"sessionId":' || ${jq("session_id")} || ',"seq":' || seq || ',"ts":' || ${jq("ts")} || ',"kind":' || ${jq("kind")}
  || CASE WHEN text IS NOT NULL THEN ',"text":' || ${jq("text")} ELSE '' END
  || CASE WHEN tool IS NOT NULL THEN ',"tool":' || ${jq("tool")} ELSE '' END
  || CASE WHEN input IS NOT NULL AND input != '' THEN ',"input":' || input ELSE '' END
  || CASE WHEN file_path IS NOT NULL THEN ',"filePath":' || ${jq("file_path")} ELSE '' END
  || CASE WHEN diff IS NOT NULL AND diff != '' THEN ',"diff":' || diff ELSE '' END
  || CASE WHEN label IS NOT NULL THEN ',"label":' || ${jq("label")} ELSE '' END
  || CASE WHEN risk IS NOT NULL AND risk != '' THEN ',"risk":' || risk ELSE '' END
  || ',"isSubagent":' || CASE WHEN is_subagent THEN 'true' ELSE 'false' END
  || CASE WHEN agent_id IS NOT NULL AND agent_id != '' THEN ',"agentId":' || ${jq("agent_id")} ELSE '' END
  || CASE WHEN tool_use_id IS NOT NULL AND tool_use_id != '' THEN ',"toolUseId":' || ${jq("tool_use_id")} ELSE '' END
  || coalesce(',"reads":' || step_reads(tool, input, (SELECT cwd FROM sessions WHERE sessions.id = steps.session_id)), '') || '}'`;

/**
 * The files a shell command read (`cat`, `sed -n`, `grep`, … : command-writes.ts commandReads), as a step's `reads`:
 * worked out from the command when steps are read, not stored, so threads from before it have them too. Review agents
 * read the code through the shell far more than with the Read tool; without this they never showed on the map.
 */
const readsCache = new Map<string, string | null>();
function readsJson(tool: string | null, input: string | null, cwd: string | null): string | null {
  if (tool !== "Bash" || !input) return null;
  const key = `${cwd ?? ""}\n${input}`;
  let out = readsCache.get(key);
  if (out === undefined) {
    let command: unknown, dir: unknown;
    try { ({ command, workdir: dir = undefined } = JSON.parse(input) as { command?: unknown; workdir?: unknown }); } catch { /* not JSON */ }
    const reads = typeof command === "string" && command.trim() ? commandReads(command, typeof dir === "string" ? dir : cwd || "/") : [];
    out = reads.length ? JSON.stringify(reads) : null;
    readsCache.set(key, out);
    if (readsCache.size > 20_000) readsCache.delete(readsCache.keys().next().value!);
  }
  return out;
}
/** The same, for a step object: `{ reads }` or nothing. */
export function readsOf(tool: string | null | undefined, input: unknown, cwd: string): { reads?: string[] } {
  const j = readsJson(tool ?? null, input == null ? null : typeof input === "string" ? input : JSON.stringify(input), cwd);
  return j ? { reads: JSON.parse(j) as string[] } : {};
}
const stepsJsonSql = (where: string) =>
  `SELECT '[' || coalesce(group_concat(j, ','), '') || ']' AS out FROM (SELECT ${STEP_JSON} AS j FROM steps WHERE ${where} ORDER BY seq ASC)`;
