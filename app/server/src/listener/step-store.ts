import { Inject, Injectable } from "@nestjs/common";
import { realpathSync } from "node:fs";
import type { Harness, Session, Step } from "../shared/contract";
import { DbService } from "../core/db.service";
import { EventsGateway, type Broadcaster } from "../core/events.gateway";
import { repoBase } from "./moved";
import { ProjectScope } from "./scope";
import type { NewStep } from "./source";
import { promptTitle, storedTitle, titleOfPrompt, UNTITLED } from "./text";
import { commandReads } from "./command-writes";

// The stored threads and steps. StepsStore is what the other modules read (threads, steps, labels); StepWriter is how
// the listener stores what the sources parse, a chunk (a Batch) per transaction.

const IDLE_AFTER_MS = 2 * 60 * 1000;
/** `worked`: an agent called a tool or edited a file in the thread (one that only answered a slash command didn't). */
export type SessionRow = { id: string; cwd: string; title: string; started_at: string; last_event_at: string; custom_title: number; title_set: number; worked: number; harness: string };
type BatchSession = SessionRow & { isNew: boolean; dirty: boolean };

/** One chunk of lines being stored: passed down the parse, so reads of several files can interleave. */
export type Batch = {
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

export function newBatch(quiet: boolean): Batch {
  return { quiet, sessions: new Map(), events: [], announced: new Set(), seqBefore: new Map(), keptUsed: [], quietSessions: new Set() };
}

function prepare(db: DbService["db"]) {
  // A shell command's reads, worked out from its text when steps are read (any thread, old ones too): see readsJson.
  db.function("step_reads", { deterministic: true }, (tool, input, cwd) => readsJson(tool as string | null, input as string | null, cwd as string | null));
  return {
    insertStep: db.prepare(
      `INSERT OR IGNORE INTO steps (id, session_id, seq, ts, kind, text, tool, input, file_path, diff, label, risk, is_subagent, tool_use_id, agent_id, is_error)
       VALUES (@id, @session_id, @seq, @ts, @kind, @text, @tool, @input, @file_path, @diff, @label, @risk, @is_subagent, @tool_use_id, @agent_id, @is_error)`,
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
    stepsJsonSlim: db.prepare(stepsJsonSql(`session_id = ?`, true)),
    stepsJsonSlimAfter: db.prepare(stepsJsonSql(`session_id = ? AND seq > ?`, true)),
    stepInput: db.prepare(`SELECT input FROM steps WHERE id = ?`),
    stepTouches: db.prepare(`SELECT 1 FROM steps WHERE file_path = ? LIMIT 1`),
    stepPos: db.prepare(`SELECT session_id, seq FROM steps WHERE id = ?`),
    stepsBefore: db.prepare(`SELECT * FROM steps WHERE session_id = ? AND seq < ? ORDER BY seq DESC LIMIT ?`),
    stepLabel: db.prepare(`SELECT label, risk FROM steps WHERE id = ?`),
    updateLabel: db.prepare(`UPDATE steps SET label = ?, risk = ? WHERE id = ?`),
    unlabeled: db.prepare(`SELECT * FROM steps WHERE kind IN ('edit','tool_call','prompt') AND label IS NULL ORDER BY ts DESC LIMIT ?`),
  };
}

/** The threads and steps as stored: what every module other than the listener reads. */
@Injectable()
export class StepsStore {
  readonly st: ReturnType<typeof prepare>;
  /** listSessions' rows: filtered, titles cleaned, newest first. Dropped when a session row is written or the
   * workspace changes; status and deleted threads are worked out on each call. */
  private sessionsCache: SessionRow[] | null = null;
  /** Threads to leave out although stored (the listener's sources: Claude's deleted in its desktop app). */
  private hiddenFilters: () => Iterable<((sessionId: string) => boolean) | undefined> = () => [];

  constructor(dbs: DbService, private project: ProjectScope, @Inject(EventsGateway) private gateway: Broadcaster) {
    this.st = prepare(dbs.db);
  }

  /** A session row was written or the project changed: the list is worked out again. */
  invalidate() { this.sessionsCache = null; }

  /** How the listener says which threads to leave out (asked on each listSessions). */
  hideWith(filters: () => Iterable<((sessionId: string) => boolean) | undefined>) { this.hiddenFilters = filters; }

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
    for (const hidden of this.hiddenFilters()) {
      if (hidden) rows = rows.filter((r) => !hidden(r.id));
    }
    return rows.map((r) => this.rowToSession(r));
  }

  private shownSessionRows(): SessionRow[] {
    const rows = this.st.allSessions.all() as SessionRow[];
    // Titles stored before promptTitle() existed can still start with Claude Code's wrapper tags.
    const cleaned = rows.map((r) => (r.custom_title ? r : { ...r, title: promptTitle(r.title) ?? UNTITLED }));
    // A thread where no agent did anything but answer a slash command (opening this app, /compact) isn't work to show,
    // nor one with only a name so far (a custom-title line, no step yet).
    const idle = (r: SessionRow) => !r.last_event_at || (!r.worked && (r.title.startsWith("/") || r.title === UNTITLED));
    const shown = cleaned.filter((r) => !idle(r));
    if (!this.project.activeRoot) return shown;
    return shown.filter((r) => this.project.isWithinRoot(r.cwd) || this.project.visitors.has(r.id));
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
      ...(row.is_error ? { isError: true } : {}),
      ...readsOf(row.tool, row.input, this.cwdOf(row.session_id)),
    };
  }

  /** A thread's folder, for its commands' relative paths (cached: rowToStep runs for every step of a long thread). */
  private cwds = new Map<string, string>();
  cwdOf(sessionId: string): string {
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
  listStepsJson(sessionId: string, afterSeq?: number, opts: { slim?: boolean } = {}): string {
    const st = this.st;
    const [all, after] = opts.slim ? [st.stepsJsonSlim, st.stepsJsonSlimAfter] : [st.stepsJson, st.stepsJsonAfter];
    const row = (afterSeq === undefined ? all.get(sessionId) : after.get(sessionId, afterSeq)) as { out: string };
    return row.out;
  }

  /** A step's whole input as `{"input":…}` JSON (`{}` when it has none), or undefined for an unknown step: what an
   * edit sent with `inputTrimmed` left out (GET /api/steps/:id/input). */
  stepInputJson(id: string): string | undefined {
    const row = this.st.stepInput.get(id) as { input: string | null } | undefined;
    if (!row) return undefined;
    return row.input ? `{"input":${row.input}}` : "{}";
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

/** How the listener stores parsed steps: numbered per thread (seq), thread rows written once per chunk. */
export class StepWriter {
  /** Each thread's next seq. */
  readonly nextSeq = new Map<string, number>();
  /** Steps of a thread being read again from the start, by id: each comes back with the seq it had. */
  readonly kept = new Map<string, Map<string, number>>();

  constructor(private db: DbService["db"], private store: StepsStore, private project: ProjectScope) {
    for (const row of db.prepare(`SELECT session_id, MAX(seq) as m FROM steps GROUP BY session_id`).all() as { session_id: string; m: number }[]) {
      this.nextSeq.set(row.session_id, row.m + 1);
    }
  }

  private get st() { return this.store.st; }

  /** A chunk that didn't commit: the seqs it took are put back. */
  rollback(b: Batch) {
    for (const [id, n] of b.seqBefore) if (n === undefined) this.nextSeq.delete(id); else this.nextSeq.set(id, n);
    for (const [sid, id, seq] of b.keptUsed) { const m = this.kept.get(sid) ?? new Map<string, number>(); m.set(id, seq); this.kept.set(sid, m); }
  }

  /** The thread's steps keep their seq when they come back (it is being read again from the start). */
  keepSeqs(thread: string) {
    const keep = this.kept.get(thread) ?? new Map<string, number>();
    for (const r of this.db.prepare(`SELECT id, seq FROM steps WHERE session_id = ?`).all(thread) as { id: string; seq: number }[]) keep.set(r.id, r.seq);
    this.kept.set(thread, keep);
  }

  /** The id a parsed step is stored under in its thread, or undefined if the thread has it already. Claude Code copies
   * earlier lines, uuid and all, into a resumed or forked thread's log, and repeats some lines within a log: a line the
   * thread has keeps its first place, and a copy of another thread's line gets an id of its own (`<id>@<thread>`), so
   * it never takes that thread's step. Ids stored before stay as they were (links, screenshots and answers use them). */
  ownId(s: NewStep): string | undefined {
    const at = this.st.stepThread.get(s.id) as { session_id: string } | undefined;
    if (!at) return s.id;
    if (at.session_id === s.sessionId) return undefined;
    const own = `${s.id}@${s.sessionId}`;
    return this.st.stepThread.get(own) ? undefined : own;
  }

  /** The seq a step had before its thread was read again from the start (resetThread), if it had one. */
  keptSeq(b: Batch, s: NewStep): number | undefined {
    const kept = this.kept.get(s.sessionId);
    const seq = kept?.get(s.id);
    if (seq === undefined) return undefined;
    kept!.delete(s.id);
    if (!kept!.size) this.kept.delete(s.sessionId);
    b.keptUsed.push([s.sessionId, s.id, seq]);
    return seq;
  }

  allocSeq(b: Batch, sessionId: string): number {
    const cur = this.nextSeq.get(sessionId);
    if (!b.seqBefore.has(sessionId)) b.seqBefore.set(sessionId, cur);
    const n = cur ?? 0;
    this.nextSeq.set(sessionId, n + 1);
    return n;
  }

  storeStep(b: Batch, step: Step, harness: Harness, opts?: { cwd?: string; promptTitle?: string }) {
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
      is_error: step.isError ? 1 : 0,
    });
    this.upsertSession(b, step.sessionId, harness, opts?.cwd ?? "", step.ts, opts?.promptTitle, step.kind === "tool_call" || step.kind === "edit");
    // A thread working elsewhere that touches this project's files: from now on it's a visitor here.
    const p = this.project;
    if (step.filePath && p.activeRoot && !p.visitors.has(step.sessionId) && p.isWithinRoot(step.filePath)) {
      const cwd = opts?.cwd || this.batchSession(b, step.sessionId)?.cwd || "";
      if (cwd && !p.isWithinRoot(cwd)) { p.visitors.add(step.sessionId); this.store.invalidate(); }
    }
    if (b.quiet) b.quietSessions.add(step.sessionId);
    else {
      if (step.kind === "tool_call" && step.tool === "Bash" && !step.reads) {
        const r = readsOf(step.tool, step.input, opts?.cwd || this.batchSession(b, step.sessionId)?.cwd || this.store.cwdOf(step.sessionId));
        if (r.reads) step.reads = r.reads;
      }
      b.events.push({ step });
    }
  }

  /** The chunk's copy of a session row (read once per chunk), or undefined if there is none yet. */
  batchSession(b: Batch, sessionId: string): BatchSession | undefined {
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
    if (!row.started_at || Date.parse(ts) < Date.parse(row.started_at)) Object.assign(row, { started_at: ts, dirty: true });
    const newCwd = cwd || row.cwd;
    const titleOrCwdChanged = title !== row.title || newCwd !== row.cwd;
    if (titleOrCwdChanged || lastEventAt !== row.last_event_at || titleSet !== row.title_set) {
      Object.assign(row, { cwd: newCwd, title, last_event_at: lastEventAt, title_set: titleSet, dirty: true });
    }
    if (worked && !row.worked) Object.assign(row, { worked: 1, dirty: true });
    if (titleOrCwdChanged) this.announceSession(b, sessionId);
  }

  setCustomTitle(b: Batch, sessionId: string, customTitle: string, harness: Harness) {
    const row = this.batchSession(b, sessionId);
    const title = storedTitle(customTitle, Infinity);
    if (!row) {
      // Claude Code writes a custom-title line without a time, and naming a thread isn't activity: no times until its
      // first step (until then the thread isn't listed), so a rename read in a history backfill doesn't make it "now".
      b.sessions.set(sessionId, {
        id: sessionId, cwd: "", title, started_at: "", last_event_at: "", custom_title: 1, title_set: 1, worked: 0,
        harness, isNew: true, dirty: true,
      });
    } else {
      Object.assign(row, { title, custom_title: 1, title_set: 1, dirty: true });
    }
    this.announceSession(b, sessionId);
  }

  /** Write the chunk's session rows, each once. */
  flushSessions(b: Batch) {
    for (const r of b.sessions.values()) {
      if (!r.dirty) continue;
      if (r.isNew) this.st.insertSession.run(r.id, r.cwd, r.title, r.started_at, r.last_event_at, r.custom_title, r.title_set, r.worked, r.harness);
      else this.st.updateSession.run(r.cwd, r.title, r.started_at, r.last_event_at, r.title_set, r.custom_title, r.worked, r.id);
      this.store.invalidate();
    }
  }
}

/** A step with its keys in the order rowToStep gives them: the object sent live serializes like the stored one. */
export function inStoredOrder(s: NewStep, seq: number): Step {
  const out: Record<string, unknown> = { id: s.id, sessionId: s.sessionId, seq, ts: s.ts, kind: s.kind };
  for (const k of ["text", "tool", "input", "filePath", "diff", "label", "risk"] as const) if (s[k] !== undefined) out[k] = s[k];
  out.isSubagent = !!s.isSubagent;
  if (s.agentId) out.agentId = s.agentId;
  if (s.toolUseId) out.toolUseId = s.toolUseId;
  if (s.isError) out.isError = true;
  return out as Step;
}

/** A text column as JSON, as JSON.stringify gives it for the value node:sqlite reads (which stops at a NUL char). */
const jq = (c: string) => `CASE WHEN instr(${c}, char(0)) > 0 THEN json_quote(substr(${c}, 1, instr(${c}, char(0)) - 1)) ELSE json_quote(${c}) END`;
/** A steps row as the JSON of rowToStep(row), built by SQLite: same keys, same order, same escapes; input, diff and
 * risk are stored as JSON already and go in as they are. */
const STEP_JSON = `'{"id":' || ${jq("id")} || ',"sessionId":' || ${jq("session_id")} || ',"seq":' || seq || ',"ts":' || ${jq("ts")} || ',"kind":' || ${jq("kind")}
  || CASE WHEN text IS NOT NULL THEN ',"text":' || ${jq("text")} ELSE '' END
  || CASE WHEN tool IS NOT NULL THEN ',"tool":' || ${jq("tool")} ELSE '' END
  || CASE WHEN input IS NOT NULL AND input != '' THEN ',"input":' || INPUT_SLOT ELSE '' END
  || CASE WHEN file_path IS NOT NULL THEN ',"filePath":' || ${jq("file_path")} ELSE '' END
  || CASE WHEN diff IS NOT NULL AND diff != '' THEN ',"diff":' || diff ELSE '' END
  || CASE WHEN label IS NOT NULL THEN ',"label":' || ${jq("label")} ELSE '' END
  || CASE WHEN risk IS NOT NULL AND risk != '' THEN ',"risk":' || risk ELSE '' END
  || ',"isSubagent":' || CASE WHEN is_subagent THEN 'true' ELSE 'false' END
  || CASE WHEN agent_id IS NOT NULL AND agent_id != '' THEN ',"agentId":' || ${jq("agent_id")} ELSE '' END
  || CASE WHEN tool_use_id IS NOT NULL AND tool_use_id != '' THEN ',"toolUseId":' || ${jq("tool_use_id")} ELSE '' END
  || CASE WHEN is_error THEN ',"isError":true' ELSE '' END
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
/** The input keys an edit's diff repeats (claude.source.ts toolStep): a third of an edit-heavy thread's bytes. */
export const TRIMMED_KEYS = ["old_string", "new_string", "content", "edits"] as const;
const trims = `kind = 'edit' AND diff IS NOT NULL AND diff != '' AND json_valid(input) AND json_type(input) = 'object'
  AND (${TRIMMED_KEYS.map((k) => `json_type(input, '$.${k}') IS NOT NULL`).join(" OR ")})`;
const SLIM_INPUT = `CASE WHEN ${trims} THEN json_remove(input, ${TRIMMED_KEYS.map((k) => `'$.${k}'`).join(", ")}) || ',"inputTrimmed":true' ELSE input END`;
/** `slim`: edits leave out what their diff repeats (slimStep), for the page's steps list. */
const stepsJsonSql = (where: string, slim = false) =>
  `SELECT '[' || coalesce(group_concat(j, ','), '') || ']' AS out FROM (SELECT ${STEP_JSON.replace("INPUT_SLOT", slim ? SLIM_INPUT : "input")} AS j FROM steps WHERE ${where} ORDER BY seq ASC)`;

/** A step as the slim steps list sends it (what listStepsJson(…, { slim: true }) gives, parsed). */
export function slimStep(s: Step): Step {
  const i = s.input;
  if (s.kind !== "edit" || !s.diff || !i || typeof i !== "object" || Array.isArray(i)) return s;
  const rec = i as Record<string, unknown>;
  if (!TRIMMED_KEYS.some((k) => k in rec)) return s;
  const input = Object.fromEntries(Object.entries(rec).filter(([k]) => !(TRIMMED_KEYS as readonly string[]).includes(k)));
  return { ...s, input, inputTrimmed: true };
}
