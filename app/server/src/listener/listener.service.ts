import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import chokidar, { type FSWatcher } from "chokidar";
import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";
import type { Session, Step, StepKind } from "../types";
import { DbService } from "../core/db.service";
import { BusService } from "../core/bus.service";
import { EventsGateway } from "../core/events.gateway";
import { ConfigService } from "../core/config.service";
import { maskSecrets } from "../privacy/mask";
import { encodeRoot, formerRoots, repoBase, underPrefix } from "./moved";

// Owner: A. Tail ~/.claude/projects/**/*.jsonl, parse into Steps, store, emit on bus, broadcast over ws.

// All of a project's history is loaded: the last two weeks first (the first screen), then older threads a file at a time.
const RECENT_MS = 14 * 24 * 60 * 60 * 1000;
const IDLE_AFTER_MS = 2 * 60 * 1000;
const TEXT_LIMIT = 20_000;
const TOOL_RESULT_LIMIT = 2_000;
/** How far past the limit a long text is cut before masking (see sanitizeText). */
const MASK_MARGIN = 1024;

/** Recursively mask string leaves and clip them to `limit` chars, keeping JSON-shaped values intact. */
function sanitizeDeep(v: unknown, limit = TEXT_LIMIT): unknown {
  if (typeof v === "string") return sanitizeText(v, limit);
  if (Array.isArray(v)) return v.map((x) => sanitizeDeep(x, limit));
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = sanitizeDeep(val, limit);
    return out;
  }
  return v;
}
/** Mask, then clip to `limit` chars. A long text (a 5 MB tool output kept to 2,000 chars) is cut first, a margin past
 * the limit, so the masking runs on what is kept rather than on all of it. The cut lands on a line break (else a
 * space): no key, token or connection string spans one, and a PEM block cut short is still masked to its end. If
 * masking shortens the kept part a lot (big keys replaced), text near the cut could move inside the limit: then the
 * whole text is masked, as before. */
export function sanitizeText(s: string, limit = TEXT_LIMIT): string {
  let masked: string | undefined;
  if (s.length > limit + MASK_MARGIN) {
    const cut = safeCut(s, limit + MASK_MARGIN);
    if (cut > 0) {
      const head = s.slice(0, cut);
      const m = maskSecrets(head);
      if (head.length - m.length <= MASK_MARGIN / 4) masked = m;
    }
  }
  masked ??= maskSecrets(s);
  return masked.length > limit ? masked.slice(0, limit) + "\n…(truncated)" : masked;
}
/** Where to cut `s` at or after `from`: the next line break, else the next space or tab, within 16k chars; -1 if none. */
function safeCut(s: string, from: number): number {
  const to = Math.min(s.length, from + 16_384);
  const nl = s.indexOf("\n", from);
  if (nl !== -1 && nl < to) return nl;
  for (let i = from; i < to; i++) { const c = s.charCodeAt(i); if (c === 32 || c === 9 || c === 13) return i; }
  return -1;
}

type RawLine = {
  type?: string;
  uuid?: string;
  sessionId?: string;
  cwd?: string;
  timestamp?: string;
  isSidechain?: boolean;
  /** Claude Code's recap of a conversation it compacted: the agent's context, not something the person wrote. */
  isCompactSummary?: boolean;
  customTitle?: string;
  message?: { role?: string; content?: unknown };
};

type SessionRow = { id: string; cwd: string; title: string; started_at: string; last_event_at: string; custom_title: number; title_set: number };

/** Threads deleted in Claude's desktop app: it leaves a `deleted_<sessionId>` file per thread. Re-read at most once a minute. */
let deletedCache: { at: number; ids: Set<string> } | null = null;
function deletedThreads(): Set<string> {
  if (deletedCache && Date.now() - deletedCache.at < 60_000) return deletedCache.ids;
  const ids = new Set<string>();
  const root = join(homedir(), "Library", "Application Support", "Claude", "claude-code-sessions"); // macOS; elsewhere nothing is found
  const list = (dir: string) => { try { return readdirSync(dir); } catch { return []; } }; // no desktop app, or a file
  for (const a of list(root)) for (const b of list(join(root, a))) for (const f of list(join(root, a, b))) {
    if (f.startsWith("deleted_")) ids.add(f.slice("deleted_".length));
  }
  deletedCache = { at: Date.now(), ids };
  return ids;
}

