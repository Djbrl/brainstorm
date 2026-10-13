// THE FOCUS of an open thread, in one place (moved out of ThreadLayer.ts): which files are lit (and named) at the cursor, what
// every other file is, and how each file eases into and out of it. Read for every file on every frame, so the focus is
// cached per cursor (the test compares fields and builds nothing) and the eased look per file.
import { useCallback, useMemo, useRef, type RefObject } from "react";
import { mapPrefs } from "../../lib/nav";
import type { Thread } from "../../lib/thread";
import { getStepWindow, type StepWindow } from "../prefs";
import { reducedMotion } from "../../lib/breakpoints";

/**
 * How a file reads while something is in focus (an open thread): `alpha`, its strength; `tone`, how far its colour has
 * moved from the map's own (when anyone last changed it) to the focus's (`edited`: when the thread last changed it, or
 * the quiet colour if it didn't); `named`, it's one the focus names. Alpha and tone ease, so files fade in and out.
 */
export type Look = { alpha: number; tone: number; edited?: string; named?: boolean };
/** What a file should look like in the focus: its strength, when the focus changed it (none: the quiet colour), named. */
type Target = { alpha: number; edited?: string; named?: boolean };
/** The focus for the current cursor: the files in it, and what every other file is. */
type Focus = { files: Map<string, Target>; rest: Target };
/** Where the replay is: what the focus is worked out from (ThreadLayer.ts keeps it up to date every render). */
export type Cursor = { active: boolean; thread: Thread | null; index: number; mode: string };

const DIM = 0.3;            // files out of focus: the thread never touched them, or not in the recent window (0.15 hid the map)
const PAST = 0.42;          // whole-thread replay: files it touched earlier than the fog window below
const READ = 0.5;           // files it only read ("Show reads" on): there, quieter than what it changed
const FADE_MS = 120;        // a file easing into or out of the focus (time constant: settled in about 400 ms)
/** Fog of war (the whole-thread replay): only the last few moments are drawn (path, numbers) and lit in full. */
export const WINDOW = 25;
const STILL = reducedMotion();

/** The first index in a sorted list whose value is over `v` (binary search). */
function upperBound(sorted: ArrayLike<number>, v: number, hi = sorted.length) {
  let lo = 0;
  while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] <= v) lo = m + 1; else hi = m; }
  return lo;
}
/** A file's changes in a thread: the beats that changed it (sorted) and when. */
type Edits = { i: number[]; ts: string[] };
/** When a file was last changed at or before beat `i` (undefined: not yet). */
const editedBy = (e: Edits | undefined, i: number) => { if (!e) return undefined; const n = upperBound(e.i, i); return n ? e.ts[n - 1] : undefined; };

/** Per moment: the files it touched, the ones it changed and when. Per file: when it was touched and changed (the fog),
 *  as sorted beat indexes (binary search). Per tracer move: each file's first visit (the stops' order). */
function threadData(thread: Thread | null) {
  const touchedAt = new Map<string, number[]>(), editsAt = new Map<string, Edits>();
  const beatFiles = (thread?.beats ?? []).map((b) => {
    const touched = new Set(b.files);
    if (b.file) touched.add(b.file);
    for (const f of touched) { const l = touchedAt.get(f); if (l) l.push(b.index); else touchedAt.set(f, [b.index]); }
    if (b.action !== "edit") return { touched, edited: null, ts: undefined };
    let ts = b.step.ts;
    for (let k = b.steps.length - 1; k >= 0; k--) if (b.steps[k].kind === "edit") { ts = b.steps[k].ts; break; }
    for (const f of b.files) {
      const e = editsAt.get(f);
      if (e) { e.i.push(b.index); e.ts.push(ts); } else editsAt.set(f, { i: [b.index], ts: [ts] });
    }
    return { touched, edited: new Set(b.files), ts };
  });
  return { beatFiles, touchedAt, editsAt };
}
export type ThreadData = ReturnType<typeof threadData>;

/**
 * The focus at a cursor, or null when nothing is in focus (no thread open: the map as it is). With a thread open it's the
 * recent window, the files of the moments (Track rows) from the cursor back N (the "On the map, show" setting): what they
 * changed in its own recency colours, what they read quieter (with "Show reads" on), the rest dimmed back with no names.
 * "The whole thread": at rest its whole footprint, in a replay the fog of its last few moments. A thread that changed
 * nothing lights nothing, as its "Changed no files" says.
 */
