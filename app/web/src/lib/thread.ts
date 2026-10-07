// Owner: thread-replay foundation. One session (thread) as a timeline of beats for the map replay.
//
// Light detail (default): your prompts, each edit, and runs of reads are beats; everything in between
// (messages, thinking, commands, browser, subagents, results) folds into one summary beat with counts.
// Full detail: every step is a beat. Either way the tracer only moves on edits (TRACER_MOVES_ON).
import { useEffect, useMemo } from "react";
import type { Step } from "@contract";
import { useLive } from "./live";
import { makeFileResolver, type FileResolver } from "./paths";
import { isOutside } from "./islands";
import type { ProjectMap } from "@contract";

const outsideOf = new WeakMap<FileResolver, FileResolver>();
/** The project's resolver, and an outside file as itself (one wrapper per resolver, so threads built with it are reused). */
function withOutside(r: FileResolver, map: ProjectMap | null): FileResolver {
  let w = outsideOf.get(r);
  if (!w) { w = (abs) => r(abs) ?? (isOutside(abs, map) ? abs : null); outsideOf.set(r, w); }
  return w;
}
import { displayLabel, isVisible, realLabel } from "../follow/format";

export type BeatAction = "edit" | "read" | "other";
export type ReplayDetail = "light" | "full";

/** Which actions move the tracer. Edits only: reads flash their file without moving it. */
export const TRACER_MOVES_ON: ReadonlySet<BeatAction> = new Set<BeatAction>(["edit"]);

const READ_TOOLS = new Set(["Read", "NotebookRead"]);
const SEARCH_TOOLS = new Set(["Grep", "Glob", "WebSearch", "WebFetch", "ToolSearch"]);
const SUBAGENT_TOOLS = new Set(["Agent", "Task"]);

/** Same rules as the server's Failures view (app/server/src/failures/failures.service.ts). */
const ERROR_PATTERNS: RegExp[] = [
  /^\s*<tool_use_error>/i, /^\s*error\b/i, /^\s*exit code [1-9]\d*/i,
  /file has not been read yet/i, /string to replace not found/i,
  /permission (denied|to use)|was blocked|denied by|not allowed/i,
];
export function isFailedResult(s: Step): boolean {
  if (s.kind !== "tool_result") return false;
  if ((s.input as { isError?: boolean } | undefined)?.isError) return true;
  const head = (s.text ?? "").slice(0, 300);
  return ERROR_PATTERNS.some((re) => re.test(head));
}

export type SummaryCounts = {
  commands: number; browser: number; subagents: number; searches: number;
  messages: number; thinking: number; tools: number; failed: number;
};

export type BeatKind = "prompt" | "edit" | "reads" | "summary" | "step";

export type Beat = {
  index: number;          // position in the replay, the cursor
  kind: BeatKind;         // "step" = one raw step (full detail)
  step: Step;             // representative step (the first one for groups)
  steps: Step[];          // every step this beat covers, in order (tool results included)
  action: BeatAction;     // edit moves the tracer, read flashes, other holds
  file: string | null;    // map node for an edit, or the last file of a read group
  files: string[];        // map nodes read (read group) or edited (edit)
  outside: boolean;       // touches only files that are not on the map
  moveIndex: number;      // tracer position at this beat: index into Thread.moves, -1 before the first move
  failed: number;         // failed tool calls folded into this beat
  headline?: string;      // summary beats: what happened, in the agent's words (its latest message)
  why?: string;           // edit beats: the agent's note just before the edit (a talk-only summary folded in)
  counts?: SummaryCounts; // summary beats
};

export type Move = { beatIndex: number; file: string; ts: string };

export type Thread = {
  sessionId: string;
  detail: ReplayDetail;
  beats: Beat[];
  moves: Move[];          // tracer path: one entry each time the tracer changes file
  files: string[];        // map files the thread touches (any action), in first-touch order
  touched: Map<string, { edits: number; reads: number }>;
  stepBeat: Map<string, number>; // step id → beat index (every step, results included)
  stepCount: number;      // steps as Follow lists them (tool results and empty thinking left out), so both views agree
  editCount: number;
};