@Injectable()
export class ListenerService implements OnModuleInit {
  private log = new Logger("Listener");
  // SESSION_FILTER env is a permanent override (substring match, old behavior). Otherwise the
  // active workspace's Claude Code project folder prefix is used (set on "workspace", owner: S).
  private readonly sessionFilterOverride = process.env.SESSION_FILTER || undefined;
  private projectFilterPrefixes: string[] = [];
  private activeRoot: string | null = null;
  /** The active root and the folders the repo lived in before it moved (see moved.ts). */
  private roots: string[] = [];
  private offsets = new Map<string, number>();
  private nextSeq = new Map<string, number>();
  private ready = false;
  private watcher?: FSWatcher;

  constructor(
    private dbs: DbService,
    private bus: BusService,
    private gateway: EventsGateway,
    private cfg: ConfigService,
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
    // Added 30 Sep 2026: pairs a tool result with its call exactly (older rows are paired by order).
    if (!(db.prepare(`PRAGMA table_info(steps)`).all() as { name: string }[]).some((c) => c.name === "tool_use_id")) db.exec(`ALTER TABLE steps ADD COLUMN tool_use_id TEXT`);
    db.exec(`CREATE INDEX IF NOT EXISTS steps_session_seq ON steps(session_id, seq)`);
    db.exec(`CREATE INDEX IF NOT EXISTS steps_label ON steps(kind, label)`);
    // Added 3 Oct 2026: compacted-conversation recaps were stored as prompts; they read as the agent's text.
    db.exec(`UPDATE steps SET kind = 'text' WHERE kind = 'prompt' AND text LIKE 'This session is being continued from a previous conversation%'`);

    for (const row of db.prepare(`SELECT file, offset FROM listener_offsets`).all() as { file: string; offset: number }[]) {
      this.offsets.set(row.file, row.offset);
    }
    for (const row of db.prepare(`SELECT session_id, MAX(seq) as m FROM steps GROUP BY session_id`).all() as { session_id: string; m: number }[]) {
      this.nextSeq.set(row.session_id, row.m + 1);
    }

    // Start out scoped to the configured default root (repo root, or MAP_ROOT) until a workspace
    // is explicitly chosen (WorkspaceService then emits "workspace" and we re-scope, see below).
    this.setRoot(this.cfg.defaultRoot);
    this.bus.on("workspace", ({ root }) => this.onWorkspaceChanged(root));

    this.watcher = chokidar.watch(this.cfg.claudeProjectsDir, {
      ignoreInitial: false,
      depth: 4,
      ignored: (path: string, stats?: { isFile(): boolean }) => (stats?.isFile() ? !path.endsWith(".jsonl") : false),
    });
    this.watcher.on("add", (f) => this.handleFile(f));
    this.watcher.on("change", (f) => this.handleFile(f));
    this.watcher.on("error", (e) => this.log.warn(`watcher error: ${(e as Error).message}`));
    this.watcher.on("ready", () => {
      this.ready = true;
      if (!this.sessionFilterOverride) this.backfillForNewFilter(); // the older threads skipped at boot
      this.log.log(`backfill complete, watching ${this.cfg.claudeProjectsDir} live (filter="${this.sessionFilterOverride ?? this.projectFilterPrefixes.join(", ")}")`);
    });
  }

  // ---- workspace switching (owner: S) ----

  private setRoot(root: string) {
    this.activeRoot = resolve(root);
    // Opened from a worktree: the whole repo's threads (its main checkout and every worktree), not just this one's.
    const base = repoBase(this.activeRoot);
    this.roots = [...new Set([this.activeRoot, base, ...formerRoots(this.cfg.claudeProjectsDir, this.activeRoot)])];
    this.projectFilterPrefixes = this.sessionFilterOverride ? [] : this.roots.map(encodeRoot);
  }

  /** True if `projectDir` (a top-level folder name under claudeProjectsDir) belongs to the active workspace. */
  private matchesFilter(projectDir: string): boolean {
    if (this.sessionFilterOverride) return projectDir.includes(this.sessionFilterOverride);
    return this.projectFilterPrefixes.some((p) => underPrefix(projectDir, p));
  }

