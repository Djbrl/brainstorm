import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import type { Harness } from "../shared/contract";
import { DbService } from "../core/db.service";
import { BusService } from "../core/bus.service";
import { EventsGateway, type Broadcaster } from "../core/events.gateway";
import { WorkspaceState } from "../core/workspace-state";
import { ConfigService } from "../core/config.service";
import { safely } from "../core/safely";
import { ClaudeSource } from "./claude.source";
import { CodexSource } from "./codex.source";
import type { LogFile, LogSource, NewStep, Scope, Sink } from "./source";
import { CommandEdits } from "./command-edits";
import { backfillAgentIds } from "./agent-ids";
import { ProjectScope } from "./scope";
import { inStoredOrder, newBatch, StepsStore, StepWriter, type Batch } from "./step-store";
import { Tailer, yieldToLoop } from "./tailer";

// Tail the coding agents' session logs (log sources: claude.source.ts for ~/.claude/projects, codex.source.ts
// for ~/.codex/sessions), store the Steps they parse, emit them on the bus and broadcast them over ws. Reading the
// files is tailer.ts, storing and reading steps step-store.ts (StepsStore: what other modules read), the open project
// scope.ts; this service starts them, follows the workspace and says what happened.

export { sanitizeText, promptTitle } from "./text";
export { readsOf } from "./step-store";

// All of a project's history is loaded: the last two weeks first (the first screen), then older threads a file at a time.
const RECENT_MS = 14 * 24 * 60 * 60 * 1000;
/** How long a live command's file edits wait for the mapper to see the files change (it batches changes for 100 ms). */
const COMMAND_EDIT_WAIT_MS = 1_500;

@Injectable()
export class ListenerService implements OnModuleInit, OnModuleDestroy {
  private log = new Logger("Listener");
  private ready = false;
  /** Where the agents' logs come from: Claude Code's, then Codex's. Built in onModuleInit (it needs the config). */
  private sources: LogSource[] = [];
  private codex?: CodexSource;
  /** Files changed through shell commands, made edits of their thread (command-edits.ts). */
  /** Each built map's .gitignore folders (see the bus's "map-rules"), so command edits follow the map's rules. */
  private mapRules = new Map<string, Set<string> | undefined>();
  private commandEdits = new CommandEdits((p) => this.project.isWithinRoot(p), () => this.project.activeRoot, () => (this.project.activeRoot ? this.mapRules.get(this.project.activeRoot) : undefined));
  /** Live command edits waiting for the mapper to see their files change, each with how to store them at once
   * (without a diff) if the server stops first. */
  private commandTimers = new Map<NodeJS.Timeout, () => void>();
  /** Closes every source's watcher (tests read files themselves). */
  readonly watcher = {
    close: async () => { await Promise.all(this.sources.map((s) => s.close())); },
    /** Every folder the sources watch (chokidar's getWatched, for tests). */
    getWatched: (): Record<string, string[]> => Object.assign({}, ...this.sources.map((s) => s.getWatched?.() ?? {})),
  };
  /** For tests, which build the listener without Nest, close its watchers and read the log files themselves. */
  readonly forTests = {
    /** Steps go out as live activity from now on, as after the watchers' first scan. */
    goLive: () => { this.ready = true; },
    /** Read what `file` gained; `history` reads all of it quietly, as history. */
    readNow: (file: string, history = false) => this.tailer.runFile(file, history ? Infinity : 0),
  };
  /** Resolves once the HTTP server listens: history is read after that, so the app answers from the first second. */
  private listening!: Promise<void>;
  private isListening = false;
  private backfillGen = 0;
  /** Reads the log files (built in onModuleInit, after the sources' re-read, see rereadChangedSources). */
  tailer!: Tailer;
  /** Numbers and stores the steps the sources parse. */
  writer!: StepWriter;
  readonly project: ProjectScope;
  readonly store: StepsStore;
  private destroyed = false;
  /** The one-time pass that gives older subagent steps their agent id (see agent-ids.ts); resolves when it's over. */
  agentIdsDone?: Promise<void>;

