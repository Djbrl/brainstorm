// Owner: C (words and numbers). One set of numbers for a thread, said the same way in every view:
// - a step is one thing in the thread's step list (what the agent did or said, and your messages); tool results and
//   empty thinking are part of the step they answer, not steps of their own (follow/format's isVisible);
// - files: "Changed N files (N new) · read N more". Changed = every file the agent edited or wrote, anywhere; new =
//   the ones its Write created; read = files it opened and didn't change. A repo file counts once, whichever checkout
//   (worktree, old location) the agent used;
// - "worked X": active time, pauses over 30 minutes left out (lib/chapters activeMs).
import { useEffect, useMemo } from "react";
import type { ProjectMap, Step } from "@contract";
import { useLive } from "./live";
import { isVisible } from "../follow/format";
import { BREAK_MS, stepTime, worked } from "./chapters";
import { actionOf, onlyRelabelled } from "./thread";
import { CallPairer } from "./pairing";
import { repoBase, repoRelative } from "./paths";

/** "1 step", "962 steps", "1,204 files". */
export const plural = (k: number, one: string, many = `${one}s`) => `${k.toLocaleString()} ${k === 1 ? one : many}`;

export type ThreadNumbers = {
  steps: number;     // steps as the step list shows them
  changed: number;   // files edited or written
  created: number;   // of those, files the agent created
  outside: number;   // of those, files outside the project (on islands): another repo an orchestrator edited
  read: number;      // files read and not changed
  workedMs: number;  // active time
};

/** Where the map's repo lives (and lived): all a file's identity depends on. */
const basesOf = (map: ProjectMap | null) => (map ? [repoBase(map.root), ...(map.formerRoots ?? [])] : []);

/** A file's identity: repo files by their path in the repo (any checkout of it), others by their absolute path. */
let lastKey: { bases: string; key: (abs: string) => string } | null = null;
function fileKey(bases: string[]): (abs: string) => string {
  const id = bases.join("\n");
  if (lastKey?.bases === id) return lastKey.key;
  const seen = new Map<string, string>();
  const key = (abs: string) => {
    let k = seen.get(abs);
    if (k === undefined) {
      k = abs;
      for (const b of bases) { const rel = repoRelative(abs, b); if (rel !== null) { k = `repo:${rel}`; break; } }
      seen.set(abs, k);
    }
    return k;
  };
  lastKey = { bases: id, key };
  return key;
}

const CREATED = /^\s*File created successfully/i; // Claude Code's Write result for a file that didn't exist

/**
 * Counts a thread's numbers step by step, and carries on when more steps arrive or the reader relabels one (only
 * the step count can change then). Same rules as counting the whole list: calls paired with their results as
 * pairResults does, files keyed by fileKey, working time as activeMs.
 */
class Counter {
  steps: Step[] = [];
  last: ThreadNumbers | null = null;
  private pairer = new CallPairer();
  private changed = new Set<string>();
  private created = new Set<string>();
  private read = new Set<string>();
  private readOnly = 0;   // read and not changed
  private visible = 0;
  private workedMs = 0;
  private prevMs = 0;

  /** `scoped`: keys are the project's ("repo:…") or, for a file outside it, its absolute path. */
  constructor(readonly key: (abs: string) => string, readonly scoped = false) {}

  /** False when the new list doesn't follow on from the counted one (then count afresh). */
  update(next: Step[]): boolean {
    const prev = this.steps;
    if (next === prev) return true;
    if (next.length < prev.length) return false;
    let delta = 0;
    for (let i = 0; i < prev.length; i++) {
      if (next[i] === prev[i]) continue;
      if (!onlyRelabelled(prev[i], next[i])) return false;
      delta += Number(isVisible(next[i])) - Number(isVisible(prev[i]));
    }
    this.visible += delta;
    for (let i = prev.length; i < next.length; i++) this.feed(next[i], i);
    this.steps = next;
    if (delta || next.length > prev.length) this.last = null;
    return true;
  }