  private onWorkspaceChanged(root: string) {
    this.setRoot(root);
    if (this.sessionFilterOverride) return; // permanent override, ignore workspace changes
    this.log.log(`workspace changed: now filtering Claude Code projects by prefix "${this.projectFilterPrefixes.join(", ")}"`);
    this.backfillForNewFilter();
  }

  /** Read every thread of the project folders now matching the filter that we haven't tailed yet, newest first:
   * the last two weeks right away, older ones a file at a time so the server stays responsive. Quietly: history
   * isn't live activity (no step broadcasts, map touches, agent markers or labels), only new threads are announced.
   * Reuses handleFile's offset bookkeeping, so nothing duplicates. */
  private backfillForNewFilter() {
    let dirs: string[];
    try { dirs = readdirSync(this.cfg.claudeProjectsDir); } catch (e) {
      this.log.warn(`backfill: cannot read ${this.cfg.claudeProjectsDir}: ${(e as Error).message}`);
      return;
    }
    const files: { path: string; mtimeMs: number }[] = [];
    for (const d of dirs) if (this.matchesFilter(d)) this.collectJsonl(join(this.cfg.claudeProjectsDir, d), files);
    files.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const gen = ++this.backfillGen;
    const recent = files.filter((f) => Date.now() - f.mtimeMs <= RECENT_MS);
    const older = files.slice(recent.length);
    for (const f of recent) this.handleFile(f.path, true);
    this.log.log(`backfill: read ${recent.length} recent jsonl file(s) for the new workspace, ${older.length} older ones to follow`);
    const next = (i: number) => {
      if (gen !== this.backfillGen) return;                     // the workspace changed again: that backfill takes over
      if (i >= older.length) { if (older.length) this.log.log(`backfill: read ${older.length} older jsonl file(s)`); return; }
      this.handleFile(older[i].path, true);
      setTimeout(() => next(i + 1), 0);
    };
    setTimeout(() => next(0), 0);
  }
  private backfillGen = 0;
  /** True while reading history: steps are stored, not broadcast as live activity. */
  private quiet = false;