export function actionOf(s: Step): BeatAction {
  if (s.kind === "edit") return "edit";
  if (s.kind === "tool_call" && s.tool && READ_TOOLS.has(s.tool) && s.filePath) return "read";
  return "other";
}

const isBrowser = (tool = "") => /browser|chrome|playwright|puppeteer/i.test(tool);
const emptyCounts = (): SummaryCounts => ({ commands: 0, browser: 0, subagents: 0, searches: 0, messages: 0, thinking: 0, tools: 0, failed: 0 });

function count(c: SummaryCounts, s: Step) {
  if (s.kind === "text") { if (s.text?.trim()) c.messages++; return; }
  if (s.kind === "thinking") { if (s.text?.trim()) c.thinking++; return; }
  if (s.kind === "prompt") return; // subagent briefs: counted through their Agent call
  if (s.kind !== "tool_call") return;
  const t = s.tool ?? "";
  if (t === "Bash") c.commands++;
  else if (isBrowser(t)) c.browser++;
  else if (SUBAGENT_TOOLS.has(t)) c.subagents++;
  else if (SEARCH_TOOLS.has(t)) c.searches++;
  else c.tools++;
}

const isTalkOnly = (b: { counts?: SummaryCounts }) => {
  const c = b.counts!;
  return c.commands + c.browser + c.subagents + c.searches + c.tools + c.failed === 0 && c.messages > 0;
};

/** The agent's own words, cut at a sentence end once they say something (at least ~40 chars), at most `max`. */
function firstSentence(t: string, max = 110, min = 40): string {
  const parts = t.split(/(?<=[.!?])\s+/); // a sentence ends at . ! ? followed by a space, not inside "a.ts"
  let out = "";
  for (const p of parts) { if (out.length >= min) break; out = out ? `${out} ${p}` : p; }
  out = out.trim();
  return out.length > max ? `${out.slice(0, max - 1).trimEnd()}…` : out;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Chips for a summary beat, most telling first. Failures are shown separately (red). */
export function countParts(c: SummaryCounts): string[] {
  const out: string[] = [];
  if (c.commands) out.push(plural(c.commands, "command"));
  if (c.browser) out.push(plural(c.browser, "browser action"));
  if (c.subagents) out.push(plural(c.subagents, "subagent"));
  if (c.searches) out.push(plural(c.searches, "search", "searches"));
  if (c.tools) out.push(plural(c.tools, "tool call"));
  if (c.messages) out.push(plural(c.messages, "message"));
  return out;
}

function headlineOf(steps: Step[], c: SummaryCounts): string {
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i];
    if (s.kind !== "text" || !(s.text?.trim() || s.label)) continue;
    const words = realLabel(s) ?? firstSentence(displayLabel(s));
    if (words.length >= 12 || !(c.commands || c.browser || c.subagents || c.searches || c.tools)) return words;
    break; // "Done." says less than the counts do
  }
  if (c.commands) return `Ran ${plural(c.commands, "command")}`;
  if (c.browser) return `Worked in the browser`;
  if (c.subagents) return `Delegated to ${plural(c.subagents, "subagent")}`;
  if (c.searches) return `Searched the codebase`;
  if (c.thinking) return "Thought it through";
  return "Worked";
}

/** Short, human label for a beat (bar, list, aria). */
export function beatLabel(b: Beat): string {
  switch (b.kind) {
    case "summary": return b.headline ?? "Worked";
    case "reads": return b.steps.filter((s) => actionOf(s) === "read").length > 1 ? `Read ${plural(readCount(b), "file")}` : displayLabel(b.step);
    default: return displayLabel(b.step);
  }
}
const readCount = (b: Beat) => new Set(b.steps.filter((s) => actionOf(s) === "read").map((s) => s.filePath)).size;

/**
 * A beat while the thread is being built. Callers get a Beat made from it, and the same Beat again while it hasn't
 * changed, so a long thread that grows by one step doesn't rebuild (or re-render) all of its beats.
 */
