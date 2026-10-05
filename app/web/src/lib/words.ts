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
import { isVisible, pairResults } from "../follow/format";
import { activeMs, worked } from "./chapters";
import { actionOf } from "./thread";
import { repoBase, repoRelative } from "./paths";

/** "1 step", "962 steps", "1,204 files". */
export const plural = (k: number, one: string, many = `${one}s`) => `${k.toLocaleString()} ${k === 1 ? one : many}`;

export type ThreadNumbers = {
  steps: number;     // steps as the step list shows them
  changed: number;   // files edited or written
  created: number;   // of those, files the agent created
  read: number;      // files read and not changed
  workedMs: number;  // active time
};

/** A file's identity: repo files by their path in the repo (any checkout of it), others by their absolute path. */
function fileKey(map: ProjectMap | null): (abs: string) => string {
  if (!map) return (abs) => abs;
  const bases = [repoBase(map.root), ...(map.formerRoots ?? [])];
  return (abs) => {
    for (const b of bases) { const rel = repoRelative(abs, b); if (rel !== null) return `repo:${rel}`; }
    return abs;
  };
}

const CREATED = /^\s*File created successfully/i; // Claude Code's Write result for a file that didn't exist

export function threadNumbers(steps: Step[], map: ProjectMap | null): ThreadNumbers {
  const key = fileKey(map);
  const results = pairResults(steps);
  const changed = new Set<string>(), created = new Set<string>(), read = new Set<string>();
  for (const s of steps) {
    if (!s.filePath) continue;
    const action = actionOf(s);
    if (action === "edit") {
      const k = key(s.filePath);
      changed.add(k);
      if (s.tool === "Write" && CREATED.test(results.get(s.id)?.text ?? "")) created.add(k);
    } else if (action === "read") read.add(key(s.filePath));
  }
  for (const k of changed) read.delete(k);
  return { steps: steps.filter(isVisible).length, changed: changed.size, created: created.size, read: read.size, workedMs: steps.length > 1 ? activeMs(steps) : 0 };
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
  n.changed ? `Changed ${plural(n.changed, "file")}${n.created ? ` (${n.created.toLocaleString()} new)` : ""}` : "Changed no files";

/** The thread's summary line: "Changed 16 files (15 new) · read 40 more · 962 steps · worked 3 h 10 min". */
export function threadLine(n: ThreadNumbers): string {
  return [
    changedPhrase(n),
    n.read ? `read ${n.read.toLocaleString()} more` : "",
    plural(n.steps, "step"),
    n.workedMs ? worked(n.workedMs) : "",
  ].filter(Boolean).join(" · ");
}
