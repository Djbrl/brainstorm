// The open thread as rows of places, for the Places list and its player (PlaceSteps, CoworkView): each
// stretch of work in a place, and Your computer before, between and after them (moments with no place: the code); the
// row the thread is at; and going to a row (the thread's cursor to its moment, the map's marker to its place).
import { useLiveSelector } from "../lib/live";
import { useNavActions, useNavState, useReplayCursor } from "../lib/nav";
import { useThread } from "../lib/thread";
import { placeRuns, placesStore, usePlaces, type PlaceRun } from "./data";

/** A row: its stretch (none: Your computer), the moment it starts at, the one going to it lands on, and for Your
 *  computer how many moments it holds. */
export type PlaceRow = { run?: PlaceRun; start: number; to: number; moments: number; step: string | null };

/**
 * The thread step by step ("full" detail: every step its own moment, always in order), which the places go by. The app's
 * cursor is a moment of the light thread (which folds stretches of steps, not always in order); this says where that is
 * in the steps, and which moment holds a step.
 */
export function usePlaceTimeline() {
  const { thread } = useNavState();
  const sid = thread?.sessionId ?? null;
  const light = useThread(sid, thread?.detail ?? "light");
  const full = useThread(sid, "full");
  const index = useReplayCursor((c) => c.index);
  const stepOf = (id: string) => full?.stepBeat.get(id);
  /** The step the cursor is at, in the full thread's order (live: past the end). */
  let pos = Infinity;
  if (!thread?.live && light && light.beats.length) {
    const b = light.beats[Math.min(index, light.beats.length - 1)], last = b.steps[b.steps.length - 1];
    pos = (last && full?.stepBeat.get(last.id)) ?? 0;
  }
  return { full, light, index, pos, stepOf, steps: full?.beats.length ?? 0 };
}

export function usePlaceRows() {
  const { data, row: picked } = usePlaces();
  const { thread } = useNavState();
  const { full, light, index, pos, stepOf, steps } = usePlaceTimeline();
  const { setReplayIndex, setReplayPlaying } = useNavActions();
  useLiveSelector((s) => (thread ? s.steps[thread.sessionId] : undefined));   // a new step: rows again
  const runs = data ? placeRuns(data.events) : [];
  const rows: PlaceRow[] = [];
  let prev = -1;
  const home = (from: number, n: number) => rows.push({ start: from, to: from, moments: n, step: full?.beats[from]?.step.id ?? null });
  for (const r of runs) {
    const first = stepOf(r.first.stepId), last = stepOf(r.last.stepId) ?? first;
    if (first === undefined || last === undefined) continue;
    if (first - prev > 1) home(prev + 1, first - prev - 1);
    rows.push({ run: r, start: first, to: last, moments: 0, step: r.last.stepId });
    prev = Math.max(prev, last);
  }
  if (rows.length && steps - 1 > prev) home(prev + 1, steps - 1 - prev);
  if (rows[0]?.run) rows.unshift({ start: 0, to: 0, moments: 0, step: full?.beats[0]?.step.id ?? null });   // every thread starts on Your computer
  let at = -1;
  // The row you went to, while the thread is still on its moment (several rows can share one: going to one near the
  // end of a running thread puts it back on live, and that's still the row you picked, not the last); live, the last
  // row; else the last row that starts by the cursor's step.
  if (picked && rows[picked.i] && picked.beat === index) at = picked.i;
  else if (thread?.live) at = rows.length - 1;
  else for (let i = 0; i < rows.length; i++) if (rows[i].start <= pos) at = i;
  /** Go to a row: paused (by hand), or still playing (the player's own steps). The app's cursor goes to the moment
   *  holding its step. */
  const go = (i: number, playing = false): boolean => {
    const r = rows[i];
    if (!r || !light || !full) return false;
    // The moment holding its step; a step the light thread doesn't hold (it can leave some out), the nearest one before.
    let b = r.step ? light.stepBeat.get(r.step) : undefined;
    for (let k = r.to; b === undefined && k >= 0; k--) { const id = full.beats[k]?.step.id; if (id) b = light.stepBeat.get(id); }
    if (b === undefined) b = 0;
    placesStore.set({ row: { i, beat: b, event: r.run?.last.id ?? null, step: r.to } });
    if (!playing) setReplayPlaying(false);
    setReplayIndex(b);
    return true;
  };
  return { rows, at, go };
}