  private collectJsonl(dir: string, out: { path: string; mtimeMs: number }[]) {
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    for (const name of entries) {
      const p = join(dir, name);
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) { this.collectJsonl(p, out); continue; } // e.g. <session>/subagents/
      if (name.endsWith(".jsonl")) out.push({ path: p, mtimeMs: st.mtimeMs });
    }
  }

  // ---- file tailing ----

  private handleFile(file: string, history = false) {
    try {
      // Session files live at <projectsDir>/<project>/<sessionId>.jsonl, and subagent
      // transcripts one level deeper at <projectsDir>/<project>/<sessionId>/subagents/agent-*.jsonl.
      // Filter on the top-level project folder name either way.
      const rel = relative(this.cfg.claudeProjectsDir, file);
      const projectDir = rel.split(sep)[0] ?? "";
      if (!this.matchesFilter(projectDir)) return;
      const stat = statSync(file);
      // At boot only the last two weeks are read before the server is up; older threads follow once it is (see "ready").
      if (!this.ready && !history && Date.now() - stat.mtimeMs > RECENT_MS) return;

      const prevOffset = this.offsets.get(file) ?? 0;
      const { text, newOffset } = this.readAppended(file, prevOffset, stat.size);
      if (!text) {
        if (newOffset !== prevOffset) this.saveOffset(file, newOffset);
        return;
      }
      const lines = text.split("\n").filter((l) => l.length > 0);
      this.quiet = history;
      try {
        for (const line of lines) {
          try {
            const obj = JSON.parse(line) as RawLine;
            this.ingestLine(obj);
          } catch (e) {
            this.log.warn(`bad jsonl line in ${file}: ${(e as Error).message}`);
          }
        }
      } finally { this.quiet = false; }
      this.saveOffset(file, newOffset);
    } catch (e) {
      this.log.warn(`handleFile(${file}) failed: ${(e as Error).message}`);
    }
  }

  /** Read only the appended bytes since prevOffset, holding back a partial trailing line. */
  private readAppended(file: string, prevOffset: number, size: number): { text: string; newOffset: number } {
    if (size < prevOffset) return { text: "", newOffset: 0 }; // file rotated/truncated
    if (size === prevOffset) return { text: "", newOffset: prevOffset };
    const fd = openSync(file, "r");
    let text: string;
    try {
      const len = size - prevOffset;
      const buf = Buffer.alloc(len);
      readSync(fd, buf, 0, len, prevOffset);
      text = buf.toString("utf8");
    } finally {
      closeSync(fd);
    }
    const lastNewline = text.lastIndexOf("\n");
    if (lastNewline === -1) return { text: "", newOffset: prevOffset }; // no complete line yet
    const consumed = text.slice(0, lastNewline + 1);
    const consumedBytes = Buffer.byteLength(consumed, "utf8");
    return { text: consumed, newOffset: prevOffset + consumedBytes };
  }

  private saveOffset(file: string, offset: number) {
    this.offsets.set(file, offset);
    this.dbs.db
      .prepare(`INSERT INTO listener_offsets (file, offset) VALUES (?, ?) ON CONFLICT(file) DO UPDATE SET offset = excluded.offset`)
      .run(file, offset);
  }

  // ---- parsing ----

  private ingestLine(o: RawLine) {
    if (o.type === "custom-title") {
      if (o.sessionId && o.customTitle) this.setCustomTitle(o.sessionId, o.customTitle);
      return;
    }
    if (o.type === "user") {
      this.ingestUser(o);
      return;
    }
    if (o.type === "assistant") {
      this.ingestAssistant(o);
      return;
    }
    // Ignore attachment, system, queue-operation, agent-name, last-prompt, atis-latch, file-history-snapshot, etc.
  }

  private ingestUser(o: RawLine) {
    const sessionId = o.sessionId;
    if (!sessionId) return;
    const content = o.message?.content;
    const ts = o.timestamp ?? new Date().toISOString();
    const isSubagent = o.isSidechain === true;

    if (o.isCompactSummary) { // the recap Claude Code writes when it compacts a long conversation
      const text = typeof content === "string" ? content : Array.isArray(content) ? content.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("\n\n") : "";
      if (text.trim()) this.storeStep(this.makeStep(o, sessionId, 0, ts, "text", text, isSubagent), { cwd: o.cwd });
      return;
    }

    if (typeof content === "string") {
      const step = this.makeStep(o, sessionId, 0, ts, "prompt", content, isSubagent);
      this.storeStep(step, { cwd: o.cwd, promptTitle: content });
      return;
    }
    if (!Array.isArray(content)) return;

    const textBlocks: { i: number; text: string }[] = [];
    content.forEach((b: any, i: number) => {
      if (b && b.type === "text" && typeof b.text === "string" && b.text.trim()) textBlocks.push({ i, text: b.text });
    });
    if (textBlocks.length) {
      const joined = textBlocks.map((b) => b.text).join("\n\n");
      if (/^\s*\[Request interrupted by user/.test(joined)) return; // harness notice, not a human prompt
      const step = this.makeStep(o, sessionId, textBlocks[0].i, ts, "prompt", joined, isSubagent);
      this.storeStep(step, { cwd: o.cwd, promptTitle: joined });
    }

    content.forEach((b: any, i: number) => {
      if (!b || b.type !== "tool_result") return;
      let text: string;
      if (typeof b.content === "string") text = b.content;
      else if (Array.isArray(b.content)) text = b.content.filter((c: any) => c?.type === "text").map((c: any) => c.text).join("\n\n");
      else text = JSON.stringify(b.content ?? "");
      const step = this.makeStep(o, sessionId, i, ts, "tool_result", sanitizeText(text, TOOL_RESULT_LIMIT), isSubagent);
      if (typeof b.tool_use_id === "string") step.toolUseId = b.tool_use_id;
      if (b.is_error) step.input = { isError: true, toolUseId: b.tool_use_id }; // read by the failures module
      this.storeStep(step, { cwd: o.cwd });
    });
  }

  private ingestAssistant(o: RawLine) {
    const sessionId = o.sessionId;
    if (!sessionId) return;
    const content = o.message?.content;
    if (!Array.isArray(content)) return;
    const ts = o.timestamp ?? new Date().toISOString();
    const isSubagent = o.isSidechain === true;

    content.forEach((b: any, i: number) => {
      if (!b || typeof b !== "object") return;
      if (b.type === "text" && typeof b.text === "string" && b.text.trim()) {
        this.storeStep(this.makeStep(o, sessionId, i, ts, "text", b.text, isSubagent), { cwd: o.cwd });
      } else if (b.type === "thinking" && typeof b.thinking === "string" && b.thinking.trim()) {
        this.storeStep(this.makeStep(o, sessionId, i, ts, "thinking", b.thinking, isSubagent), { cwd: o.cwd });
      } else if (b.type === "tool_use") {
        this.ingestToolUse(o, sessionId, i, ts, isSubagent, b.name, b.input, typeof b.id === "string" ? b.id : undefined);
      }
    });
  }

  private ingestToolUse(o: RawLine, sessionId: string, i: number, ts: string, isSubagent: boolean, name: string, input: any, toolUseId?: string) {
    const isEdit = name === "Edit" || name === "MultiEdit" || name === "Write";
    const id = `${o.uuid ?? ""}:${i}`;
    let filePath: string | undefined = typeof input?.file_path === "string" ? input.file_path : typeof input?.path === "string" ? input.path : undefined;

    if (isEdit) {
      let before = "";
      let after = "";
      if (name === "Edit") {
        before = typeof input?.old_string === "string" ? input.old_string : "";
        after = typeof input?.new_string === "string" ? input.new_string : "";
      } else if (name === "Write") {
        before = "";
        after = typeof input?.content === "string" ? input.content : "";
      } else if (name === "MultiEdit" && Array.isArray(input?.edits)) {
        before = input.edits.map((e: any) => (typeof e?.old_string === "string" ? e.old_string : "")).join("\n---\n");
        after = input.edits.map((e: any) => (typeof e?.new_string === "string" ? e.new_string : "")).join("\n---\n");
      }
      const step: Step = {
        id, sessionId, seq: this.allocSeq(sessionId), ts, kind: "edit",
        tool: name, input: sanitizeDeep(input) as unknown, filePath,
        diff: { before: sanitizeText(before, TEXT_LIMIT), after: sanitizeText(after, TEXT_LIMIT) },
        isSubagent, ...(isSubagent && (o as { agentId?: string }).agentId ? { agentId: (o as { agentId?: string }).agentId } : {}),
        ...(toolUseId ? { toolUseId } : {}),
      };
      this.storeStep(step, { cwd: o.cwd });
    } else {
      const step: Step = {
        id, sessionId, seq: this.allocSeq(sessionId), ts, kind: "tool_call",
        tool: name, input: sanitizeDeep(input) as unknown, filePath, isSubagent,
        ...(isSubagent && (o as { agentId?: string }).agentId ? { agentId: (o as { agentId?: string }).agentId } : {}),
        ...(toolUseId ? { toolUseId } : {}),
      };
      this.storeStep(step, { cwd: o.cwd });
    }
  }

  private makeStep(o: RawLine, sessionId: string, blockIndex: number, ts: string, kind: StepKind, text: string, isSubagent: boolean): Step {
    return {
      id: `${o.uuid ?? ""}:${blockIndex}`,
      sessionId, seq: this.allocSeq(sessionId), ts, kind,
      text: sanitizeText(text, kind === "tool_result" ? TOOL_RESULT_LIMIT : TEXT_LIMIT),
      isSubagent,
      ...(isSubagent && (o as { agentId?: string }).agentId ? { agentId: (o as { agentId?: string }).agentId } : {}),
    };
  }

  private allocSeq(sessionId: string): number {
    const n = this.nextSeq.get(sessionId) ?? 0;
    this.nextSeq.set(sessionId, n + 1);
    return n;
  }

  // ---- storage + broadcast ----

  private storeStep(step: Step, opts?: { cwd?: string; promptTitle?: string }) {
    this.dbs.db
      .prepare(
        `INSERT OR REPLACE INTO steps (id, session_id, seq, ts, kind, text, tool, input, file_path, diff, label, risk, is_subagent, tool_use_id)
         VALUES (@id, @session_id, @seq, @ts, @kind, @text, @tool, @input, @file_path, @diff, @label, @risk, @is_subagent, @tool_use_id)`,
      )
      .run({
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
      });

    this.upsertSession(step.sessionId, opts?.cwd ?? "", step.ts, opts?.promptTitle);

    if (this.ready && !this.quiet) {
      this.bus.emit("step", step);
      this.gateway.broadcast({ type: "step", step });
      if (step.kind === "edit" && step.filePath) {
        this.bus.emit("file-touched", { path: step.filePath, sessionId: step.sessionId, ts: step.ts });
      }
    }
  }

  private upsertSession(sessionId: string, cwd: string, ts: string, rawPrompt?: string) {
    const db = this.dbs.db;
    const promptTextForTitle = rawPrompt ? promptTitle(rawPrompt) : undefined;
    const row = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(sessionId) as SessionRow | undefined;
    if (!row) {
      const title = promptTextForTitle ? promptTextForTitle.slice(0, 80) : "(untitled session)";
      db.prepare(
        `INSERT INTO sessions (id, cwd, title, started_at, last_event_at, custom_title, title_set) VALUES (?, ?, ?, ?, ?, 0, ?)`,
      ).run(sessionId, cwd, title, ts, ts, promptTextForTitle ? 1 : 0);
      if (this.ready) this.broadcastSession(sessionId);
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
    db.prepare(`UPDATE sessions SET cwd = ?, title = ?, last_event_at = ?, title_set = ? WHERE id = ?`).run(newCwd, title, lastEventAt, titleSet, sessionId);
    if (titleOrCwdChanged && this.ready) this.broadcastSession(sessionId);
  }

  private setCustomTitle(sessionId: string, customTitle: string) {
    const db = this.dbs.db;
    const row = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(sessionId) as SessionRow | undefined;
    const now = new Date().toISOString();
    if (!row) {
      db.prepare(`INSERT INTO sessions (id, cwd, title, started_at, last_event_at, custom_title, title_set) VALUES (?, '', ?, ?, ?, 1, 1)`).run(
        sessionId, customTitle, now, now,
      );
    } else {
      db.prepare(`UPDATE sessions SET title = ?, custom_title = 1, title_set = 1 WHERE id = ?`).run(customTitle, sessionId);
    }
    if (this.ready) this.broadcastSession(sessionId);
  }

  private broadcastSession(sessionId: string) {
    const s = this.getSession(sessionId);
    if (s) {
      this.bus.emit("session", s);
      this.gateway.broadcast({ type: "session", session: s });
    }
  }

  // ---- reads (public API) ----

  private rowToSession(row: SessionRow): Session {
    const idle = Date.now() - Date.parse(row.last_event_at) > IDLE_AFTER_MS;
    return { id: row.id, cwd: row.cwd, title: row.title, startedAt: row.started_at, lastEventAt: row.last_event_at, status: idle ? "idle" : "running" };
  }

  getSession(id: string): Session | undefined {
    const row = this.dbs.db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as SessionRow | undefined;
    return row ? this.rowToSession(row) : undefined;
  }

  /** Only sessions whose cwd is the active workspace root or inside it (owner: S). */
  listSessions(): Session[] {
    const rows = this.dbs.db.prepare(`SELECT * FROM sessions ORDER BY last_event_at DESC`).all() as SessionRow[];
    // Titles stored before promptTitle() existed can still start with Claude Code's wrapper tags.
    const sessions = rows.map((r) => this.rowToSession(r.custom_title ? r : { ...r, title: promptTitle(r.title) ?? "(untitled session)" }));
    // A thread where no agent did anything but answer a slash command (opening this app, /compact) isn't work to show.
    const worked = new Set((this.dbs.db.prepare(`SELECT DISTINCT session_id FROM steps WHERE kind IN ('tool_call', 'edit')`).all() as { session_id: string }[]).map((r) => r.session_id));
    const idle = (s: Session) => !worked.has(s.id) && (s.title.startsWith("/") || s.title === "(untitled session)");
    // A thread you deleted (in Claude's desktop app) isn't one any more: its transcript is gone and the app left a
    // marker. One that Claude Code cleaned up on its own (after ~30 days) stays: Brainstorm keeps that history.
    const transcripts = new Map<string, string[]>();
    for (const file of this.offsets.keys()) {
      const parts = relative(this.cfg.claudeProjectsDir, file).split(sep);
      if (parts.length !== 2 || !file.endsWith(".jsonl")) continue; // <project>/<sessionId>.jsonl, not a subagent's
      const id = basename(file, ".jsonl");
      transcripts.set(id, [...(transcripts.get(id) ?? []), file]);
    }
    const deleted = deletedThreads();
    const gone = (s: Session) => { const files = transcripts.get(s.id); return deleted.has(s.id) && !!files && !files.some((f) => existsSync(f)); };
    const shown = sessions.filter((s) => !idle(s) && !gone(s));
    if (!this.activeRoot) return shown;
    return shown.filter((s) => this.isWithinRoot(s.cwd));
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
      ...(row.tool_use_id ? { toolUseId: row.tool_use_id } : {}),
    };
  }

  getStep(id: string): Step | undefined {
    const row = this.dbs.db.prepare(`SELECT * FROM steps WHERE id = ?`).get(id);
    return row ? this.rowToStep(row) : undefined;
  }

  listSteps(sessionId: string): Step[] {
    const rows = this.dbs.db.prepare(`SELECT * FROM steps WHERE session_id = ? ORDER BY seq ASC`).all(sessionId);
    return rows.map((r) => this.rowToStep(r));
  }

  /** The n steps immediately before `stepId` in the same session, chronological order. */
  stepsBefore(stepId: string, n: number): Step[] {
    const target = this.dbs.db.prepare(`SELECT session_id, seq FROM steps WHERE id = ?`).get(stepId) as { session_id: string; seq: number } | undefined;
    if (!target) return [];
    const rows = this.dbs.db
      .prepare(`SELECT * FROM steps WHERE session_id = ? AND seq < ? ORDER BY seq DESC LIMIT ?`)
      .all(target.session_id, target.seq, n);
    return rows.map((r) => this.rowToStep(r)).reverse();
  }

  updateStep(id: string, patch: { label?: string; risk?: string[] }) {
    const db = this.dbs.db;
    const row = db.prepare(`SELECT * FROM steps WHERE id = ?`).get(id) as any;
    if (!row) return;
    const label = patch.label !== undefined ? patch.label : row.label;
    const risk = patch.risk !== undefined ? JSON.stringify(patch.risk) : row.risk;
    db.prepare(`UPDATE steps SET label = ?, risk = ? WHERE id = ?`).run(label ?? null, risk ?? null, id);
    this.gateway.broadcast({ type: "step-update", id, label: patch.label, risk: patch.risk });
  }

  /** Most recent steps of kind edit/tool_call/prompt with no label yet — for the reader's (B) backfill. */
  unlabeledSteps(limit: number): Step[] {
    const rows = this.dbs.db
      .prepare(`SELECT * FROM steps WHERE kind IN ('edit','tool_call','prompt') AND label IS NULL ORDER BY ts DESC LIMIT ?`)
      .all(limit);
    return rows.map((r) => this.rowToStep(r));
  }
}

