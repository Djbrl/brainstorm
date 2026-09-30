// Owner: thread-replay foundation. One session (thread) as a timeline of beats for the map replay.
//
// Light detail (default): your prompts, each edit, and runs of reads are beats; everything in between
// (messages, thinking, commands, browser, subagents, results) folds into one summary beat with counts.
// Full detail: every step is a beat. Either way the tracer only moves on edits (TRACER_MOVES_ON).
import { useEffect, useMemo } from "react";
import type { Step } from "@contract";
import { useLive } from "./live";
import { makeFileResolver, type FileResolver } from "./paths";
import { displayLabel, realLabel } from "../follow/format";

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
  stepCount: number;
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

const isTalkOnly = (b: Beat) => {
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

export function buildThread(sessionId: string, steps: Step[], resolve: FileResolver, detail: ReplayDetail = "light"): Thread {
  const beats: Beat[] = [];
  const moves: Move[] = [];
  const files: string[] = [];
  const touched = new Map<string, { edits: number; reads: number }>();
  const stepBeat = new Map<string, number>();
  let editCount = 0;

  const touch = (file: string, action: BeatAction) => {
    const t = touched.get(file) ?? { edits: 0, reads: 0 };
    if (action === "edit") t.edits++; else t.reads++;
    if (!touched.has(file)) files.push(file);
    touched.set(file, t);
  };
  const moveTo = (file: string, beatIndex: number, ts: string) => {
    if (moves[moves.length - 1]?.file !== file) moves.push({ beatIndex, file, ts });
  };
  const newBeat = (kind: BeatKind, step: Step, action: BeatAction): Beat => {
    const b: Beat = { index: beats.length, kind, step, steps: [], action, file: null, files: [], outside: false, moveIndex: moves.length - 1, failed: 0 };
    beats.push(b);
    return b;
  };
  const callBeat = new Map<string, Beat>(); // tool_use id → the beat holding the call
  const add = (b: Beat, s: Step) => {
    b.steps.push(s);
    if (s.toolUseId && s.kind !== "tool_result") callBeat.set(s.toolUseId, b);
    stepBeat.set(s.id, b.index);
    if (isFailedResult(s)) { b.failed++; if (b.counts) b.counts.failed++; }
  };
  /** A file-touching step; returns the resolved map node (or null). */
  const fileStep = (b: Beat, s: Step, action: BeatAction) => {
    const file = s.filePath ? resolve(s.filePath) : null;
    if (file) {
      touch(file, action);
      if (!b.files.includes(file)) b.files.push(file);
      b.file = file;
      if (TRACER_MOVES_ON.has(action)) { moveTo(file, b.index, s.ts); b.moveIndex = moves.length - 1; }
    }
    b.outside = b.files.length === 0 && !!s.filePath;
  };

  // The main agent and its subagents write to the same log, interleaved. Group per stream (who is acting)
  // so a subagent's work doesn't split the main thread's summaries, and a note folds into its own edit.
  const streamOf = (s: Step) => s.agentId ?? (s.isSubagent ? "sub" : "main");
  const open = new Map<string, Beat>();   // per stream: the read run or summary new steps can join
  const lastOf = new Map<string, Beat>(); // per stream: its latest beat (tool results fold into it)
  const absorbed = new Set<Beat>();       // talk-only summaries folded into the next edit as its "why"

  for (const s of steps) {
    const action = actionOf(s);
    if (action === "edit") editCount++;

    if (detail === "full") {
      const b = newBeat("step", s, action);
      add(b, s);
      if (action !== "other") fileStep(b, s, action);
      continue;
    }

    const k = streamOf(s);
    if (s.kind === "tool_result") {
      const b = (s.toolUseId ? callBeat.get(s.toolUseId) : undefined) ?? lastOf.get(k) ?? beats[beats.length - 1];
      if (b) { add(b, s); continue; } // results fold into what they answer
    }
    if (s.kind === "prompt" && !s.isSubagent) {
      open.delete(k);
      const b = newBeat("prompt", s, "other"); add(b, s); lastOf.set(k, b);
      continue;
    }
    if (action === "edit") {
      const o = open.get(k);
      const talk = o?.kind === "summary" && isTalkOnly(o) ? o : null;
      open.delete(k);
      const b = newBeat("edit", s, "edit");
      if (talk) { absorbed.add(talk); b.why = headlineOf(talk.steps, talk.counts!); for (const t of talk.steps) add(b, t); }
      add(b, s); fileStep(b, s, "edit"); lastOf.set(k, b);
      continue;
    }
    if (action === "read") {
      let o = open.get(k);
      if (o?.kind !== "reads") { o = newBeat("reads", s, "read"); open.set(k, o); }
      add(o, s); fileStep(o, s, "read"); lastOf.set(k, o);
      continue;
    }
    let o = open.get(k);
    if (o?.kind !== "summary") { o = newBeat("summary", s, "other"); o.counts = emptyCounts(); open.set(k, o); }
    add(o, s); count(o.counts!, s); lastOf.set(k, o);
  }

  // Drop the folded summaries and renumber.
  if (absorbed.size) {
    const keep = beats.filter((b) => !absorbed.has(b));
    const remap = new Map<number, number>();
    keep.forEach((b, i) => { remap.set(b.index, i); b.index = i; });
    for (const [id, i] of stepBeat) stepBeat.set(id, remap.get(i) ?? 0);
    for (const m of moves) m.beatIndex = remap.get(m.beatIndex) ?? m.beatIndex;
    beats.length = 0;
    beats.push(...keep);
  }
  for (const b of beats) if (b.kind === "summary") b.headline = headlineOf(b.steps, b.counts!);

  return { sessionId, detail, beats, moves, files, touched, stepBeat, stepCount: steps.length, editCount };
}

/** The thread for a session, built against the current map. Loads the session's steps if needed (live app). */
export function useThread(sessionId: string | null, detail: ReplayDetail = "light"): Thread | null {
  const { state, loadSteps } = useLive();
  const steps = sessionId ? state.steps[sessionId] : undefined;
  useEffect(() => { if (sessionId && !steps) loadSteps(sessionId); }, [sessionId, steps, loadSteps]);
  const resolve = useMemo(() => makeFileResolver(state.map), [state.map]);
  return useMemo(() => (sessionId && steps ? buildThread(sessionId, steps, resolve, detail) : null), [sessionId, steps, resolve, detail]);
}
