// Owner: replay agent. Map-canvas side of the thread replay: tracer, stops, read flashes, the focus (which files are
// lit and named), the camera follow when locked, playback and keyboard. The wheel zooms the map: scrubbing is the Track
// tab's scroll, the arrow keys and the player's slider.
import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import type { ForceGraphMethods } from "react-force-graph-2d";
import { mapPrefs, replayCursor, useNav } from "../../lib/nav";
import { useThread, type Thread } from "../../lib/thread";
import { useLiveSelector } from "../../lib/live";
import { replayCamera } from "./store";
import { centerFor, type Camera } from "../camera";
import { getCameraLock, getStepWindow, type StepWindow } from "../prefs";
import { along, casing, drawMarker, drawTrip, landings, mapStyle, platform, polyPath, routePoints, tripMs } from "../themes";

export type NodePos = { x?: number; y?: number; r: number };
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

export type ReplayLayerApi = {
  /** True while a thread replay is on (nav.replay is set and its thread is loaded). */
  active: boolean;
  /** Alpha for a node during replay: 1 = normal, lower = dimmed (not touched by the thread). */
  nodeAlpha: (id: string) => number;
  /** How a file reads in the focus (eased), or null when nothing is in focus and its fade is over: the map as it is. */
  look: (id: string) => Look | null;
  /** True while the tracer is drawn (a replay or steps, not the footprint): Metro quiets the import lines then. */
  tracing: boolean;
  /** At the thread's last step while its agent thinks: the marker breathes (MapView keeps drawing). */
  thinking: boolean;
  /** The player is open (a replay, playing or paused): the arrow keys step through it, not move the map. */
  playable: boolean;
  /** The thread's footprint mode (its files lit, no tracer): MapView frames it. */
  footprintMode: boolean;
  /** The files in focus (what a fit frames: the recent window, or the whole thread), or null with no thread open. */
  footprint: () => string[] | null;
  /** Whether the open thread touched a file at all (read or changed), at any point. */
  touches: (id: string) => boolean;
  /** The tracer's camera target (the marker, or between it and a file it reads), or null: what a locked camera centres. */
  subject: () => { x: number; y: number } | null;
  /** Draw the tracer, numbered stops, the current marker and read flashes. Called every frame after the agent layer. */
  draw: (ctx: CanvasRenderingContext2D, scale: number) => void;
  /** Where draw() will put its numbered stops, the marker and its name this frame, so file names keep off them;
   *  and the file the marker names (its own label would say the same thing twice). */
  marks: (ctx: CanvasRenderingContext2D, scale: number) => { boxes: Box[]; named: string | null };
};
type Box = { x0: number; y0: number; x1: number; y1: number };

const GLIDE_MS = 650;       // same glide as the live agent markers (map/agents.tsx)
const THINK_MS = 2400;      // the thinking ring's breath (as in agents.tsx)
const FLASH_MS = 600;       // read flash
const PULSE_MS = 700;       // edit pulse on the marker
const RED = "#d93025";      // a beat with a failed tool call
const ERR_PULSE_MS = 1100;
const DIM = 0.3;            // files out of focus: the thread never touched them, or not in the recent window (0.15 hid the map)
const PAST = 0.42;          // whole-thread replay: files it touched earlier than the fog window below
const READ = 0.5;           // files it only read ("Show reads" on): there, quieter than what it changed
const FADE_MS = 120;        // a file easing into or out of the focus (time constant: settled in about 400 ms)
/** Fog of war (the whole-thread replay): only the last few moments are drawn (path, numbers) and lit in full. */
const WINDOW = 25;
const TAPER = 3;            // a tracer segment fades out over its last few moments in the window, so the trail doesn't end in a cut
const OTHER_MS = 120;       // playback pace for single "other" steps (every-step detail)
const SUMMARY_MS = 380;     // playback pace for summary beats (light detail)
const READ_MS = 520;        // playback pace for reads
const STEP_MS = 700;        // playback pace for edits and your prompts (at 1×)

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const STILL = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
/**
 * The numbered stops: each file visited within the window, by its latest stop (the marker's own file has none), in the
 * order of each file's first visit (the order they are drawn in). Moves are in beat order, so only the moves inside the
 * window are read, from the marker back.
 */
