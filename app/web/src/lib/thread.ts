// Owner: thread-replay foundation. One session (thread) as a timeline of beats for the map replay.
// Every step is a beat you can stop on. The tracer only moves on beats whose action is in TRACER_MOVES_ON.
import { useEffect, useMemo } from "react";
import type { Step } from "@contract";
import { useLive } from "./live";
import { makeFileResolver, type FileResolver } from "./paths";

export type BeatAction = "edit" | "read" | "other";

/** Which actions move the tracer. Edits only: reads flash their file without moving it. */
export const TRACER_MOVES_ON: ReadonlySet<BeatAction> = new Set<BeatAction>(["edit"]);

const READ_TOOLS = new Set(["Read", "NotebookRead"]);

export type Beat = {
  index: number;          // position in the thread (0-based), the replay cursor
  step: Step;
  action: BeatAction;
  file: string | null;    // map node id this beat touches, or null
  outside: boolean;       // touches a file that is not on the map (another project, scratch file)
  moveIndex: number;      // tracer position at this beat: index into Thread.moves, -1 before the first move
};

export type Move = { beatIndex: number; file: string; ts: string };

export type Thread = {
  sessionId: string;
  beats: Beat[];
  moves: Move[];          // tracer path: one entry each time the tracer changes file
  files: string[];        // map files the thread touches (any action), in first-touch order
  touched: Map<string, { edits: number; reads: number }>;
};

export function actionOf(s: Step): BeatAction {
  if (s.kind === "edit") return "edit";
  if (s.kind === "tool_call" && s.tool && READ_TOOLS.has(s.tool) && s.filePath) return "read";
  return "other";
}

export function buildThread(sessionId: string, steps: Step[], resolve: FileResolver): Thread {
  const beats: Beat[] = [];
  const moves: Move[] = [];
  const files: string[] = [];
  const touched = new Map<string, { edits: number; reads: number }>();
  let moveIndex = -1;
  steps.forEach((step, index) => {
    const action = actionOf(step);
    const file = step.filePath ? resolve(step.filePath) : null;
    const outside = !!step.filePath && !file && action !== "other";
    if (file && action !== "other") {
      const t = touched.get(file) ?? { edits: 0, reads: 0 };
      if (action === "edit") t.edits++; else t.reads++;
      if (!touched.has(file)) files.push(file);
      touched.set(file, t);
      if (TRACER_MOVES_ON.has(action) && moves[moves.length - 1]?.file !== file) {
        moves.push({ beatIndex: index, file, ts: step.ts });
        moveIndex = moves.length - 1;
      }
    }
    beats.push({ index, step, action, file, outside, moveIndex });
  });
  return { sessionId, beats, moves, files, touched };
}

/** The thread for a session, built against the current map. Loads the session's steps if needed (live app). */
export function useThread(sessionId: string | null): Thread | null {
  const { state, loadSteps } = useLive();
  const steps = sessionId ? state.steps[sessionId] : undefined;
  useEffect(() => { if (sessionId && !steps) loadSteps(sessionId); }, [sessionId, steps, loadSteps]);
  const resolve = useMemo(() => makeFileResolver(state.map), [state.map]);
  return useMemo(() => (sessionId && steps ? buildThread(sessionId, steps, resolve) : null), [sessionId, steps, resolve]);
}
