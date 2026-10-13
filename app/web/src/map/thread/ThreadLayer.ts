// Map-canvas side of the thread replay: the tracer, its marker and read flashes, drawn here; the focus (which
// files are lit and named: focus.ts), the camera follow (follow.ts) and playback with its keys (playback.ts) composed.
// The wheel zooms the map: scrubbing is the Track tab's scroll, the arrow keys and the player's slider.
import { useCallback, useEffect, useRef, type RefObject } from "react";
import { mapPrefs, useNavActions, useReplay } from "../../lib/nav";
import { useThread, type Thread } from "../../lib/thread";
import { useLiveSelector } from "../../lib/live";
import type { Camera, ReplayCamera } from "../camera";
import { getStepWindow } from "../prefs";
import { mapStyle } from "../themes";
import { drawMarker } from "../marks";
import { drawTrip, platform } from "../routes";
import { PARK } from "../agents";

/** Where the marker stands at a beat: the file of its latest move (an edit). Before the first edit, on the first file the
 *  thread touches at all, so it stands on a real file and still doesn't move on reads; only a thread that touches no
 *  file waits at the top of the project. */
const firstFiles = new WeakMap<Thread, string>();
function standsOn(thread: Thread, index: number): string {
  const mi = thread.beats[index]?.moveIndex ?? -1;
  if (mi >= 0) return thread.moves[mi].file;
  let first = firstFiles.get(thread);
  if (first === undefined) {
    first = thread.beats.find((b) => b.file)?.file ?? PARK;
    firstFiles.set(thread, first);
  }
  return first;
}
import { drawPulse, drawThinkRing, ERR_PULSE_MS, ERROR_RED as RED, glide, PULSE_MS, setOff, trailPath } from "../tracer";
import { useFocus, WINDOW, type Look } from "./focus";
import { useReplayFollow } from "./follow";
import { useReplayPlayback } from "./playback";
import { hexA } from "../color";

export type NodePos = { x?: number; y?: number; r: number };
export type { Look } from "./focus";
export { togglePlay } from "./playback";

export type ThreadLayerApi = {
  /** True while a thread replay is on (nav.thread is set and its thread is loaded). */
  active: boolean;
  /** Alpha for a node during replay: 1 = normal, lower = dimmed (not touched by the thread). */
  nodeAlpha: (id: string) => number;
  /** How a file reads in the focus (eased), or null when nothing is in focus and its fade is over: the map as it is. */
  look: (id: string) => Look | null;
  /** True while the tracer is drawn (a thread is open): Metro quiets the import lines then. */
  tracing: boolean;
  /** At the thread's last step while its agent thinks. */
  thinking: boolean;
  /** The last frame drew the replay marker's thinking ring: MapView keeps slow frames coming only then. */
  ringing: () => boolean;
  /** The player is open (a replay, playing or paused): the arrow keys step through it, not move the map. */
  playable: boolean;
  /** The files in focus (what a fit frames: the recent window, or the whole thread), or null with no thread open. */
  footprint: () => string[] | null;
  /** Whether the open thread touched a file at all (read or changed), at any point. */
  touches: (id: string) => boolean;
  /** Looking back through the thread (the tracer drawn, not live): the files read at the moment the cursor is on, or
   *  at the last read before it (up to a few moments back), newest first, or none; null when not looking back. The
   *  readmap shows them (none: the whole project, not what the agents read now). */
  readsNow: () => string[] | null;
  /** The tracer's camera target (the marker), or null: what a locked camera centres. */
  subject: () => { x: number; y: number } | null;
  /** Draw the tracer, the current marker and read flashes. Called every frame after the agent layer. */
  draw: (ctx: CanvasRenderingContext2D, scale: number) => void;
  /** Where draw() will put the marker and its name this frame, so file names keep off them;
   *  and the file the marker names (its own label would say the same thing twice). */
  marks: (ctx: CanvasRenderingContext2D, scale: number) => { boxes: Box[]; named: string | null };
};
type Box = { x0: number; y0: number; x1: number; y1: number };

const FLASH_MS = 600;       // read flash
const READS_BACK = 8;       // how many moments back the Readmap still shows the last read (readsNow)
const TAPER = 3;            // a tracer segment fades out over its last few moments in the window, so the trail doesn't end in a cut

/** The first move at or after a beat (binary search over the moves' beat indexes, up to `hi`). */
function firstMoveFrom(moves: Thread["moves"], beat: number, hi: number) {
  let lo = 0;
  while (lo < hi) { const m = (lo + hi) >> 1; if (moves[m].beatIndex < beat) lo = m + 1; else hi = m; }
  return lo;
}
const MARK_R = 10, NAME_FONT = 12;
import { basename as baseName } from "@shared/text";
const INK = "#1d1d1f";