function stopsOf(moves: Thread["moves"], mi: number, fogBefore: number, curFile: string | null, firstVisit: Map<string, number>) {
  const latest = new Map<string, number>();
  for (let k = mi; k >= 0 && moves[k].beatIndex >= fogBefore; k--) {
    const f = moves[k].file;
    if (f !== curFile && !latest.has(f)) latest.set(f, k);
  }
  if (latest.size < 2) return latest;
  return new Map([...latest].sort((a, b) => (firstVisit.get(a[0]) ?? 0) - (firstVisit.get(b[0]) ?? 0)));
}
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
/** The first move at or after a beat (binary search over the moves' beat indexes, up to `hi`). */
function firstMoveFrom(moves: Thread["moves"], beat: number, hi: number) {
  let lo = 0;
  while (lo < hi) { const m = (lo + hi) >> 1; if (moves[m].beatIndex < beat) lo = m + 1; else hi = m; }
  return lo;
}
/** A stop's badge: just off the file's top-left. */
const badgeAt = (n: { x: number; y: number; r: number }, scale: number) => {
  const d = n.r + 8 / scale, ang = (-3 * Math.PI) / 4;
  return { x: n.x + Math.cos(ang) * d, y: n.y + Math.sin(ang) * d };
};
const BADGE_FONT = 9.5, MARK_R = 10, NAME_FONT = 12;
const baseName = (p: string) => p.split("/").pop() || p;
const INK = "#1d1d1f";

type Anim = { x: number; y: number; fromX: number; fromY: number; t0: number; file: string | null; lastIndex: number; beatAt: number;
  cam: { x: number; y: number } | null; landedT0?: number };

function isTyping(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  if (el.tagName === "INPUT" && /^(range|checkbox|radio|button)$/.test((el as HTMLInputElement).type)) return false; // not typing: the replay slider
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
}