function focusAt(s: Cursor & { thread: Thread }, data: ThreadData, win: StepWindow, reads: boolean): Focus {
  const { beatFiles, touchedAt, editsAt } = data;
  const files = new Map<string, Target>();
  if (win !== "all") {
    for (let i = Math.max(0, s.index - win + 1); i <= s.index; i++) {
      const b = beatFiles[i];
      if (b) for (const id of b.touched) {
        const edited = b.edited?.has(id) ? b.ts : files.get(id)?.edited;   // its latest change in the window
        if (edited) files.set(id, { alpha: 1, edited, named: true });
        else if (reads && !files.has(id)) files.set(id, { alpha: READ, named: true });
      }
    }
    // The file the tracer stands on (the last one it changed) stays lit, even when the window is all talk.
    const mi = s.thread.beats[s.index]?.moveIndex ?? -1, here = mi >= 0 ? s.thread.moves[mi].file : null;
    if (here && !files.get(here)?.edited) files.set(here, { alpha: 1, edited: editedBy(editsAt.get(here), s.index), named: true });
  } else if (s.mode !== "play") {
    for (const id of s.thread.touched.keys()) {
      const e = editsAt.get(id);
      if (e) files.set(id, { alpha: 1, edited: e.ts[e.ts.length - 1] });
      else if (reads) files.set(id, { alpha: READ });
    }
  } else {
    // The whole thread, replaying: files light up as it reaches them, and fade back once out of the last few moments.
    for (const [id, at] of touchedAt) {
      const n = upperBound(at, s.index);   // touches up to the cursor
      if (!n) continue;
      const edited = editedBy(editsAt.get(id), s.index);
      if (edited || reads) files.set(id, { alpha: s.index - at[n - 1] <= WINDOW ? 1 : PAST, edited });
    }
  }
  return { files, rest: { alpha: DIM } };
}

/** The focus of the cursor in `st`, and each file's eased look in it. */
export function useFocus(st: RefObject<Cursor>, thread: Thread | null) {
  const data = useMemo(() => threadData(thread), [thread]);
  const dataRef = useRef(data); dataRef.current = data;
  const cache = useRef<{ index: number; mode: string; win: StepWindow | null; reads: boolean; thread: Thread | null; focus: Focus | null }>(
    { index: -1, mode: "", win: null, reads: false, thread: null, focus: null });
  const focus = useCallback((): Focus | null => {
    const s = st.current;
    if (!s.active || !s.thread) return null;
    const win: StepWindow = getStepWindow(), reads = mapPrefs.showReads, c = cache.current;
    if (c.thread === s.thread && c.index === s.index && c.mode === s.mode && c.win === win && c.reads === reads) return c.focus;
    const f = focusAt(s as Cursor & { thread: Thread }, dataRef.current, win, reads);
    cache.current = { index: s.index, mode: s.mode, win, reads, thread: s.thread, focus: f };
    return f;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const focusOf = useCallback((id: string): Target | null => { const f = focus(); return f ? f.files.get(id) ?? f.rest : null; }, [focus]);

  // Each file eases toward its target: into the focus, out of it as the window moves on, and back to the map as it is
  // when the focus ends.
  const shown = useRef(new Map<string, Look & { t: number }>());
  const look = useCallback((id: string): Look | null => {
    const target = focusOf(id), now = performance.now();
    let e = shown.current.get(id);
    if (!e) {
      if (!target) return null;
      shown.current.set(id, (e = { alpha: 1, tone: 0, t: now }));
    }
    const k = STILL ? 1 : 1 - Math.exp(-Math.min(200, now - e.t) / FADE_MS);
    e.t = now;
    const toward = (v: number, to: number) => (Math.abs(to - v) < 0.004 ? to : v + (to - v) * k); // lands exactly (names show at 1)
    e.alpha = toward(e.alpha, target?.alpha ?? 1);
    e.tone = toward(e.tone, target ? 1 : 0);
    e.named = !!target?.named;
    if (target) e.edited = target.edited;    // fading out keeps the focus's colour it fades from
    else if (e.tone === 0 && e.alpha === 1) { shown.current.delete(id); return null; }
    return e;
  }, [focusOf]);
  return { focus, look };
}