  constructor(
    private dbs: DbService,
    private bus: BusService,
    @Inject(EventsGateway) private gateway: Broadcaster,
    private cfg: ConfigService,
    private state: WorkspaceState,
    @Optional() private adapterHost?: HttpAdapterHost,
    // Nest gives the module's own; tests build the listener without Nest, and it makes its own.
    @Optional() project?: ProjectScope,
    @Optional() store?: StepsStore,
  ) {
    this.project = project ?? new ProjectScope(dbs, cfg);
    this.store = store ?? new StepsStore(dbs, this.project, gateway);
  }

  onModuleInit() {
    const warn = (e: Error) => this.log.warn(`watcher error: ${e.message}`);
    this.codex = new CodexSource(this.cfg.codexDir, warn);
    this.sources = [new ClaudeSource(this.cfg.claudeProjectsDir, warn), this.codex];
    this.rereadChangedSources();

    this.writer = new StepWriter(this.dbs.db, this.store, this.project);
    this.tailer = new Tailer(this.dbs, this.store, this.writer, this.gateway, {
      sourceOf: (file) => this.sourceOf(file),
      scope: () => this.scope(),
      sinkFor: (b, harness) => this.sinkFor(b, harness),
      announce: (b) => this.announce(b),
      stopped: () => this.destroyed,
    }, this.log);
    this.store.hideWith(() => this.sources.map((s) => s.hidden?.(this.tailer.offsets.keys())));
    this.listening = this.whenListening();
    this.agentIdsDone = this.fillAgentIds();

    // Start out scoped to the configured default root (repo root, or MAP_ROOT) until a workspace
    // is explicitly chosen (WorkspaceService then emits "workspace" and we re-scope, see below).
    this.setRoot(this.state.root);
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
        change: (f) => void this.tailer.runFile(f, this.tailer.historyEnd.get(f) ?? 0),
        ready: () => {
          if (--waiting > 0) return;
          this.ready = true;
          this.backfillForNewFilter(); // the whole history, once the server is up
          this.log.log(`watching ${this.cfg.claudeProjectsDir} and ${this.cfg.codexDir} live (roots: ${this.project.roots.join(", ")})`);
        },
      });
    }
  }

  /** A source whose reading changed since its threads were stored (its `version`) has them read again: its threads and
   * steps are dropped and its files read from the start (in the background, like any history). */
  private rereadChangedSources() {
    const db = this.dbs.db;
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
        // At startup the seqs and offsets aren't loaded yet (they are read after this); later (tests) they are.
        for (const id of ids) this.writer?.nextSeq.delete(id);
        this.tailer?.forget(files);
        this.store.invalidate();
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
    this.tailer?.close();
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

  // ---- workspace switching (owner: S) ----

  private setRoot(root: string) {
    this.project.set(root);
    this.store.invalidate();
  }

  private scope(): Scope {
    return this.project.current();
  }

  /** The next project opened (from an island on the map) brings this thread along as a visitor. */
  bringGuest(sessionId: string) { this.project.bringGuest(sessionId); }

  private sourceOf(file: string): LogSource | undefined {
    return this.sources.find((s) => s.owns(file));
  }

  private onWorkspaceChanged(root: string) {
    this.setRoot(root);
    this.log.log(`workspace changed: now reading the agents' logs for ${this.project.roots.join(", ")}`);
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
    const { historyEnd, offsets } = this.tailer;
    historyEnd.clear();
    for (const f of files) if ((offsets.get(f.path) ?? 0) < f.size) historyEnd.set(f.path, f.size);
    void this.readHistory(++this.backfillGen, files);
  }

  private async readHistory(gen: number, files: { path: string; mtimeMs: number }[]) {
    await this.listening;
    if (gen !== this.backfillGen) return;
    const { historyEnd } = this.tailer;
    const started = Date.now();
    const todo = files.filter((f) => historyEnd.has(f.path));
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
      const left = paths.filter((p) => historyEnd.has(p)); // not read meanwhile (it changed, and was read up to its end)
      if (!left.length) continue;
      // The thread's own log first, where lines have the same time (it's the shorter path, for both sources).
      left.sort((a, b) => a.length - b.length || (a < b ? -1 : 1));
      await this.tailer.runFiles(left);
      await yieldToLoop();
    }
    this.log.log(`backfill: finished ${todo.length} file(s) in ${Date.now() - started} ms`);
  }

  private onAdd(file: string) {
    // A new thread (or subagent) is live from its first line; a file the backfill listed is read by it. Chokidar's
    // first scan (before ready) is left to the backfill.
    if (this.ready && !this.tailer.historyEnd.has(file)) void this.tailer.runFile(file, 0);
  }

  // ---- what sources store ----

  /** What a source's parse stores into this chunk: steps numbered in order, threads created with its harness. */
  private sinkFor(b: Batch, harness: Harness): Sink {
    const w = this.writer;
    const sink: Sink = {
      step: (parsed: NewStep, opts) => {
        const id = w.ownId(parsed);
        if (id === undefined) return;
        const s = id === parsed.id ? parsed : { ...parsed, id };
        const step = inStoredOrder(s, w.keptSeq(b, s) ?? w.allocSeq(b, s.sessionId));
        w.storeStep(b, step, harness, opts);
        // A shell command that finished: the files it changed become edits too (command-edits.ts). In history at once,
        // without a diff; live a moment later, once the mapper has seen the files change.
        const done = this.commandEdits.step(step, opts?.cwd || w.batchSession(b, step.sessionId)?.cwd || "");
        if (!done) return;
        if (b.quiet) { for (const e of this.commandEdits.editsFor(done, step.ts, false)) sink.step(e, { cwd: "" }); return; }
        const store = (live: boolean) => safely(this.log, "storing a command's file edits", () => this.storeCommandEdits(done, step.ts, harness, live));
        const timer = setTimeout(() => { this.commandTimers.delete(timer); store(true); }, COMMAND_EDIT_WAIT_MS);
        this.commandTimers.set(timer, () => store(false));
      },
      customTitle: (sessionId, title) => w.setCustomTitle(b, sessionId, title, harness),
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
    const w = this.writer;
    const b = newBatch(!live);
    try {
      db.exec("BEGIN IMMEDIATE");
      for (const e of edits) {
        const id = w.ownId(e);
        if (id !== undefined) w.storeStep(b, inStoredOrder({ ...e, id }, w.allocSeq(b, e.sessionId)), harness, { cwd: "" });
      }
      w.flushSessions(b);
      db.exec("COMMIT");
    } catch (e) {
      try { db.exec("ROLLBACK"); } catch { /* already rolled back */ }
      w.rollback(b);
      this.log.warn(`storing a command's file edits failed: ${(e as Error).message}`);
      return;
    }
    this.announce(b);
  }

  // ---- broadcast ----

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
    const s = this.store.getSession(sessionId);
    if (s) {
      this.bus.emit("session", s);
      this.gateway.broadcast({ type: "session", session: s });
    }
  }

  // ---- the sources (public API; threads and steps are StepsStore's) ----

  /** Every folder Codex worked in, with its threads' files (the workspace picker; see CodexSource.projects). */
  codexProjects(): Map<string, { id: string; mtimeMs: number }[]> {
    return (this.codex ?? new CodexSource(this.cfg.codexDir)).projects();
  }

  /** Codex threads whose log changed since `sinceMs`, any project (for "agents in other projects"). */
  codexRecent(sinceMs: number) {
    return (this.codex ?? new CodexSource(this.cfg.codexDir)).recent(sinceMs);
  }

  /** The folders whose threads this workspace shows: the open root, its repo, the folders it lived in before a move. */
  scopeRoots(): string[] { return this.project.roots; }
}