export function useReplayLayer({ fg, wrapRef, nodeIndexRef, accent, font, camera, liveShown }: {
  fg: RefObject<ForceGraphMethods | undefined>;
  wrapRef: RefObject<HTMLDivElement | null>;
  nodeIndexRef: RefObject<Map<string, NodePos>>;
  accent: string;
  font: string;
  /** MapView's camera: the follow keeps the marker in the middle of the part of the map no panel covers. */
  camera: RefObject<Camera>;
  /** Following live, whether the live layer draws the thread's agent: if it's gone (the server forgets an agent after
   *  half an hour), the replay's marker stands in for it at its last step. */
  liveShown?: RefObject<boolean>;
}): ReplayLayerApi {
  const { replay, setReplayIndex, setReplayPlaying, landReplay } = useNav();
  const thread = useThread(replay?.sessionId ?? null, replay?.detail ?? "light");
  const active = !!replay && !!thread && thread.sessionId === replay.sessionId && thread.detail === replay.detail;
  // A thread opens on its footprint: its files lit, the camera on them, no tracer. The keys and the wheel drive the replay only once it plays.
  const mode = replay?.mode ?? "footprint";
  const playable = active && mode === "play";
  const len = active ? thread!.beats.length : 0;
  const last = Math.max(0, len - 1);
  const index = replay ? Math.min(replay.index, last) : 0;
  // Publish the step at the cursor (switching the detail lands on it). After every commit,
  // as the render used to do, but outside the render.
  const cursorStep = active && !replay?.atStep ? thread!.beats[index]?.step.id ?? null : undefined;
  useEffect(() => { if (cursorStep !== undefined) replayCursor.stepId = cursorStep; });

  // Land on a step id (links, Follow, switching detail) once the thread is built.
  useEffect(() => {
    if (!active || !replay?.atStep) return;
    landReplay(thread!.stepBeat.get(replay.atStep) ?? 0);
  }, [active, replay?.atStep, thread, landReplay]);

  replayCamera.fg = fg;
  replayCamera.safe = camera.current.safe;

  const speed = replay?.speed ?? 1;
  // Following live, the thread's own agents are drawn by the live layer (each in its colour): no single cursor marker.
  const live = !!replay?.live;
  // The thread is mid-turn and the model hasn't answered yet: at its last step, the marker shows it's thinking.
  const thinking = useLiveSelector((s) => !!replay && s.attention[replay.sessionId]?.state === "thinking") && active && index >= last;
  const st = useRef<{ active: boolean; thread: Thread | null; index: number; len: number; mode: string; speed: number; live: boolean; thinking: boolean }>({ active, thread, index, len, mode, speed, live, thinking });
  st.current = { active, thread, index, len, mode, speed, live, thinking };
  const anim = useRef<Anim>({ x: 0, y: 0, fromX: 0, fromY: 0, t0: -1e9, file: null, lastIndex: -1, beatAt: -1e9, cam: null });

  // Bounds: clamp the cursor whenever the thread (or its length) changes.
  useEffect(() => {
    // Not while landing on a step. landReplay, not setReplayIndex: a live thread's moments can regroup one shorter as
    // steps arrive, and that clamp must not stop it following live.
    if (active && replay && !replay.atStep && replay.index > last) landReplay(last);
  }, [active, last, replay?.index, replay?.atStep, landReplay]);

  // A new replay: a fresh marker.
  useEffect(() => {
    anim.current = { x: 0, y: 0, fromX: 0, fromY: 0, t0: -1e9, file: null, lastIndex: -1, beatAt: -1e9, cam: null };
  }, [replay?.sessionId]);

  // ---- playback ----
  useEffect(() => {
    if (!active || !replay?.playing) return;
    if (index >= last) { setReplayPlaying(false); return; }
    const cur = thread!.beats[index];
    const base = cur.kind === "summary" ? SUMMARY_MS : cur.action === "read" ? READ_MS : cur.kind === "step" && cur.action === "other" ? OTHER_MS : STEP_MS;
    const ms = base / replay.speed;
    const t = setTimeout(() => setReplayIndex((i) => Math.min(last, i + 1)), ms);
    return () => clearTimeout(t);
  }, [active, replay?.playing, replay?.speed, index, last, thread, setReplayIndex, setReplayPlaying]);

  // ---- keyboard: Space plays from where you are (with a thread open on the map); in the player, ← → step, Home / End.
  // Outside the player the arrows move the map (useMapCamera). ----
  const replayPlayingRef = useRef(false);
  replayPlayingRef.current = !!replay?.playing;
  useEffect(() => {
    if (!active) return;
    const step = (d: number) => { setReplayPlaying(false); setReplayIndex((i) => Math.max(0, Math.min(st.current.len - 1, i + d))); };
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (e.key !== " " && st.current.mode !== "play") return;
      switch (e.key) {
        case "ArrowRight": step(e.shiftKey ? 10 : 1); break;
        case "ArrowLeft": step(e.shiftKey ? -10 : -1); break;
        case "Home": setReplayPlaying(false); setReplayIndex(0); break;
        case "End": setReplayPlaying(false); setReplayIndex(st.current.len - 1); break;
        case " ": {
          if ((e.target as HTMLElement | null)?.tagName === "BUTTON") return; // let the focused button click
          togglePlay(replayPlayingRef.current, setReplayPlaying);
          break;
        }
        default: return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, setReplayIndex, setReplayPlaying]);

  // ---- camera ----
  // Locked: the marker stays in the middle of the part of the map no panel covers (easing, never snapping); the wheel
  // and pinch still zoom, and the zoom stays where you put it. Unlocked: the camera stays where it is; when the marker
  // leaves the view, MapView frames the recent window again, unless you moved the camera since it last framed it.
  // The loop runs only while there is something to do: locked, until the camera has caught up with the marker;
  // unlocked, while the marker is out of view. draw() starts it again when the marker, the view, the lock or the
  // pinned file changes (see kickCamera).
  const camLoop = useRef({ enabled: false, raf: 0, lostAt: 0, tick: () => {},
    seen: { x: null as number | null, y: null as number | null, lock: false, pinned: false, safe: null as unknown, a: null as number | null, e: null as number | null, f: null as number | null } });
  useEffect(() => {
    const L = camLoop.current;
    if (!active || mode === "footprint") return;
    L.tick = () => {
      L.raf = 0;
      const a = anim.current, cam = camera.current;
      let busy = false;
      if (a.cam && !replayCamera.pinned) {
        if (getCameraLock()) {
          // The same test easeToward makes before it moves (over 1.5 px off): once it's under, the camera has arrived.
          const v = cam.view();
          if (v) { const t = centerFor(cam.safe.current, a.cam.x, a.cam.y, v.k); busy = Math.hypot(t.x - v.x, t.y - v.y) * v.k > 1.5; }
          if (busy) cam.easeToward(a.cam.x, a.cam.y, 0.08);
        } else {
          busy = !cam.sees(a.cam.x, a.cam.y);
          if (busy && performance.now() - L.lostAt > 1200) { L.lostAt = performance.now(); replayCamera.lost?.(); }
        }
      }
      if (busy) L.raf = requestAnimationFrame(L.tick);
    };
    L.enabled = true;
    L.raf = requestAnimationFrame(L.tick);
    return () => { L.enabled = false; cancelAnimationFrame(L.raf); L.raf = 0; };
  }, [active, mode, fg, camera]);
  /** From draw(), every frame: start the camera loop again when something it follows changed since the last frame. */
  const kickCamera = useCallback((ctx: CanvasRenderingContext2D) => {
    const L = camLoop.current, s = L.seen, c = anim.current.cam, m = ctx.getTransform();
    const x = c?.x ?? null, y = c?.y ?? null, lock = getCameraLock(), pinned = replayCamera.pinned, safe = camera.current.safe.current;
    if (x === s.x && y === s.y && lock === s.lock && pinned === s.pinned && safe === s.safe && m.a === s.a && m.e === s.e && m.f === s.f) return;
    s.x = x; s.y = y; s.lock = lock; s.pinned = pinned; s.safe = safe; s.a = m.a; s.e = m.e; s.f = m.f;
    if (L.enabled && !L.raf) L.raf = requestAnimationFrame(L.tick);
  }, [camera]);

  // ---- the focus ----
  // Per moment: the files it touched, the ones it changed and when. Per file: when it was touched and changed (the fog),
  // as sorted beat indexes (binary search). Per tracer move: each file's first visit (the stops' order).
  const data = useMemo(() => {
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
    const firstVisit = new Map<string, number>();
    (thread?.moves ?? []).forEach((m, k) => { if (!firstVisit.has(m.file)) firstVisit.set(m.file, k); });
    return { beatFiles, touchedAt, editsAt, firstVisit };
  }, [thread]);
  const dataRef = useRef(data); dataRef.current = data;

  /**
   * THE FOCUS, in one place: which files are lit (and named) now, and what every other file is; null when nothing is in
   * focus (no thread open: the map as it is). With a thread open it's the recent window, the files of the moments
   * (Track rows) from the cursor back N (the "On the map, show" setting): what they changed in its own recency colours,
   * what they read quieter (with "Show reads" on), the rest dimmed back with no names. As the cursor moves (live, a
   * replay, scrolling the Track tab) files enter and leave it, and `look` below eases each one. "The whole thread": at
   * rest its whole footprint, in a replay the fog of its last few moments. A thread that changed nothing lights nothing,
   * as its "Changed no files" says. Cached per cursor: it's read for every file (twice per Metro line) on every frame,
   * so the cache test compares fields and builds nothing.
   */
  const cache = useRef<{ index: number; mode: string; win: StepWindow | null; reads: boolean; thread: Thread | null; focus: Focus | null }>(
    { index: -1, mode: "", win: null, reads: false, thread: null, focus: null });
  const focus = useCallback((): Focus | null => {
    const s = st.current;
    if (!s.active || !s.thread) return null;
    const win: StepWindow = getStepWindow(), reads = mapPrefs.showReads, c = cache.current;
    if (c.thread === s.thread && c.index === s.index && c.mode === s.mode && c.win === win && c.reads === reads) return c.focus;
    const { beatFiles, touchedAt, editsAt } = dataRef.current;
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
    const f: Focus = { files, rest: { alpha: DIM } };
    cache.current = { index: s.index, mode: s.mode, win, reads, thread: s.thread, focus: f };
    return f;
  }, []);
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
  const nodeAlpha = useCallback((id: string) => look(id)?.alpha ?? 1, [look]);

  // The numbered stops for a cursor: draw() and marks() both ask, every frame.
  const stopsCache = useRef<{ thread: Thread | null; mi: number; fog: number; cur: string | null; stops: Map<string, number> }>(
    { thread: null, mi: -2, fog: 0, cur: null, stops: new Map() });
  const stopsAt = useCallback((thread: Thread, mi: number, fog: number, cur: string | null) => {
    const c = stopsCache.current;
    if (c.thread === thread && c.mi === mi && c.fog === fog && c.cur === cur) return c.stops;
    const stops = stopsOf(thread.moves, mi, fog, cur, dataRef.current.firstVisit);
    stopsCache.current = { thread, mi, fog, cur, stops };
    return stops;
  }, []);

  const draw = useCallback((ctx: CanvasRenderingContext2D, scale: number) => {
    const s = st.current;
    if (!s.active || !s.thread || s.len === 0 || s.mode === "footprint") return;
    const { beats, moves } = s.thread;
    const beat = beats[s.index];
    if (!beat) return;
    const t = performance.now();
    const a = anim.current;
    const nodes = nodeIndexRef.current;
    const pos = (id: string) => { const n = nodes?.get(id); return n && n.x !== undefined && n.y !== undefined ? { x: n.x, y: n.y, r: n.r } : undefined; };
    if (a.lastIndex !== s.index) { a.lastIndex = s.index; a.beatAt = t; }
    const mi = beat.moveIndex;

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const style = mapStyle(), metro = style.route === "metro", routed = style.route !== "glide";
    const line = style.track ?? accent;   // Metro: the thread is its own ink line, apart from the folder lines

    // Marker target: just off the file's top-right, like the live agents.
    const markerAt = (id: string) => { const n = pos(id); return n ? platform(n.x, n.y, n.r, scale) : undefined; };
    const curFile = mi >= 0 ? moves[mi].file : null;
    const target = curFile ? markerAt(curFile) : undefined;
    let trip: ReturnType<typeof routePoints> | null = null, tp = 1, te = 1;
    if (target) {
      if (a.file === null) { a.x = a.fromX = target.x; a.y = a.fromY = target.y; a.t0 = -1e9; a.file = curFile; }
      else if (a.file !== curFile) { a.fromX = a.x; a.fromY = a.y; a.t0 = t; a.file = curFile; }
      const p = Math.min(1, (t - a.t0) / tripMs(style.route, GLIDE_MS, s.speed)), e = ease(p);
      if (routed && p < 1) { trip = routePoints(style.route, a.fromX, a.fromY, target.x, target.y); tp = p; te = e; const q = along(trip, e); a.x = q.x; a.y = q.y; }  // ride the route
      else { a.x = a.fromX + (target.x - a.fromX) * e; a.y = a.fromY + (target.y - a.fromY) * e; }
      if (style.route === "hop" && p >= 1 && a.t0 > 0 && a.landedT0 !== a.t0 && curFile) { a.landedT0 = a.t0; landings.set(curFile, t); }
    } else if (!curFile) {
      a.file = null;
    }

    // Camera target: the marker; on a read, between the marker and the file read so both stay in view.
    const readPos = beat.action === "read" && beat.file ? pos(beat.file) : undefined; // the last file of a read group
    a.cam = target && readPos ? { x: (a.x + readPos.x) / 2, y: (a.y + readPos.y) / 2 } : target ? { x: a.x, y: a.y } : readPos ? { x: readPos.x, y: readPos.y } : null;
    kickCamera(ctx);

    // Tracer path through the moves of the recent window only (the "On the map, show" setting; the whole thread: its last
    // few moments), newest segments strongest, each fading out as it leaves. What came before isn't drawn: the Track tab has it.
    // Routed themes: the track runs between the marker's stops, not the files' centres, so a trip back retraces the same track.
    const win = getStepWindow(), fogBefore = s.index - (win === "all" ? WINDOW : win); // the path fades with the focus
    const stop = routed ? markerAt : pos;
    const first = Math.max(1, firstMoveFrom(moves, fogBefore, mi + 1));   // the first segment that ends inside the window
    for (let k = first; k <= mi; k++) {
      const p0 = stop(moves[k - 1].file);
      const p1 = k === mi && target ? { x: a.x, y: a.y } : stop(moves[k].file);
      if (!p0 || !p1) continue;
      const w = Math.pow(0.9, mi - k), tail = Math.min(1, (moves[k].beatIndex - fogBefore + 1) / TAPER);
      ctx.globalAlpha = (0.12 + 0.63 * w) * tail;
      ctx.strokeStyle = line;
      ctx.lineWidth = (1.1 + 2 * w) / scale;
      const mx = (p0.x + p1.x) / 2, my = (p0.y + p1.y) / 2, dx = p1.x - p0.x, dy = p1.y - p0.y;
      if (routed) { polyPath(ctx, routePoints(style.route, p0.x, p0.y, p1.x, p1.y)); if (metro) casing(ctx, scale); }  // the way it went
      else { ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.quadraticCurveTo(mx - dy * 0.15, my + dx * 0.15, p1.x, p1.y); }
      ctx.stroke();
    }

    // Numbered stops: each file visited within the window shows its latest stop number (top-left of the file).
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${BADGE_FONT / scale}px ${font}`;
    for (const [file, k] of stopsAt(s.thread, mi, fogBefore, curFile)) {
      const n = pos(file);
      if (!n) continue;
      const label = String(k + 1);
      const { x: bx, y: by } = badgeAt(n, scale);
      const h = 15 / scale, wdt = Math.max(h, ctx.measureText(label).width + 8 / scale);
      ctx.globalAlpha = 0.5 + 0.5 * Math.pow(0.9, mi - k);
      ctx.beginPath();
      ctx.roundRect(bx - wdt / 2, by - h / 2, wdt, h, h / 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.lineWidth = 1.4 / scale;
      ctx.strokeStyle = line;
      ctx.stroke();
      ctx.fillStyle = line;
      ctx.fillText(label, bx, by + 0.5 / scale);
    }

    // Read flash: a hollow ring on each file read (a group of reads flashes them all); the tracer stays put.
    if (beat.action === "read" && mapPrefs.showReads) for (const readFile of beat.files) {
      const n = pos(readFile);
      if (n) {
        const p = Math.min(1, (t - a.beatAt) / FLASH_MS);
        ctx.lineWidth = 2 / scale;
        ctx.strokeStyle = line;
        if (p < 1) {
          ctx.globalAlpha = 0.9 * (1 - p);
          ctx.beginPath(); ctx.arc(n.x, n.y, n.r + (3 + p * 16) / scale, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.globalAlpha = 0.45;
        ctx.setLineDash([3 / scale, 3 / scale]);
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r + 4 / scale, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
        if (readFile !== beat.file) continue; // one label per group: on the last file read
        const more = beat.files.length - 1;
        const label = more > 0 ? `Read ${baseName(readFile)} +${more}` : `Read ${baseName(readFile)}`;
        ctx.font = `600 ${11.5 / scale}px ${font}`;
        ctx.textAlign = "center"; ctx.textBaseline = "bottom";
        const ly = n.y - n.r - 8 / scale;
        ctx.globalAlpha = 1;
        ctx.lineWidth = 3.5 / scale; ctx.strokeStyle = mapStyle().halo; ctx.strokeText(label, n.x, ly); // the theme's outline: light, or dark in Prism / Hologram
        ctx.fillStyle = line; ctx.fillText(label, n.x, ly);
      }
    }

    // Current marker with a soft halo. Red, with one red ring, when this beat has a failed tool call.
    const failed = beat.failed > 0;
    const mark = failed ? RED : line;
    const ownMarker = !s.live || !liveShown?.current;
    if (target && curFile && ownMarker) {
      if (trip) drawTrip(ctx, style.route, trip, tp, te, mark, 10 / scale, 1, scale);
      const halo = ctx.createRadialGradient(a.x, a.y, 0, a.x, a.y, 26 / scale);
      halo.addColorStop(0, hexA(mark, 0.28));
      halo.addColorStop(1, hexA(mark, 0));
      ctx.globalAlpha = 1;
      ctx.fillStyle = halo;
      ctx.beginPath(); ctx.arc(a.x, a.y, 26 / scale, 0, Math.PI * 2); ctx.fill();

      if (s.thinking) { // a slow ring in its colour, swelling and fading, like a live agent's (agents.tsx)
        const b = (t % THINK_MS) / THINK_MS;
        ctx.globalAlpha = Math.sin(b * Math.PI) * 0.7;
        ctx.beginPath(); ctx.arc(a.x, a.y, (11 + b * 9) / scale, 0, Math.PI * 2);
        ctx.strokeStyle = line; ctx.lineWidth = 2 / scale; ctx.stroke();
      }
      if (failed) {
        const p = (t - a.beatAt) / ERR_PULSE_MS;
        if (p < 1) {
          ctx.globalAlpha = 0.8 * (1 - p);
          ctx.beginPath(); ctx.arc(a.x, a.y, (10 + p * 28) / scale, 0, Math.PI * 2);
          ctx.strokeStyle = RED; ctx.lineWidth = 2.4 / scale; ctx.stroke();
        }
      } else if (beat.action === "edit") { // pulse on every edit, even when the tracer stays on the same file
        const p = (t - a.beatAt) / PULSE_MS;
        if (p < 1) {
          ctx.globalAlpha = 0.6 * (1 - p);
          ctx.beginPath(); ctx.arc(a.x, a.y, (10 + p * 16) / scale, 0, Math.PI * 2);
          ctx.strokeStyle = line; ctx.lineWidth = 2 / scale; ctx.stroke();
        }
      }

      ctx.globalAlpha = 1;
      const num = String(mi + 1);
      const ms = mapStyle();   // Metro: its line badge; elsewhere a disc ringed white with a white number, in every theme
      if (ms.marker === "badge") drawMarker(ctx, a.x, a.y, 10 / scale, mark, num, num.length > 2 ? 8 : 9.5, ms.labelFont ?? font, scale, ms);
      else drawMarker(ctx, a.x, a.y, 10 / scale, mark, num, num.length > 2 ? 8 : 9.5, font, scale, { ...ms, glow: false, markerStroke: "#fff", markerText: "#fff" });

      const lx = a.x + 14 / scale;
      ctx.textAlign = "left";
      ctx.font = `600 ${12 / scale}px ${font}`;
      ctx.lineWidth = 3.5 / scale; ctx.strokeStyle = mapStyle().halo;
      const name = baseName(curFile);
      ctx.strokeText(name, lx, a.y); ctx.fillStyle = mark; ctx.fillText(name, lx, a.y);
      if (beat.outside) {
        const note = "outside project";
        ctx.font = `500 ${11 / scale}px ${font}`;
        const ny = a.y + 14 / scale;
        ctx.strokeText(note, lx, ny); ctx.fillStyle = hexA(INK, 0.55); ctx.fillText(note, lx, ny);
      }
    }
    ctx.restore();
  }, [accent, font, nodeIndexRef, stopsAt, kickCamera]);

  const marks = useCallback((ctx: CanvasRenderingContext2D, scale: number) => {
    const s = st.current, boxes: Box[] = [];
    const beat = s.active && s.thread && s.mode !== "footprint" ? s.thread.beats[s.index] : undefined;
    if (!beat || !s.thread) return { boxes, named: null };
    const { moves } = s.thread, mi = beat.moveIndex, curFile = mi >= 0 ? moves[mi].file : null, nodes = nodeIndexRef.current;
    const h = 15 / scale, pad = 2 / scale, win = getStepWindow();
    for (const [file, k] of stopsAt(s.thread, mi, s.index - (win === "all" ? WINDOW : win), curFile)) {   // as draw() does
      const n = nodes?.get(file);
      if (n?.x === undefined || n.y === undefined) continue;
      const b = badgeAt({ x: n.x, y: n.y, r: n.r }, scale), w = Math.max(h, (String(k + 1).length * BADGE_FONT * 0.62 + 8) / scale);
      boxes.push({ x0: b.x - w / 2 - pad, x1: b.x + w / 2 + pad, y0: b.y - h / 2 - pad, y1: b.y + h / 2 + pad });
    }
    const a = anim.current;
    if (curFile && a.file === curFile && (!s.live || !liveShown?.current)) {   // the marker (where it is this frame) and its name to the right
      ctx.save(); ctx.font = `600 ${NAME_FONT / scale}px ${font}`;
      const w = ctx.measureText(baseName(curFile)).width; ctx.restore();
      const m = (MARK_R + 3) / scale;
      boxes.push({ x0: a.x - m, x1: a.x + m, y0: a.y - m, y1: a.y + m });
      boxes.push({ x0: a.x + 12 / scale, x1: a.x + 16 / scale + w, y0: a.y - 9 / scale, y1: a.y + (beat.outside ? 23 : 9) / scale });
    }
    const read = beat.action === "read" && mapPrefs.showReads && beat.file ? nodes?.get(beat.file) : undefined;
    if (read?.x !== undefined && read.y !== undefined) {   // "Read x.ts +2", above the last file read
      ctx.save(); ctx.font = `600 ${11.5 / scale}px ${font}`;
      const more = beat.files.length - 1, w = ctx.measureText(`Read ${baseName(beat.file!)}${more > 0 ? ` +${more}` : ""}`).width; ctx.restore();
      const by = read.y - read.r - 8 / scale;
      boxes.push({ x0: read.x - w / 2 - pad, x1: read.x + w / 2 + pad, y0: by - 14 / scale, y1: by + pad });
    }
    return { boxes, named: curFile };
  }, [font, nodeIndexRef, stopsAt]);

  const footprint = useCallback(() => {
    const s = st.current, f = focus();
    if (!s.active || !s.thread || !f) return null;
    if (f.files.size) return [...f.files.keys()];
    // Nothing in the window touched a file (talk, commands): frame where the tracer stands, if it stands anywhere.
    const mi = s.thread.beats[s.index]?.moveIndex ?? -1;
    return mi >= 0 ? [s.thread.moves[mi].file] : [];
  }, [focus]);
  const subject = useCallback(() => (st.current.active && st.current.mode !== "footprint" ? anim.current.cam : null), []);
  const touches = useCallback((id: string) => !!st.current.thread?.touched.has(id), []);

  return { active, thinking, tracing: active && mode !== "footprint", playable, footprintMode: active && mode === "footprint", footprint, touches, subject, nodeAlpha, look, draw, marks };
}

/**
 * Play/pause from the step you're on, whatever it is (a thread opened with no step picked is on its last). At the last
 * one the player opens there, paused, and you go back from it (scrolling the Track, ←, Home or the slider): it never
 * jumps to the first step by itself. Shared by the keyboard and the ReplayBar.
 */
export function togglePlay(playing: boolean, setPlaying: (p: boolean) => void) {
  setPlaying(!playing);
}

function hexA(c: string, alpha: number) {
  const h = c.trim().replace("#", "");
  if (!/^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(h)) return `rgba(37,99,235,${alpha})`;
  const n = parseInt(h.length === 3 ? h.split("").map((x) => x + x).join("") : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