const PASTE = /<pasted_content\b[^>]*>([\s\S]*?)(<\/pasted_content>|$)/g;

/** Text pasted into a prompt arrives wrapped in `<pasted_content id="…">`. What the person typed around it makes the
 * better title ("help me draft it?"); with nothing typed around it, the pasted text itself. Same rule as the web's. */
export function withoutPastes(text: string): string {
  const typed = text.replace(PASTE, " ").trim();
  return typed || text.replace(PASTE, "$1");
}

/**
 * A readable thread title from the first prompt. Claude Code wraps slash commands and local output in tags
 * (<command-name>, <local-command-caveat>, <local-command-stdout>...): keep the command, drop the rest.
 * Undefined when nothing readable is left, so a later prompt can title the thread.
 */
export function promptTitle(text: string, max = 80): string | undefined {
  const command = /<command-name>([^<]*)/.exec(text)?.[1]?.trim();
  const args = /<command-args>([^<]*)<\/command-args>/.exec(text)?.[1]?.trim();
  if (command) return `${command}${args ? " " + args : ""}`.slice(0, max);
  const plain = withoutPastes(text)
    .replace(/<bash-input>([\s\S]*?)(<\/bash-input>|$)/g, "$ $1") // a command run with ! in Claude Code
    .replace(/<(bash-stdout|bash-stderr)>[\s\S]*?(<\/\1>|$)/g, "")
    .replace(/<(local-command-caveat|local-command-stdout|local-command-stderr|system-reminder|command-message|command-args)>[\s\S]*?(<\/\1>|$)/g, "")
    .replace(/<\/?[a-z_-]+(\s[^>]*)?>/g, "")
    .trim();
  return plain ? plain.slice(0, max) : undefined;
}