  private feed(s: Step, i: number) {
    if (isVisible(s)) this.visible++;
    const t = stepTime(s);
    if (i > 0) { const d = t - this.prevMs; if (d > 0 && d < BREAK_MS) this.workedMs += d; }
    this.prevMs = t;

    if (s.kind === "tool_call" || s.kind === "edit") this.pairer.call(s);
    else if (s.kind === "tool_result") {
      const call = this.pairer.result(s);
      if (call?.kind === "edit" && call.tool === "Write" && call.filePath && CREATED.test(s.text ?? "")) this.created.add(this.key(call.filePath));
    } else if (s.kind === "prompt" && !s.isSubagent) this.pairer.clear();

    if (!s.filePath) return;
    const action = actionOf(s);
    if (action === "edit") {
      const k = this.key(s.filePath);
      if (!this.changed.has(k)) { this.changed.add(k); if (this.read.has(k)) this.readOnly--; }
    } else if (action === "read") {
      const k = this.key(s.filePath);
      if (!this.read.has(k)) { this.read.add(k); if (!this.changed.has(k)) this.readOnly++; }
    }
  }

  numbers(): ThreadNumbers {
    let outside = 0;
    if (this.scoped) for (const k of this.changed) if (k.startsWith("/")) outside++;
    return (this.last ??= { steps: this.visible, changed: this.changed.size, created: this.created.size, outside, read: this.readOnly, workedMs: this.steps.length > 1 ? this.workedMs : 0 });
  }
}

// Per steps list (the store makes a new one for each change) and repo location, the numbers are worked out once; a
// counter per thread carries on from the previous list.
const numbersSeen = new WeakMap<Step[], Map<string, ThreadNumbers>>();
const counters = new Map<string, Counter>(); // most recently used last
const MAX_COUNTERS = 8;

/** The thread's numbers. Shared by every view that asks for the same steps: don't change them. */
export function threadNumbers(steps: Step[], map: ProjectMap | null): ThreadNumbers {
  const bases = basesOf(map);
  const id = map ? bases.join("\n") : "\0no map";
  let forSteps = numbersSeen.get(steps);
  const hit = forSteps?.get(id);
  if (hit) return hit;

  const key = `${id}\n\n${steps[0]?.sessionId ?? ""}`;
  let c = counters.get(key);
  counters.delete(key);
  if (!c || !c.update(steps)) { c = new Counter(map ? fileKey(bases) : (abs) => abs, !!map); c.update(steps); }
  counters.set(key, c);
  if (counters.size > MAX_COUNTERS) counters.delete(counters.keys().next().value!);

  const n = c.numbers();
  if (!forSteps) numbersSeen.set(steps, (forSteps = new Map()));
  forSteps.set(id, n);
  return n;
}

/** A thread's numbers, from its steps (loaded if needed). Null until the steps are in. */
export function useThreadNumbers(sessionId: string | null): ThreadNumbers | null {
  const { state, loadSteps } = useLive();
  const steps = sessionId ? state.steps[sessionId] : undefined;
  useEffect(() => { if (sessionId && !steps) loadSteps(sessionId); }, [sessionId, steps, loadSteps]);
  return useMemo(() => (steps ? threadNumbers(steps, state.map) : null), [steps, state.map]);
}

/** "Changed 16 files (15 new)", "Changed no files". */
export const changedPhrase = (n: ThreadNumbers) =>
  n.changed ? `Changed ${plural(n.changed, "file")}${n.created || n.outside ? ` (${[n.created ? `${n.created.toLocaleString()} new` : "", n.outside ? `${n.outside.toLocaleString()} outside` : ""].filter(Boolean).join(", ")})` : ""}` : "Changed no files";

/** The thread's summary line: "Changed 16 files (15 new) · read 40 more · 962 steps · worked 3 h 10 min". */
export function threadLine(n: ThreadNumbers): string {
  return [
    changedPhrase(n),
    n.read ? `read ${n.read.toLocaleString()} more` : "",
    plural(n.steps, "step"),
    n.workedMs ? worked(n.workedMs) : "",
  ].filter(Boolean).join(" · ");
}
