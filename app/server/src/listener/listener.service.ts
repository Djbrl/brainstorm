import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { closeSync, openSync, readSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import type { Harness, Session, Step } from "../types";
import { DbService } from "../core/db.service";
import { BusService } from "../core/bus.service";
import { EventsGateway } from "../core/events.gateway";
import { ConfigService } from "../core/config.service";
import { formerRoots, repoBase } from "./moved";
import { ClaudeSource } from "./claude.source";
import { CodexSource } from "./codex.source";
import type { LogFile, LogSource, NewStep, Scope, Sink } from "./source";
import { promptTitle } from "./text";
import { CommandEdits } from "./command-edits";
import { backfillAgentIds } from "./agent-ids";

// Owner: A. Tail the coding agents' session logs (log sources: claude.source.ts for ~/.claude/projects, codex.source.ts
// for ~/.codex/sessions), store the Steps they parse, emit them on the bus and broadcast them over ws.

export { sanitizeText, promptTitle, withoutPastes } from "./text";

// All of a project's history is loaded: the last two weeks first (the first screen), then older threads a file at a time.
const RECENT_MS = 14 * 24 * 60 * 60 * 1000;
const IDLE_AFTER_MS = 2 * 60 * 1000;
/** `worked`: an agent called a tool or edited a file in the thread (one that only answered a slash command didn't). */
type SessionRow = { id: string; cwd: string; title: string; started_at: string; last_event_at: string; custom_title: number; title_set: number; worked: number; harness: string | null };
type BatchSession = SessionRow & { isNew: boolean; dirty: boolean };

/** One chunk of a file being stored: passed down the parse, so reads of several files can interleave. */
type Batch = {
  /** Lines ending at or before this byte offset are history: stored, not broadcast as live activity. */
  quietUntil: number;
  /** The line being parsed is history. */
  quiet: boolean;
  /** Session rows this chunk touched, written once at its end. */
  sessions: Map<string, BatchSession>;
  /** Live steps and session announcements, in order, sent once the chunk is committed. */
  events: ({ step: Step } | { session: string } | { turnEnded: string })[];
  announced: Set<string>;
  /** Each touched session's next seq before the chunk, put back if it rolls back. */
  seqBefore: Map<string, number | undefined>;
};

/** How long a live command's file edits wait for the mapper to see the files change (it batches changes for 100 ms). */
const COMMAND_EDIT_WAIT_MS = 1_500;
/** Read size per step of a file. */
const CHUNK_BYTES = 4 * 1024 * 1024;
/** Lines stored per transaction, about: the server answers requests between batches. */
const BATCH_BYTES = 1024 * 1024;
/** A longer line is skipped (with a warning) instead of buffered. The longest seen in real logs is 13 MB (a pasted image). */
const MAX_LINE_BYTES = 16 * 1024 * 1024;
const NL = 0x0a;
const yieldToLoop = () => new Promise<void>((r) => setImmediate(r));
const isSqliteError = (e: unknown) => String((e as { code?: unknown })?.code ?? "").startsWith("ERR_SQLITE");

@Injectable()
export class ListenerService implements OnModuleInit, OnModuleDestroy {
  private log = new Logger("Listener");
  // SESSION_FILTER env is a permanent override (substring of Claude Code's project folder names, old behavior).
  // Otherwise the active workspace's roots scope every source (set on "workspace", owner: S).
  private readonly sessionFilterOverride = process.env.SESSION_FILTER || undefined;
  private activeRoot: string | null = null;
  /** The active root and the folders the repo lived in before it moved (see moved.ts). */
  private roots: string[] = [];
  private offsets = new Map<string, number>();
  private nextSeq = new Map<string, number>();
  private ready = false;
  /** Where the agents' logs come from: Claude Code's, then Codex's. Built in onModuleInit (it needs the config). */
  private sources: LogSource[] = [];
  private codex?: CodexSource;
  /** Files changed through shell commands, made edits of their thread (command-edits.ts). */
  private commandEdits = new CommandEdits((p) => this.isWithinRoot(p));
  /** Live command edits waiting for the mapper to see their files change. */
  private commandTimers = new Set<NodeJS.Timeout>();
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
  private reading = new Map<string, { again?: number; done?: Promise<void> }>();
  /** Each file's size when the backfill listed it: lines up to there are history, anything after is live. */
  private historyEnd = new Map<string, number>();
  /** SESSION_FILTER's first scan reads files one at a time. */
  private historyChain: Promise<void> = Promise.resolve();
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
    // Added 5 Oct 2026: sessions.worked, kept up to date as steps are stored, instead of a scan of every step per list.
    if (!(db.prepare(`PRAGMA table_info(sessions)`).all() as { name: string }[]).some((c) => c.name === "worked")) {
      db.exec("BEGIN");
      try {
        db.exec(`ALTER TABLE sessions ADD COLUMN worked INTEGER NOT NULL DEFAULT 0`);
        db.exec(`UPDATE sessions SET worked = 1 WHERE id IN (SELECT DISTINCT session_id FROM steps WHERE kind IN ('tool_call', 'edit'))`);
        db.exec("COMMIT");
      } catch (e) { db.exec("ROLLBACK"); throw e; }
    }
    // Added 30 Sep 2026: pairs a tool result with its call exactly (older rows are paired by order).
    const stepCols = (db.prepare(`PRAGMA table_info(steps)`).all() as { name: string }[]).map((c) => c.name);
    // Added 6 Oct 2026: which coding agent a thread ran in (null: Claude Code, every thread stored before).
    if (!(db.prepare(`PRAGMA table_info(sessions)`).all() as { name: string }[]).some((c) => c.name === "harness")) db.exec(`ALTER TABLE sessions ADD COLUMN harness TEXT`);
    if (!stepCols.includes("tool_use_id")) db.exec(`ALTER TABLE steps ADD COLUMN tool_use_id TEXT`);
    // Added 5 Oct 2026: which subagent a step comes from, so parallel subagents stay apart after a reload. Steps stored
    // before then get theirs from their logs, once (see agent-ids.ts).
    if (!stepCols.includes("agent_id")) db.exec(`ALTER TABLE steps ADD COLUMN agent_id TEXT`);
    db.exec(`CREATE INDEX IF NOT EXISTS steps_session_seq ON steps(session_id, seq)`);
    db.exec(`CREATE INDEX IF NOT EXISTS steps_label ON steps(kind, label)`);
    // Added 6 Oct 2026: "was this file touched by a step?" for the picture endpoint (image/).
    db.exec(`CREATE INDEX IF NOT EXISTS steps_file ON steps(file_path)`);
    // Added 3 Oct 2026: compacted-conversation recaps were stored as prompts; they read as the agent's text.
    db.exec(`UPDATE steps SET kind = 'text' WHERE kind = 'prompt' AND text LIKE 'This session is being continued from a previous conversation%'`);
    this.st = this.prepare();

    const warn = (e: Error) => this.log.warn(`watcher error: ${e.message}`);
    this.codex = new CodexSource(this.cfg.codexDir, warn);
    this.sources = [new ClaudeSource(this.cfg.claudeProjectsDir, warn), this.codex];
    this.rereadChangedSources();

    for (const row of db.prepare(`SELECT file, offset FROM listener_offsets`).all() as { file: string; offset: number }[]) {
      this.offsets.set(row.file, row.offset);
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

    let waiting = this.sources.length;
    for (const source of this.sources) {
      source.watch(this.scope(), {
        add: (f) => this.onAdd(f),
        change: (f) => void this.runFile(f, this.historyEnd.get(f) ?? 0),
        ready: () => {
          if (--waiting > 0) return;
          this.ready = true;
          if (!this.sessionFilterOverride) this.backfillForNewFilter(); // the whole history, once the server is up
          this.log.log(`watching ${this.cfg.claudeProjectsDir} and ${this.cfg.codexDir} live (${this.sessionFilterOverride ? `filter="${this.sessionFilterOverride}"` : `roots: ${this.roots.join(", ")}`})`);
        },
      });
    }
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
    this.destroyed = true;
    for (const t of this.commandTimers) clearTimeout(t);
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
    return {
      insertStep: db.prepare(
        `INSERT OR REPLACE INTO steps (id, session_id, seq, ts, kind, text, tool, input, file_path, diff, label, risk, is_subagent, tool_use_id, agent_id)
         VALUES (@id, @session_id, @seq, @ts, @kind, @text, @tool, @input, @file_path, @diff, @label, @risk, @is_subagent, @tool_use_id, @agent_id)`,
      ),
      sessionRow: db.prepare(`SELECT * FROM sessions WHERE id = ?`),
      insertSession: db.prepare(`INSERT INTO sessions (id, cwd, title, started_at, last_event_at, custom_title, title_set, worked, harness) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
      updateSession: db.prepare(`UPDATE sessions SET cwd = ?, title = ?, last_event_at = ?, title_set = ?, custom_title = ?, worked = ? WHERE id = ?`),
      allSessions: db.prepare(`SELECT * FROM sessions ORDER BY last_event_at DESC`),
      saveOffset: db.prepare(`INSERT INTO listener_offsets (file, offset) VALUES (?, ?) ON CONFLICT(file) DO UPDATE SET offset = excluded.offset`),
      stepById: db.prepare(`SELECT * FROM steps WHERE id = ?`),
      stepsOf: db.prepare(`SELECT * FROM steps WHERE session_id = ? ORDER BY seq ASC`),
      stepsAfter: db.prepare(`SELECT * FROM steps WHERE session_id = ? AND seq > ? ORDER BY seq ASC`),
      stepsJson: db.prepare(stepsJsonSql(`session_id = ?`)),
      stepsJsonAfter: db.prepare(stepsJsonSql(`session_id = ? AND seq > ?`)),
      stepTouches: db.prepare(`SELECT 1 FROM steps WHERE file_path = ? LIMIT 1`),
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
    this.sessionsCache = null;
  }

  private scope(): Scope {
    return { roots: this.roots, override: this.sessionFilterOverride };
  }

  private sourceOf(file: string): LogSource | undefined {
    return this.sources.find((s) => s.owns(file));
  }

  private onWorkspaceChanged(root: string) {
    this.setRoot(root);
    if (this.sessionFilterOverride) return; // permanent override, ignore workspace changes
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
    this.log.log(`backfill: reading ${todo.length} of ${files.length} jsonl file(s), newest first (${recent} from the last two weeks)`);
    for (const f of todo) {
      if (gen !== this.backfillGen) return; // the workspace changed again: that backfill takes over
      const end = this.historyEnd.get(f.path);
      if (end === undefined) continue;     // read meanwhile (it changed, and was read up to its end)
      await this.runFile(f.path, end);
      await yieldToLoop();
    }
    this.log.log(`backfill: finished ${todo.length} file(s) in ${Date.now() - started} ms`);
  }

  // ---- file tailing ----

  private onAdd(file: string) {
    if (this.ready) {
      // A new thread (or subagent) is live from its first line; a file the backfill listed is read by it.
      if (!this.historyEnd.has(file)) void this.runFile(file, 0);
      return;
    }
    // Chokidar's first scan. The backfill reads everything once the server is up; with SESSION_FILTER (no backfill)
    // the last two weeks are read here, as history, one file at a time.
    if (!this.sessionFilterOverride) return;
    let mtimeMs: number;
    try { mtimeMs = statSync(file).mtimeMs; } catch { return; }
    if (Date.now() - mtimeMs > RECENT_MS) return;
    this.historyChain = this.historyChain.then(() => this.runFile(file, Infinity));
  }

  /** Read what `file` gained since its offset. One pass at a time per file: a change during a pass queues another.
   * Lines ending at or before byte `quietUntil` are history (not broadcast). Never rejects. */
  private runFile(file: string, quietUntil: number): Promise<void> {
    const cur = this.reading.get(file);
    if (cur) {
      cur.again = Math.min(cur.again ?? Infinity, quietUntil);
      return cur.done!;
    }
    const entry: { again?: number; done?: Promise<void> } = { again: quietUntil };
    this.reading.set(file, entry);
    entry.done = (async () => {
      try {
        while (entry.again !== undefined) {
          const q = entry.again;
          entry.again = undefined;
          await this.readFile(file, q);
        }
      } catch (e) {
        this.log.warn(`handleFile(${file}) failed: ${(e as Error).message}`);
      } finally {
        this.reading.delete(file);
        const end = this.historyEnd.get(file);
        if (end !== undefined && (this.offsets.get(file) ?? 0) >= end) this.historyEnd.delete(file);
      }
    })();
    return entry.done;
  }

  /** Read the appended bytes chunkBytes at a time, split on newline bytes before decoding (a multibyte character
   * never spans one), and store the complete lines about batchBytes per transaction, each with the byte offset after
   * its last line, yielding in between. A partial last line waits for the next change. */
  private async readFile(file: string, quietUntil: number): Promise<void> {
    const source = this.sourceOf(file);
    if (!source || !source.inScope(file, this.scope())) return;
    let fd: number | undefined;
    try {
      const size = statSync(file).size;
      const prev = this.offsets.get(file) ?? 0;
      if (size < prev) { this.saveOffset(file, 0); return; } // file rotated/truncated
      if (size === prev) return;
      fd = openSync(file, "r");
      let pos = prev;                     // next byte to read
      let pending: Buffer | null = null;  // the start of a line not complete yet
      let skipping = false;               // inside a line longer than maxLineBytes: dropped up to its end
      let first = true;
      while (pos < size) {
        if (!first) await yieldToLoop();
        first = false;
        const want = Math.min(this.chunkBytes, size - pos);
        const chunk = Buffer.allocUnsafe(want);
        const n = readSync(fd, chunk, 0, want, pos);
        if (n <= 0) break;
        const chunkStart = pos;
        pos += n;
        let data = chunk.subarray(0, n);
        let dataStart = chunkStart;
        if (skipping) {
          const nl = data.indexOf(NL);
          if (nl === -1) continue;
          skipping = false;
          data = data.subarray(nl + 1);
          dataStart = chunkStart + nl + 1;
          this.saveOffset(file, dataStart); // past the long line
        }
        const work: Buffer = pending ? Buffer.concat([pending, data]) : data;
        const workStart = dataStart - (pending ? pending.length : 0);
        pending = null;
        const lastNl = work.lastIndexOf(NL);
        let rest: Buffer = work;
        if (lastNl !== -1) {
          // Stored a batch of about batchBytes at a time, yielding in between, so a request waits one batch at most.
          const end = lastNl + 1;
          for (let s = 0; s < end;) {
            let e = end;
            if (end - s > this.batchBytes) {
              e = work.lastIndexOf(NL, s + this.batchBytes - 1) + 1;
              if (e <= s) e = work.indexOf(NL, s + this.batchBytes) + 1; // one line longer than a batch
            }
            if (!this.commitChunk(file, work, workStart, s, e, quietUntil)) return;
            s = e;
            if (s < end) await yieldToLoop();
          }
          rest = work.subarray(end);
        }
        if (rest.length > this.maxLineBytes) {
          this.log.warn(`skipping a line over ${Math.round(this.maxLineBytes / 1048576)} MB in ${file} (byte ${workStart + work.length - rest.length})`);
          skipping = true;
        } else if (rest.length) pending = Buffer.from(rest); // a copy: don't keep the whole chunk alive
      }
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  }

  /** Store the complete lines buf[start, end) (buf[0] is byte `bufStart` of the file) and the offset after them in
   * one transaction, then announce what was live. On a database error nothing of it is kept (seqs put back, offset
   * unchanged), so the file's next change retries it; returns false then. */
  private commitChunk(file: string, buf: Buffer, bufStart: number, start: number, end: number, quietUntil: number): boolean {
    const db = this.dbs.db;
    const source = this.sourceOf(file);
    if (!source) return true;
    const batch: Batch = { quietUntil, quiet: true, sessions: new Map(), events: [], announced: new Set(), seqBefore: new Map() };
    const sink = this.sinkFor(batch, source.harness);
    db.exec("BEGIN");
    try {
      for (let s = start; s < end;) {
        let e = buf.indexOf(NL, s);
        if (e === -1 || e >= end) e = end;
        if (e - s > this.maxLineBytes) {
          this.log.warn(`skipping a line over ${Math.round(this.maxLineBytes / 1048576)} MB in ${file} (byte ${bufStart + s})`);
        } else if (e > s) {
          batch.quiet = bufStart + e + 1 <= quietUntil;
          let obj: unknown;
          try {
            obj = JSON.parse(buf.toString("utf8", s, e));
          } catch (err) {
            this.log.warn(`bad jsonl line in ${file}: ${(err as Error).message}`);
          }
          if (obj) {
            try { source.parse(file, obj, sink); } catch (err) {
              if (isSqliteError(err)) throw err; // the database, not the line: roll the batch back
              this.log.warn(`bad jsonl line in ${file}: ${(err as Error).message}`);
            }
          }
        }
        s = e + 1;
      }
      this.flushSessions(batch);
      this.st.saveOffset.run(file, bufStart + end);
      db.exec("COMMIT");
    } catch (e) {
      try { db.exec("ROLLBACK"); } catch { /* already rolled back */ }
      for (const [id, n] of batch.seqBefore) if (n === undefined) this.nextSeq.delete(id); else this.nextSeq.set(id, n);
      this.log.warn(`storing ${file} from byte ${bufStart + start} failed, retried on its next change: ${(e as Error).message}`);
      return false;
    }
    this.setOffset(file, bufStart + end);
    this.announce(batch);
    return true;
  }

  private saveOffset(file: string, offset: number) {
    this.st.saveOffset.run(file, offset);
    this.setOffset(file, offset);
  }
  private setOffset(file: string, offset: number) {
    this.offsets.set(file, offset);
  }

  // ---- what sources store ----

  /** What a source's parse stores into this chunk: steps numbered in order, threads created with its harness. */
  private sinkFor(b: Batch, harness: Harness): Sink {
    const sink: Sink = {
      step: (s: NewStep, opts) => {
        const step = inStoredOrder(s, this.allocSeq(b, s.sessionId));
        this.storeStep(b, step, harness, opts);
        // A shell command that finished: the files it changed become edits too (command-edits.ts). In history at once,
        // without a diff; live a moment later, once the mapper has seen the files change.
        const done = this.commandEdits.step(step, opts?.cwd || this.batchSession(b, step.sessionId)?.cwd || "");
        if (!done) return;
        if (b.quiet) { for (const e of this.commandEdits.editsFor(done, step.ts, false)) sink.step(e, { cwd: "" }); return; }
        const timer = setTimeout(() => { this.commandTimers.delete(timer); this.storeCommandEdits(done, step.ts, harness); }, COMMAND_EDIT_WAIT_MS);
        this.commandTimers.add(timer);
      },
      customTitle: (sessionId, title) => this.setCustomTitle(b, sessionId, title, harness),
      turnEnded: (sessionId) => { if (!b.quiet) b.events.push({ turnEnded: sessionId }); },
    };
    return sink;
  }

  /** A live command's file edits, in a transaction of their own, then announced like any live step. */
  private storeCommandEdits(done: Parameters<CommandEdits["editsFor"]>[0], ts: string, harness: Harness) {
    if (this.destroyed) return;
    const edits = this.commandEdits.editsFor(done, ts, true);
    if (!edits.length) return;
    const db = this.dbs.db;
    const b: Batch = { quietUntil: 0, quiet: false, sessions: new Map(), events: [], announced: new Set(), seqBefore: new Map() };
    db.exec("BEGIN");
    try {
      for (const e of edits) this.storeStep(b, inStoredOrder(e, this.allocSeq(b, e.sessionId)), harness, { cwd: "" });
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
    if (!b.quiet) b.events.push({ step });
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
    const promptTextForTitle = rawPrompt ? promptTitle(rawPrompt) : undefined;
    const row = this.batchSession(b, sessionId);
    if (!row) {
      const title = promptTextForTitle ? promptTextForTitle.slice(0, 80) : "(untitled session)";
      b.sessions.set(sessionId, {
        id: sessionId, cwd, title, started_at: ts, last_event_at: ts, custom_title: 0, title_set: promptTextForTitle ? 1 : 0,
        worked: worked ? 1 : 0, harness: harness === "claude" ? null : harness, isNew: true, dirty: true,
      });
      this.announceSession(b, sessionId);
      return;
    }
    let title = row.title;
    let titleSet = row.title_set;
    if (!row.custom_title && !row.title_set && promptTextForTitle) {
      title = promptTextForTitle.slice(0, 80);
      titleSet = 1;
    }
    const lastEventAt = ts > row.last_event_at ? ts : row.last_event_at;
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
    if (!row) {
      b.sessions.set(sessionId, {
        id: sessionId, cwd: "", title: customTitle, started_at: now, last_event_at: now, custom_title: 1, title_set: 1, worked: 0,
        harness: harness === "claude" ? null : harness, isNew: true, dirty: true,
      });
    } else {
      Object.assign(row, { title: customTitle, custom_title: 1, title_set: 1, dirty: true });
    }
    this.announceSession(b, sessionId);
  }

  /** Write the chunk's session rows, each once. */
  private flushSessions(b: Batch) {
    for (const r of b.sessions.values()) {
      if (!r.dirty) continue;
      if (r.isNew) this.st.insertSession.run(r.id, r.cwd, r.title, r.started_at, r.last_event_at, r.custom_title, r.title_set, r.worked, r.harness);
      else this.st.updateSession.run(r.cwd, r.title, r.last_event_at, r.title_set, r.custom_title, r.worked, r.id);
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
    const idle = Date.now() - Date.parse(row.last_event_at) > IDLE_AFTER_MS;
    return { id: row.id, cwd: row.cwd, title: row.title, startedAt: row.started_at, lastEventAt: row.last_event_at, status: idle ? "idle" : "running", harness: row.harness === "codex" ? "codex" : "claude" };
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
    const cleaned = rows.map((r) => (r.custom_title ? r : { ...r, title: promptTitle(r.title) ?? "(untitled session)" }));
    // A thread where no agent did anything but answer a slash command (opening this app, /compact) isn't work to show.
    const idle = (r: SessionRow) => !r.worked && (r.title.startsWith("/") || r.title === "(untitled session)");
    const shown = cleaned.filter((r) => !idle(r));
    if (!this.activeRoot) return shown;
    return shown.filter((r) => this.isWithinRoot(r.cwd));
  }

  private isWithinRoot(cwd: string): boolean {
    if (!cwd || !this.activeRoot) return false;
    let abs: string;
    try { abs = resolve(cwd); } catch { return false; }
    return this.roots.some((r) => abs === r || abs.startsWith(r + sep));
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
    };
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
  || CASE WHEN tool_use_id IS NOT NULL AND tool_use_id != '' THEN ',"toolUseId":' || ${jq("tool_use_id")} ELSE '' END || '}'`;
const stepsJsonSql = (where: string) =>
  `SELECT '[' || coalesce(group_concat(j, ','), '') || ']' AS out FROM (SELECT ${STEP_JSON} AS j FROM steps WHERE ${where} ORDER BY seq ASC)`;
