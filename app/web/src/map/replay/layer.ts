// Owner: replay agent. Map-canvas side of the thread replay: tracer, stops, read flashes, dimming,
// camera follow, playback, keyboard and wheel-to-scrub.
import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import type { ForceGraphMethods } from "react-force-graph-2d";
import { mapPrefs, replayCursor, useNav } from "../../lib/nav";
import { useThread, type Thread } from "../../lib/thread";
import { replayCamera, USER_CAMERA_MS } from "./store";
import type { Camera } from "../camera";
import { along, casing, drawTrip, landings, mapStyle, platform, polyPath, routePoints, tripMs } from "../themes";

export type NodePos = { x?: number; y?: number; r: number };

export type ReplayLayerApi = {
  /** True while a thread replay is on (nav.replay is set and its thread is loaded). */
  active: boolean;
  /** Alpha for a node during replay: 1 = normal, lower = dimmed (not touched by the thread). */
  nodeAlpha: (id: string) => number;
  /** True while the tracer is drawn (a replay or steps, not the footprint): Metro quiets the import lines then. */
  tracing: boolean;
  /** The thread's footprint mode (its files lit, no tracer): MapView frames it. */
  footprintMode: boolean;
  /** The files the open thread touched (what a fit frames), or null with no thread open. */
  footprint: () => string[] | null;
  /** Draw the tracer, numbered stops, the current marker and read flashes. Called every frame after the agent layer. */
  draw: (ctx: CanvasRenderingContext2D, scale: number) => void;
};

const GLIDE_MS = 650;       // same glide as the live agent markers (map/agents.tsx)
const FLASH_MS = 600;       // read flash
const PULSE_MS = 700;       // edit pulse on the marker
const RED = "#d93025";      // a beat with a failed tool call
const ERR_PULSE_MS = 1100;
const DIM = 0.18;           // files the thread never touches (or hasn't reached yet, in a replay)
const PAST = 0.42;          // files it touched earlier than the window below
/** Fog of war: in a replay, only the last few moments are drawn in full (path, numbers, files); older ones fade back. */
const WINDOW = 25;
const BEAT_PX = 60;         // trackpad pixels per beat
const OTHER_MS = 120;       // playback pace for single "other" steps (every-step detail)
const SUMMARY_MS = 380;     // playback pace for summary beats (light detail)
const READ_MS = 520;        // playback pace for reads
const STEP_MS = 700;        // playback pace for edits and your prompts (at 1×)

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const baseName = (p: string) => p.split("/").pop() || p;
const INK = "#1d1d1f";
const HALO = "rgba(251,251,253,0.95)";

type Anim = { x: number; y: number; fromX: number; fromY: number; t0: number; file: string | null; lastIndex: number; beatAt: number;
  cam: { x: number; y: number } | null; landedT0?: number };

function isTyping(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
}