type Draft = {
  at: number;             // position among the drafts (absorbed ones included)
  kind: BeatKind; step: Step; steps: Step[]; action: BeatAction; file: string | null; files: string[]; outside: boolean;
  moveIndex: number; failed: number; why?: string; counts?: SummaryCounts;
  talk?: Draft;           // edit: the talk-only summary folded into it (its `why`)
  absorbed: boolean;      // folded into the next edit: left out, later beats move up
  version: number;        // bumped on every change
  out?: Beat; outVersion: number;
};
type DraftMove = { beat: number; file: string; ts: string; out?: Move };

const failedSeen = new WeakMap<Step, boolean>();
const failedOf = (s: Step) => {
  let f = failedSeen.get(s);
  if (f === undefined) failedSeen.set(s, (f = isFailedResult(s)));
  return f;
};

/** True when two versions of a step differ only by what the reader fills in later (label, risk). */
export function onlyRelabelled(a: Step, b: Step): boolean {
  const x = a as Record<string, unknown>, y = b as Record<string, unknown>;
  for (const k in x) if (k !== "label" && k !== "risk" && x[k] !== y[k]) return false;
  for (const k in y) if (k !== "label" && k !== "risk" && x[k] !== y[k]) return false;
  return true;
}

/**
 * Builds a thread step by step and can carry on when more steps arrive (a live thread), or when the reader relabels a
 * step: the same rules as a fresh build, in one pass, so the result is the same as building the whole list again.
 */
class ThreadBuilder {
  steps: Step[] = [];                 // the list fed so far
  last: Thread | null = null;         // the thread made from it
  private drafts: Draft[] = [];
  private moves: DraftMove[] = [];
  private files: string[] = [];
  private touched = new Map<string, { edits: number; reads: number }>();
  private stepBeat = new Map<string, number>(); // step id → draft position
  private editCount = 0;
  private stepCount = 0;
  private absorbed = 0;
  private callBeat = new Map<string, Draft>(); // tool_use id → the draft holding the call
  // The main agent and its subagents write to the same log, interleaved. Group per stream (who is acting)
  // so a subagent's work doesn't split the main thread's summaries, and a note folds into its own edit.
  private open = new Map<string, Draft>();     // per stream: the read run or summary new steps can join
  private lastOf = new Map<string, Draft>();   // per stream: its latest draft (tool results fold into it)

  constructor(readonly resolve: FileResolver, readonly detail: ReplayDetail) {}

  /**
   * Take a new version of the list. Returns false when it can't follow on from what was fed (a step was removed,
   * reordered or changed in a way that matters), and the caller starts a new builder.
   */
  update(next: Step[]): boolean {
    const prev = this.steps;
    if (next === prev) return true;
    if (next.length < prev.length) return false;
    let changed: number[] | null = null;
    for (let i = 0; i < prev.length; i++) {
      if (next[i] === prev[i]) continue;
      if (!onlyRelabelled(prev[i], next[i])) return false;
      (changed ??= []).push(i);
    }
    if (changed) for (const i of changed) if (!this.relabel(prev[i], next[i])) return false;
    for (let i = prev.length; i < next.length; i++) this.feed(next[i]);
    this.steps = next;
    if (changed || next.length > prev.length) this.last = null;
    return true;
  }

  /** Put the relabelled step where the old one was. False if it isn't where expected (then build afresh). */
  private relabel(old: Step, s: Step): boolean {
    const swap = (d: Draft | undefined) => {
      const i = d ? d.steps.indexOf(old) : -1;
      if (!d || i === -1 || d.steps.indexOf(old, i + 1) !== -1) return false;
      d.steps[i] = s;
      if (d.step === old) d.step = s;
      d.version++;
      return true;
    };
    const at = this.stepBeat.get(s.id);
    const d = at === undefined ? undefined : this.drafts[at];
    if (!swap(d)) return false;
    if (d!.talk?.steps.includes(old)) { if (!swap(d!.talk)) return false; d!.why = headlineOf(d!.talk.steps, d!.talk.counts!); }
    if (isVisible(old) !== isVisible(s)) this.stepCount += isVisible(s) ? 1 : -1;
    return true;
  }