type Anim = { x: number; y: number; fromX: number; fromY: number; t0: number; file: string | null; lastIndex: number; beatAt: number;
  cam: { x: number; y: number } | null; landedT0?: number };


export function useThreadLayer({ nodeIndexRef, accent, font, camera, follow, land, liveShown }: {
  nodeIndexRef: RefObject<Map<string, NodePos>>;
  accent: string;
  font: string;
  /** MapView's camera: the follow keeps the marker in the middle of the part of the map no panel covers. */
  camera: RefObject<Camera>;
  /** What the follow asks of the map's camera: where it gave up on the tracer, how far in counts as in view, a pinned file. */
  follow: RefObject<ReplayCamera>;
  /** The marker landed on a file (Prism's hop: its cube spins up and flashes). */
  land: (id: string, t: number) => void;
  /** Whether the live layer draws the thread's agent where it is now. Following live, the replay's marker stands in for
   *  it only if it's gone (the server forgets an agent after half an hour). Looking back, this marker is the agent's one
   *  marker, solid, where it was then; the live layer shows where it works now only as a small ring (agents.tsx `behind`). */
  liveShown?: RefObject<boolean>;
}): ThreadLayerApi {
  const replay = useReplay();
  const { setReplayIndex, setReplayPlaying, landReplay, setCursorStep } = useNavActions();
  const thread = useThread(replay?.sessionId ?? null, replay?.detail ?? "light");
  const active = !!replay && !!thread && thread.sessionId === replay.sessionId && thread.detail === replay.detail;
  // A thread opens on its steps. The keys and the wheel drive the replay only once it plays.
  const mode = replay?.mode ?? "steps";
  const playable = active && mode === "play";
  const len = active ? thread!.beats.length : 0;
  const last = Math.max(0, len - 1);
  const index = replay ? Math.min(replay.index, last) : 0;
  // Publish the step at the cursor (switching the detail lands on it). After every commit,
  // as the render used to do, but outside the render.
  const cursorStep = active && !replay?.atStep ? thread!.beats[index]?.step.id ?? null : undefined;
  useEffect(() => { if (cursorStep !== undefined) setCursorStep(cursorStep); });

  // Landing on a step id (links, Follow, switching detail) is App's LandStep: on every lens, before live-follow.

  // Following live, the thread's own agents are drawn by the live layer (each in its colour): no single cursor marker.
  const live = !!replay?.live;
  // The thread is mid-turn and the model hasn't answered yet: at its last step, the marker shows it's thinking.
  const thinking = useLiveSelector((s) => !!replay && s.attention[replay.sessionId]?.state === "thinking") && active && index >= last;
  const st = useRef<{ active: boolean; thread: Thread | null; index: number; len: number; mode: string; live: boolean; thinking: boolean }>({ active, thread, index, len, mode, live, thinking });
  st.current = { active, thread, index, len, mode, live, thinking };
  // Only a ring actually drawn needs frames: following a live thread, the agent's own marker (agents.tsx, CSS ring)
  // stands there instead, and before its first move there is no marker at all.
  const ringDrawn = useRef(false);
  const ringing = useCallback(() => ringDrawn.current, []);
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

  // ---- playback and its keys (playback.ts) ----
  useReplayPlayback({ active, replay, thread, index, last, st, setReplayIndex, setReplayPlaying });

  // ---- camera (follow.ts) ----
  const kickCamera = useReplayFollow({ active, mode, camera, follow, target: () => anim.current.cam });

  // ---- the focus (focus.ts) ----
  const { focus, look } = useFocus(st, thread);
  const nodeAlpha = useCallback((id: string) => look(id)?.alpha ?? 1, [look]);

  const draw = useCallback((ctx: CanvasRenderingContext2D, scale: number) => {
    const s = st.current;
    ringDrawn.current = false;
    if (!s.active || !s.thread || s.len === 0) return;
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
    const style = mapStyle(), routed = style.route !== "glide";
    const line = style.track ?? accent;   // Metro: the thread is its own ink line, apart from the folder lines

    // Marker target: just off the file's top-right, like the live agents.
    const markerAt = (id: string) => { const n = pos(id); return n ? platform(n.x, n.y, n.r, scale) : undefined; };
    // A step with no file keeps the marker where it last was; before the first edit, on the thread's first file (standsOn).
    const curFile = standsOn(s.thread, s.index);
    const target = curFile ? markerAt(curFile) : undefined;
    let trip: ReturnType<typeof glide>["trip"] = null, tp = 1, te = 1;
    if (target) {
      if (a.file === null) { a.x = a.fromX = target.x; a.y = a.fromY = target.y; a.t0 = -1e9; a.file = curFile; }
      else if (a.file !== curFile) { setOff(a, t); a.file = curFile; }
      const g = glide(a, target.x, target.y, t, style.route, 1, () => { if (curFile) land(curFile, t); });
      if (g.trip) { trip = g.trip; tp = g.p; te = g.e; }
    } else if (!curFile) {
      a.file = null;
    }

    // Camera target: the marker, nothing else. A read doesn't move the camera (the Readmap and the read lines show it).
    a.cam = target ? { x: a.x, y: a.y } : null;
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
      ctx.lineWidth = ((1.1 + 2 * w) * (style.trackWidth ?? 1)) / scale;
      trailPath(ctx, p0, p1, style.route, scale);
      ctx.stroke();
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
    // One marker per agent: following live, the live layer's; looking back, this one, solid, where the agent was then.
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
        ringDrawn.current = true;
        drawThinkRing(ctx, a.x, a.y, t, line, 1, scale);
      }
      if (failed) drawPulse(ctx, a.x, a.y, (t - a.beatAt) / ERR_PULSE_MS, 10, 28, RED, 2.4, 0.8, scale);
      else if (beat.action === "edit") drawPulse(ctx, a.x, a.y, (t - a.beatAt) / PULSE_MS, 10, 16, line, 2, 0.6, scale); // pulse on every edit, even when the tracer stays on the same file

      ctx.globalAlpha = 1;
      const num = String(mi + 1);
      const ms = mapStyle();   // Metro: its line badge; elsewhere a disc ringed white with a white number, in every theme
      if (ms.marker === "badge") drawMarker(ctx, a.x, a.y, 10 / scale, mark, num, num.length > 2 ? 8 : 9.5, ms.labelFont ?? font, scale, ms);
      else drawMarker(ctx, a.x, a.y, 10 / scale, mark, num, num.length > 2 ? 8 : 9.5, font, scale, { ...ms, glow: false, markerStroke: "#fff", markerText: "#fff" });

      const lx = a.x + 14 / scale;
      ctx.textAlign = "left";
      ctx.font = `600 ${12 / scale}px ${font}`;
      ctx.lineWidth = 3.5 / scale; ctx.strokeStyle = mapStyle().halo;
      const name = curFile === PARK ? "" : baseName(curFile);
      if (name) { ctx.strokeText(name, lx, a.y); ctx.fillStyle = mark; ctx.fillText(name, lx, a.y); }
      if (beat.outside) {
        const note = "outside project";
        ctx.font = `500 ${11 / scale}px ${font}`;
        const ny = a.y + 14 / scale;
        ctx.strokeText(note, lx, ny); ctx.fillStyle = hexA(INK, 0.55); ctx.fillText(note, lx, ny);
      }
    }
    ctx.restore();
  }, [accent, font, nodeIndexRef, kickCamera]);

  const marks = useCallback((ctx: CanvasRenderingContext2D, scale: number) => {
    const s = st.current, boxes: Box[] = [];
    const beat = s.active && s.thread ? s.thread.beats[s.index] : undefined;
    if (!beat || !s.thread) return { boxes, named: null };
    const curFile = standsOn(s.thread, s.index), nodes = nodeIndexRef.current;
    const pad = 2 / scale, a = anim.current;
    if (curFile && a.file === curFile && (!s.live || !liveShown?.current)) {   // the marker (where it is this frame) and its name to the right
      ctx.save(); ctx.font = `600 ${NAME_FONT / scale}px ${font}`;
      const w = curFile === PARK ? 0 : ctx.measureText(baseName(curFile)).width; ctx.restore();
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
    return { boxes, named: curFile === PARK ? null : curFile };
  }, [font, nodeIndexRef]);

  const footprint = useCallback(() => {
    const s = st.current, f = focus();
    if (!s.active || !s.thread || !f) return null;
    if (f.files.size) return [...f.files.keys()];
    // Nothing in the window touched a file (talk, commands): frame where the tracer stands, if it stands anywhere.
    const mi = s.thread.beats[s.index]?.moveIndex ?? -1;
    return mi >= 0 ? [s.thread.moves[mi].file] : [];
  }, [focus]);
  const subject = useCallback(() => (st.current.active ? anim.current.cam : null), []);
  const touches = useCallback((id: string) => !!st.current.thread?.touched.has(id), []);
  const readsNow = useCallback(() => {
    const s = st.current;
    if (!s.active || !s.thread || s.live) return null;
    for (let i = s.index; i >= 0 && i > s.index - READS_BACK; i--) {
      const b = s.thread.beats[i];
      // A read, or a run of commands that read files (cat, sed -n, grep: the server's `reads`).
      if ((b?.action === "read" || b?.kind === "summary") && b.files.length) return [...b.files].reverse();
    }
    return [];
  }, []);

  return { active, thinking, ringing, tracing: active, playable, footprint, touches, readsNow, subject, nodeAlpha, look, draw, marks };
}