export function useReplayLayer({ fg, wrapRef, nodeIndexRef, accent, font, camera }: {
  fg: RefObject<ForceGraphMethods | undefined>;
  wrapRef: RefObject<HTMLDivElement | null>;
  nodeIndexRef: RefObject<Map<string, NodePos>>;
  accent: string;
  font: string;
  /** MapView's camera: the follow keeps the marker in the middle of the part of the map no panel covers. */
  camera: RefObject<Camera>;
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
  // Publish the step at the cursor so the URL can link to it (read by nav's URL effect in this same commit).
  replayCursor.stepId = active && !replay?.atStep ? thread!.beats[index]?.step.id ?? null : replayCursor.stepId;

  // Land on a step id (links, Follow, switching detail) once the thread is built.
  useEffect(() => {
    if (!active || !replay?.atStep) return;
    landReplay(thread!.stepBeat.get(replay.atStep) ?? 0);
  }, [active, replay?.atStep, thread, landReplay]);

  replayCamera.fg = fg;
  replayCamera.safe = camera.current.safe;

  const speed = replay?.speed ?? 1;
  const st = useRef<{ active: boolean; thread: Thread | null; index: number; len: number; mode: string; speed: number }>({ active, thread, index, len, mode, speed });
  st.current = { active, thread, index, len, mode, speed };
  const anim = useRef<Anim>({ x: 0, y: 0, fromX: 0, fromY: 0, t0: -1e9, file: null, lastIndex: -1, beatAt: -1e9, cam: null });

  // Bounds: clamp the cursor whenever the thread (or its length) changes.
  useEffect(() => {
    if (active && replay && !replay.atStep && replay.index > last) setReplayIndex(last); // not while landing on a step
  }, [active, last, replay?.index, replay?.atStep, setReplayIndex]);

  // A new replay: fresh marker and camera.
  useEffect(() => {
    anim.current = { x: 0, y: 0, fromX: 0, fromY: 0, t0: -1e9, file: null, lastIndex: -1, beatAt: -1e9, cam: null };
    if (replay?.sessionId) replayCamera.recenter();
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

  // ---- footprint: MapView frames the files the thread touched (fitAll there), in the part of the map no panel covers ----

  // ---- keyboard ----
  const replayPlayingRef = useRef(false);
  replayPlayingRef.current = !!replay?.playing;
  useEffect(() => {
    if (!playable) return;
    const step = (d: number) => { setReplayPlaying(false); setReplayIndex((i) => Math.max(0, Math.min(st.current.len - 1, i + d))); };
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      switch (e.key) {
        case "ArrowRight": step(e.shiftKey ? 10 : 1); break;
        case "ArrowLeft": step(e.shiftKey ? -10 : -1); break;
        case "Home": setReplayPlaying(false); setReplayIndex(0); break;
        case "End": setReplayPlaying(false); setReplayIndex(st.current.len - 1); break;
        case " ": {
          if ((e.target as HTMLElement | null)?.tagName === "BUTTON") return; // let the focused button click
          togglePlay(st.current.index, st.current.len, replayPlayingRef.current, setReplayIndex, setReplayPlaying);
          break;
        }
        default: return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playable, setReplayIndex, setReplayPlaying]);
  // ---- wheel scrubs, pinch / ⌘-wheel zooms; user camera moves pause the follow ----
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !playable) return;
    let acc = 0, lastWheel = 0;
    const onWheel = (e: WheelEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName !== "CANVAS" && !t.closest?.(".rp-bar")) return;
      if (e.ctrlKey || e.metaKey) { replayCamera.userMoved(); replayCamera.targetZoom = null; return; } // zoom as usual
      e.preventDefault();
      e.stopPropagation();
      const now = performance.now();
      if (now - lastWheel > 250) acc = 0;
      lastWheel = now;
      const dy = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      let n = 0;
      if (e.deltaMode !== 0) { n = Math.sign(dy) * Math.max(1, Math.round(Math.abs(dy) / 3)); acc = 0; } // lines: ~3 per notch
      else if (Math.abs(dy) >= 90 && Number.isInteger(dy)) { n = Math.sign(dy) * Math.max(1, Math.round(Math.abs(dy) / 100)); acc = 0; } // mouse notches
      else { acc += dy; n = Math.trunc(acc / BEAT_PX); acc -= n * BEAT_PX; }
      if (!n) return;
      setReplayPlaying(false);
      setReplayIndex((i) => Math.max(0, Math.min(st.current.len - 1, i + n)));
    };
    const pointers = new Map<number, { x: number; y: number }>();
    const onDown = (e: PointerEvent) => { if ((e.target as HTMLElement).tagName === "CANVAS") pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); };
    const onMove = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId);
      if (!p || Math.hypot(e.clientX - p.x, e.clientY - p.y) < 4) return;
      replayCamera.userMoved();
      if (pointers.size > 1) replayCamera.targetZoom = null; // pinch
    };
    const onUp = (e: PointerEvent) => { pointers.delete(e.pointerId); };
    el.addEventListener("wheel", onWheel, { passive: false, capture: true });
    el.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
    return () => {
      el.removeEventListener("wheel", onWheel, { capture: true });
      el.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
    };
  }, [playable, wrapRef, setReplayIndex, setReplayPlaying]);

  // ---- camera: ease toward the marker unless the user moved the camera recently ----
  useEffect(() => {
    if (!active || mode === "footprint") return;
    let raf = 0;
    const tick = () => {
      const g = fg.current;
      const a = anim.current;
      const cam = camera.current;
      // After a fit, the camera stays on the whole thread while the marker is in sight; the user taking over the camera,
      // or the marker leaving the uncovered part of the map, hands it back to the follow.
      if (g && a.cam && replayCamera.heldAt !== null) {
        const s = cam.safe.current, c = g.centerAt() as unknown as { x: number; y: number }, z = g.zoom();
        const sx = s.w / 2 + (a.cam.x - c.x) * z, sy = s.h / 2 + (a.cam.y - c.y) * z, m = 24;
        const inSight = sx > s.left + m && sx < s.w - s.right - m && sy > s.top + m && sy < s.h - s.bottom - m;
        if (!inSight || Math.max(replayCamera.userAt, cam.userAt()) > replayCamera.heldAt) replayCamera.heldAt = null;
      }
      if (g && a.cam && replayCamera.heldAt === null && performance.now() - Math.max(replayCamera.userAt, cam.userAt()) > USER_CAMERA_MS) {
        // The marker goes to the middle of the part of the map no panel covers, not under the sidebar.
        cam.easeToward(a.cam.x, a.cam.y, 0.08);
        const z = g.zoom();
        const tz = replayCamera.targetZoom;
        if (tz && Math.abs(z - tz) > 0.01) g.zoom(z + (tz - z) * 0.06);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, mode, fg, camera]);

  // For the fog: the moments at which each file was touched (edited or read), in order.
  const touchedAt = useMemo(() => {
    const m = new Map<string, number[]>();
    for (const b of thread?.beats ?? []) for (const f of new Set([...b.files, ...(b.file ? [b.file] : [])])) m.set(f, [...(m.get(f) ?? []), b.index]);
    return m;
  }, [thread]);
  const touchedRef = useRef(touchedAt); touchedRef.current = touchedAt;

  const nodeAlpha = useCallback((id: string) => {
    const s = st.current;
    if (!s.active || !s.thread || !s.thread.touched.size) return 1; // a thread with no files leaves the map as it is (see TalkCard)
    if (s.mode === "footprint") return s.thread.touched.has(id) ? 1 : DIM; // the whole footprint at once
    // Steps and replay: files light up as the thread reaches them, and fade back once they're out of the last few moments.
    const at = touchedRef.current.get(id);
    if (!at) return DIM;
    let last = -1;
    for (const i of at) { if (i > s.index) break; last = i; }
    return last < 0 ? DIM : s.index - last <= WINDOW ? 1 : PAST;
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

    // Tracer path through moves[0..mi], newest segments strongest; segments older than the window are a faint thread.
    // Routed themes: the track runs between the marker's stops, not the files' centres, so a trip back retraces the same track.
    const fogBefore = s.index - WINDOW;
    const stop = routed ? markerAt : pos;
    for (let k = 1; k <= mi; k++) {
      const p0 = stop(moves[k - 1].file);
      const p1 = k === mi && target ? { x: a.x, y: a.y } : stop(moves[k].file);
      if (!p0 || !p1) continue;
      const old = moves[k].beatIndex < fogBefore;
      const w = old ? 0 : Math.pow(0.9, mi - k);
      ctx.globalAlpha = old ? 0.07 : 0.12 + 0.63 * w;
      ctx.strokeStyle = line;
      ctx.lineWidth = (old ? 1 : 1.1 + 2 * w) / scale;
      const mx = (p0.x + p1.x) / 2, my = (p0.y + p1.y) / 2, dx = p1.x - p0.x, dy = p1.y - p0.y;
      if (routed) { polyPath(ctx, routePoints(style.route, p0.x, p0.y, p1.x, p1.y)); if (metro && !old) casing(ctx, scale); }  // the way it went
      else { ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.quadraticCurveTo(mx - dy * 0.15, my + dx * 0.15, p1.x, p1.y); }
      ctx.stroke();
    }

    // Numbered stops: each file visited within the window shows its latest stop number (top-left of the file).
    const lastVisit = new Map<string, number>();
    for (let k = 0; k <= mi; k++) lastVisit.set(moves[k].file, k);
    for (const [file, k] of lastVisit) if (moves[k].beatIndex < fogBefore) lastVisit.delete(file);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${9.5 / scale}px ${font}`;
    for (const [file, k] of lastVisit) {
      if (file === curFile) continue;
      const n = pos(file);
      if (!n) continue;
      const label = String(k + 1);
      const d = n.r + 8 / scale, ang = (-3 * Math.PI) / 4;
      const bx = n.x + Math.cos(ang) * d, by = n.y + Math.sin(ang) * d;
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
        ctx.lineWidth = 3.5 / scale; ctx.strokeStyle = HALO; ctx.strokeText(label, n.x, ly);
        ctx.fillStyle = line; ctx.fillText(label, n.x, ly);
      }
    }

    // Current marker with a soft halo. Red, with one red ring, when this beat has a failed tool call.
    const failed = beat.failed > 0;
    const mark = failed ? RED : line;
    if (target && curFile) {
      if (trip) drawTrip(ctx, style.route, trip, tp, te, mark, 10 / scale, 1, scale);
      const halo = ctx.createRadialGradient(a.x, a.y, 0, a.x, a.y, 26 / scale);
      halo.addColorStop(0, hexA(mark, 0.28));
      halo.addColorStop(1, hexA(mark, 0));
      ctx.globalAlpha = 1;
      ctx.fillStyle = halo;
      ctx.beginPath(); ctx.arc(a.x, a.y, 26 / scale, 0, Math.PI * 2); ctx.fill();

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
      ctx.shadowColor = "rgba(0,0,0,0.18)"; ctx.shadowBlur = 6; ctx.shadowOffsetY = 1;
      ctx.beginPath(); ctx.arc(a.x, a.y, 10 / scale, 0, Math.PI * 2);
      ctx.fillStyle = mark; ctx.fill();
      ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
      ctx.lineWidth = 2 / scale; ctx.strokeStyle = "#fff"; ctx.stroke();
      const num = String(mi + 1);
      ctx.fillStyle = "#fff";
      ctx.font = `700 ${(num.length > 2 ? 8 : 9.5) / scale}px ${font}`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(num, a.x, a.y + 0.5 / scale);

      const lx = a.x + 14 / scale;
      ctx.textAlign = "left";
      ctx.font = `600 ${12 / scale}px ${font}`;
      ctx.lineWidth = 3.5 / scale; ctx.strokeStyle = HALO;
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
  }, [accent, font, nodeIndexRef]);

  const footprint = useCallback(() => {
    const s = st.current;
    return s.active && s.thread ? [...s.thread.touched.keys()] : null;
  }, []);

  return { active, tracing: active && mode !== "footprint", footprintMode: active && mode === "footprint", footprint, nodeAlpha, draw };
}

/** Play/pause; pressing play at the last beat starts over. Shared by the keyboard and the ReplayBar. */
export function togglePlay(index: number, len: number, playing: boolean,
  setIndex: (i: number) => void, setPlaying: (p: boolean) => void) {
  if (playing) { setPlaying(false); return; }
  if (index >= len - 1) setIndex(0);
  setPlaying(true);
}

function hexA(c: string, alpha: number) {
  const h = c.trim().replace("#", "");
  if (!/^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(h)) return `rgba(91,91,214,${alpha})`;
  const n = parseInt(h.length === 3 ? h.split("").map((x) => x + x).join("") : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