  private touch(file: string, action: BeatAction) {
    const t = this.touched.get(file) ?? { edits: 0, reads: 0 };
    if (action === "edit") t.edits++; else t.reads++;
    if (!this.touched.has(file)) this.files.push(file);
    this.touched.set(file, t);
  }
  private moveTo(file: string, beat: number, ts: string) {
    if (this.moves[this.moves.length - 1]?.file !== file) this.moves.push({ beat, file, ts });
  }
  private newBeat(kind: BeatKind, step: Step, action: BeatAction): Draft {
    const d: Draft = { at: this.drafts.length, kind, step, steps: [], action, file: null, files: [], outside: false, moveIndex: this.moves.length - 1, failed: 0, absorbed: false, version: 0, outVersion: -1 };
    this.drafts.push(d);
    return d;
  }
  private add(d: Draft, s: Step) {
    d.steps.push(s);
    d.version++;
    if (s.toolUseId && s.kind !== "tool_result") this.callBeat.set(s.toolUseId, d);
    this.stepBeat.set(s.id, d.at);
    if (failedOf(s)) { d.failed++; if (d.counts) d.counts.failed++; }
  }
  /** A file-touching step: the resolved map node, if any, joins the beat. */
  private fileStep(d: Draft, s: Step, action: BeatAction) {
    const file = s.filePath ? this.resolve(s.filePath) : null;
    if (file) {
      this.touch(file, action);
      if (!d.files.includes(file)) d.files.push(file);
      d.file = file;
      if (TRACER_MOVES_ON.has(action)) { this.moveTo(file, d.at, s.ts); d.moveIndex = this.moves.length - 1; }
    }
    d.outside = d.files.length === 0 && !!s.filePath;
    d.version++;
  }

  private feed(s: Step) {
    const action = actionOf(s);
    if (action === "edit") this.editCount++;
    if (isVisible(s)) this.stepCount++;

    if (this.detail === "full") {
      const d = this.newBeat("step", s, action);
      this.add(d, s);
      if (action !== "other") this.fileStep(d, s, action);
      return;
    }

    const k = s.agentId ?? (s.isSubagent ? "sub" : "main");
    if (s.kind === "tool_result") {
      const d = (s.toolUseId ? this.callBeat.get(s.toolUseId) : undefined) ?? this.lastOf.get(k) ?? this.drafts[this.drafts.length - 1];
      if (d) { this.add(d, s); return; } // results fold into what they answer
    }
    if (s.kind === "prompt" && !s.isSubagent) {
      this.open.delete(k);
      const d = this.newBeat("prompt", s, "other"); this.add(d, s); this.lastOf.set(k, d);
      return;
    }
    if (action === "edit") {
      const o = this.open.get(k);
      const talk = o?.kind === "summary" && isTalkOnly(o) ? o : null;
      this.open.delete(k);
      const d = this.newBeat("edit", s, "edit");
      if (talk) {
        talk.absorbed = true; this.absorbed++;
        d.talk = talk; d.why = headlineOf(talk.steps, talk.counts!);
        for (const t of talk.steps) this.add(d, t);
      }
      this.add(d, s); this.fileStep(d, s, "edit"); this.lastOf.set(k, d);
      return;
    }
    if (action === "read") {
      let o = this.open.get(k);
      if (o?.kind !== "reads") { o = this.newBeat("reads", s, "read"); this.open.set(k, o); }
      this.add(o, s); this.fileStep(o, s, "read"); this.lastOf.set(k, o);
      return;
    }
    let o = this.open.get(k);
    if (o?.kind !== "summary") { o = this.newBeat("summary", s, "other"); o.counts = emptyCounts(); this.open.set(k, o); }
    this.add(o, s); count(o.counts!, s); this.lastOf.set(k, o);
  }

  /** The thread as callers see it: absorbed summaries left out and the rest renumbered; unchanged beats reused. */
  thread(sessionId: string): Thread {
    if (this.last) return this.last;
    const beats: Beat[] = [];
    const final = new Array<number>(this.drafts.length); // draft position → beat index, -1 when absorbed
    for (const d of this.drafts) {
      if (d.absorbed) { final[d.at] = -1; continue; }
      const index = beats.length;
      final[d.at] = index;
      let b = d.out;
      if (!b || d.outVersion !== d.version || b.index !== index) { b = beatOf(d, index); d.out = b; d.outVersion = d.version; }
      beats.push(b);
    }
    let stepBeat: Map<string, number>;
    if (this.absorbed) {
      stepBeat = new Map();
      for (const [id, at] of this.stepBeat) stepBeat.set(id, final[at] >= 0 ? final[at] : 0);
    } else stepBeat = new Map(this.stepBeat);
    const moves = this.moves.map((m) => {
      const beatIndex = final[m.beat] >= 0 ? final[m.beat] : m.beat;
      if (m.out?.beatIndex !== beatIndex) m.out = { beatIndex, file: m.file, ts: m.ts };
      return m.out;
    });
    const touched = new Map<string, { edits: number; reads: number }>();
    for (const [f, t] of this.touched) touched.set(f, { edits: t.edits, reads: t.reads });
    this.last = { sessionId, detail: this.detail, beats, moves, files: this.files.slice(), touched, stepBeat, stepCount: this.stepCount, editCount: this.editCount };
    return this.last;
  }
}

function beatOf(d: Draft, index: number): Beat {
  const b: Beat = { index, kind: d.kind, step: d.step, steps: d.steps.slice(), action: d.action, file: d.file, files: d.files.slice(), outside: d.outside, moveIndex: d.moveIndex, failed: d.failed };
  if (d.counts) b.counts = { ...d.counts };
  if (d.why !== undefined) b.why = d.why;
  if (d.kind === "summary") b.headline = headlineOf(b.steps, b.counts!);
  return b;
}

// Every view of a thread (the map layer, the Track, the bar, the step panel...) asks for it: they share one build.
// Per steps list (the store makes a new one for each change), the thread per detail and session, for the latest
// resolver. A builder per detail and session carries on from the previous list when the new one only adds steps.
const built = new WeakMap<Step[], Map<string, { resolve: FileResolver; thread: Thread }>>();
const builders = new Map<string, ThreadBuilder>(); // most recently used last
const MAX_BUILDERS = 8;

export function buildThread(sessionId: string, steps: Step[], resolve: FileResolver, detail: ReplayDetail = "light"): Thread {
  const key = `${detail}\n${sessionId}`;
  let forSteps = built.get(steps);
  const hit = forSteps?.get(key);
  if (hit && hit.resolve === resolve) return hit.thread;

  let b = builders.get(key);
  builders.delete(key);
  if (!b || b.resolve !== resolve || !b.update(steps)) { b = new ThreadBuilder(resolve, detail); b.update(steps); }
  builders.set(key, b);
  if (builders.size > MAX_BUILDERS) builders.delete(builders.keys().next().value!);

  const thread = b.thread(sessionId);
  if (!forSteps) built.set(steps, (forSteps = new Map()));
  forSteps.set(key, { resolve, thread });
  return thread;
}

/** The live store's map version for its file list, when it has one (see makeFileResolver). */
const structureVersion = (state: object) => (state as { structureVersion?: number }).structureVersion;

/** The thread for a session, built against the current map. Loads the session's steps if needed (live app). */
export function useThread(sessionId: string | null, detail: ReplayDetail = "light"): Thread | null {
  const { state, loadSteps } = useLive();
  const steps = sessionId ? state.steps[sessionId] : undefined;
  useEffect(() => { if (sessionId && !steps) loadSteps(sessionId); }, [sessionId, steps, loadSteps]);
  // No session: no resolver (it would index every file of the map for nothing).
  const map = sessionId ? state.map : null;
  const version = structureVersion(state);
  // A file outside the project resolves to itself: the map shows it on an island (lib/islands.ts, graph.ts).
  const resolve = useMemo(() => withOutside(makeFileResolver(map, version), map), [map, version]);
  return useMemo(() => (sessionId && steps ? buildThread(sessionId, steps, resolve, detail) : null), [sessionId, steps, resolve, detail]);
}
