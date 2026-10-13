// What the map's camera frames and when (moved out of MapView.tsx): the whole project or an open thread's files, the
// open file, and the director (director.ts): the working agents' recent edits, or a replay's next few moves, framed
// together, moving only when they leave the middle of the view. Any hand move (drag, wheel, pinch, arrow keys) hands the
// camera to you; "Follow again" (the pill, F, Esc, opening a step, or a minute without touching it) gives it back.
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { AgentPresence } from "@contract";
import type { ThreadReplay } from "../lib/nav";
import type { ThreadLayerApi } from "./thread/ThreadLayer";
import { boxOf, type Box, type Camera, type ReplayCamera, type View } from "./camera";
import { boxOfPts, DIRECTOR, frameArea, groupAhead, isCut, shouldMove, viewFor, type P } from "./director";
import { useCameraKeys } from "./useCameraKeys";
import type { AgentAnim } from "./agents";
import type { GNode } from "./graph";

// ---- camera intent: what the camera is framing, so it can frame it again when a panel opens or the window resizes ----
// "fit": the whole project (or the open thread's footprint); "file": the open file; "free": the user's own view.
export type Intent = { kind: "fit" } | { kind: "file"; id: string; zoom: boolean } | { kind: "free" };
/** What the camera is doing, in one place. */
type CameraState = {
  intent: Intent;
  /** When the intent was set: a hand move after it means the camera is yours (no automatic re-frame). */
  intentAt: number;
  /** The camera has framed the map at least once. */
  framed: boolean;
  /** Where the camera was before a file was selected (it goes back there when the file lets go). */
  before: { view: View | null; intent: Intent } | null;
  /** A file to zoom to once it's selected (the selected file's effect does the move). */
  zoomTo: string | null;
  /** A thread was open: closing it frames the whole project again. */
  hadThread: boolean;
};

const BEAT_MS = 150;        // how often the director looks
const IDLE_MS = 60_000;
const SETTLE_MS = 450;      // the work stays out of the middle this long before the camera goes (a burst lands once)     // a camera you took, left alone this long with nothing open, goes back to the director

export function useMapCamera({ cam, camRef, replayCam, nodeIndex, nodeIndexRef, replayRef, replayActive, replay, step, selected, selectedRef, setSelected,
  resolveId, anim, agentsRef, hasNodes, focusFile, setFocusFile }: {
  cam: Camera; camRef: RefObject<Camera>;
  /** What the replay layer's camera follow asks of this camera (thread/ThreadLayer.ts): filled in here. */
  replayCam: RefObject<ReplayCamera>;
  nodeIndex: Map<string, GNode>; nodeIndexRef: RefObject<Map<string, GNode>>;
  replayRef: RefObject<ThreadLayerApi>; replayActive: boolean; replay: ThreadReplay | null; step: string | null;
  selected: string | null; selectedRef: RefObject<string | null>; setSelected: (id: string | null) => void;
  resolveId: (file: string) => string | undefined; anim: RefObject<Map<string, AgentAnim>>; hasNodes: boolean;
  /** The agents on the map (with a thread open, its own): the director frames the working ones. */
  agentsRef: RefObject<AgentPresence[]>;
  focusFile: string | null; setFocusFile: (f: string | null) => void;
  /** A small map (the Claude app's browser pane). The director's dead zone works the same on it. */
  smallRef?: RefObject<boolean>;
}) {
  const [followId, setFollowId] = useState<string | null>(null);
  // Following the same agent again (its button on the Readmap) frames it again, even after you moved the camera.
  const [followAt, setFollowAt] = useState(0);
  const refollow = useCallback((id: string) => { setFollowId(id); setFollowAt((n) => n + 1); }, []);
  // A thread replay takes over the camera: stop following a live agent when one starts.
  useEffect(() => { if (replay) setFollowId(null); }, [replay?.sessionId]);
  const followRef = useRef(followId); followRef.current = followId;

  // Dev only: the camera and the agents, for the camera's measurements (sampled from the browser).
  if (import.meta.env.DEV) Object.assign(window, { __rundownCam: camRef, __rundownAnim: anim });
  const state = useRef<CameraState>({ intent: { kind: "fit" }, intentAt: 0, framed: false, before: null, zoomTo: null, hadThread: false });
  const S = state.current;
  const setIntent = useCallback((i: Intent) => { S.intent = i; S.intentAt = performance.now(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // ---- the director (director.ts) ----
  const [taken, setTaken] = useState(false);
  const D = useRef({
    /** The camera is yours (a hand move since the director last had it): it frames nothing until you give it back. */
    taken: false,
    /** When the director last got the camera (a hand move after it takes it). */
    handAt: 0,
    /** A move of its own is under way until then: it doesn't look again before. */
    busyUntil: 0, lastTick: 0,
    /** Since when the work has been out of the dead zone (0: it isn't): a burst of edits settles before the camera moves. */
    outSince: 0,
    /** Per agent: the files its marker stood on lately (its last few edits), newest last, and when it last moved. */
    hist: new Map<string, { files: string[]; at: number }>(),
  }).current;
  /** What the director frames now: the area, and the markers that must stay in the dead zone. Null: nothing to frame. */
  const target = useCallback((): { box: Box; markers: P[] } | null => {
    const c = camRef.current, s = c.safe.current, idx = nodeIndexRef.current, R = replayRef.current, now = performance.now();
    const at = (file: string, st?: AgentAnim): P | undefined => {
      const n = idx.get(file);
      return n?.x !== undefined && n.y !== undefined ? { x: n.x, y: n.y } : st ? { x: st.x, y: st.y } : undefined;
    };
    const drawn = agentsRef.current;
    // A replay (looking back, or a live thread whose agent the map no longer shows): the director knows what comes next.
    // The marker and the next few moves that fit one framing with it: the camera moves once for a run of nearby edits,
    // the marker walks through them, and only the marker must stay in the dead zone.
    if (R.tracing && !followRef.current && (!replay?.live || !drawn.length)) {
      const run = groupAhead(R.ahead(DIRECTOR.ahead), s);
      const box = boxOfPts(run);
      return box ? { box, markers: [run[0]] } : null;
    }
    // Live: each agent's last few edits (its marker stands on the last file it changed: reads never move it).
    for (const [id, st] of anim.current) {
      if (!st.file) continue;
      const h = D.hist.get(id);
      if (!h) D.hist.set(id, { files: [st.file], at: 0 });
      else if (h.files[h.files.length - 1] !== st.file) { h.files.push(st.file); if (h.files.length > 3) h.files.shift(); h.at = now; }
    }
    const ids = followRef.current ? [followRef.current] : drawn.filter((a) => a.active).map((a) => a.id);
    const groups: P[][] = [], times: number[] = [];
    for (const id of ids) {
      const st = anim.current.get(id), h = D.hist.get(id);
      if (!st || !h) continue;
      // Newest first, the older edits only as long as they share one framing with it (a jump across the project
      // leaves the old place behind).
      const pts = groupAhead(h.files.map((f, i) => at(f, i === h.files.length - 1 ? st : undefined)).filter((p): p is P => !!p).reverse(), s);
      if (pts.length) { groups.push(pts.reverse()); times.push(h.at); }
    }
    if (!groups.length) return null;
    const latest = times.indexOf(Math.max(...times));
    const box = frameArea(groups, latest, s);
    if (!box) return null;
    const inBox = (p: P) => p.x >= box.x0 && p.x <= box.x1 && p.y >= box.y0 && p.y <= box.y1;
    return { box, markers: groups.map((g) => g[g.length - 1]).filter(inBox) };
  }, [replay?.live]); // eslint-disable-line react-hooks/exhaustive-deps
  /** One look: hand the camera to you on a hand move, back after a minute idle; else move if the work left the middle.
   *  `force`: frame it now, dead zone or not. Returns whether there is something to direct. */
  const direct = useCallback((force = false): boolean => {
    const c = camRef.current, v = c.view(), now = performance.now();
    D.lastTick = now;
    if (!v) return false;
    const t = target();
    if (!t) return false;
    if (!D.taken && c.userAt() > D.handAt) { D.taken = true; setTaken(true); }
    if (D.taken) {
      // A minute without touching the map, nothing open: the director takes it back.
      if (now - c.userAt() > IDLE_MS && !selectedRef.current && !step) { D.taken = false; setTaken(false); D.handAt = now; force = true; }
      else return true;
    }
    if (replayCam.current.pinned || S.intent.kind === "file") return true;
    if (!force && now < D.busyUntil) return true;
    const s = c.measure(), want = viewFor(t.box, s);
    if (!force && !shouldMove(v, s, t.markers, want)) { D.outSince = 0; return true; }
    if (!force && (D.outSince ||= now) > now - SETTLE_MS) return true;
    D.outSince = 0;
    if (import.meta.env.DEV) ((window as unknown as { __directorLog?: unknown[] }).__directorLog ??= []).push({ at: Math.round(now), force, cut: isCut(v, want, s), k: [v.k, want.k], markers: t.markers.length });
    if (isCut(v, want, s)) { c.cut(want); D.busyUntil = now + 450; }
    else { c.moveTo(want, 700); D.busyUntil = now + 750; }
    S.framed = true;
    return true;
  }, [target, step]); // eslint-disable-line react-hooks/exhaustive-deps
  const directRef = useRef(direct); directRef.current = direct;
  /** "Follow again": the pill, F, Esc, opening a step, following an agent. The director frames the work at once. */
  const followAgain = useCallback(() => {
    D.taken = false; setTaken(false); D.handAt = performance.now(); D.busyUntil = 0;
    directRef.current(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Its beat: a few times a second (cheap: a handful of points), and at once when the replay's marker moves.
  useEffect(() => {
    const t = setInterval(() => directRef.current(), BEAT_MS);
    replayCam.current.kick = () => { if (performance.now() - D.lastTick > 90) directRef.current(); };
    return () => { clearInterval(t); replayCam.current.kick = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Frame the open thread's focus (its recent window, or all its files), or the whole project. */
  const fitAll = useCallback((ms = 800) => {
    const idx = nodeIndexRef.current;
    const fp = replayRef.current.footprint();
    const touched = fp?.map((id) => idx.get(id)).filter((n): n is GNode => !!n && n.x !== undefined) ?? [];
    const box = boxOf(touched.length ? touched : idx.values());
    if (!box) return;
    // Folder names sit above each group: leave them room at the top. A footprint of one or two files doesn't fill the screen.
    box.y0 -= 24;
    camRef.current.frame(box, { pad: 44, maxZoom: touched.length ? 2.4 : 4 }, ms);
    S.framed = true;
  }, []);
  /** Frame what the intent says, unless the user has moved the camera since. */
  const applyIntent = useCallback((ms = 600) => {
    const i = S.intent, c = camRef.current;
    if (i.kind === "free" || c.userAt() > S.intentAt) return;
    // Following an agent, the follow owns the camera (F lets go of it first): no fit takes it back.
    if (i.kind === "fit") { if (!direct(true)) fitAll(ms); return; }
    const n = nodeIndexRef.current.get(i.id);
    if (!n || n.x === undefined || n.y === undefined) return;
    if (i.zoom) c.lookAt(n.x, n.y, 3, ms);
    else c.reveal(n.x, n.y, n.r + 14, ms);   // room for its name under it
    S.framed = true;
  }, [fitAll]); // eslint-disable-line react-hooks/exhaustive-deps
  // The safe area changed (a panel opened, the sidebar collapsed, the window resized): frame the same thing in it.
  useEffect(() => {
    const t = setTimeout(() => applyIntent(450), 60);
    return () => clearTimeout(t);
  }, [cam.version, applyIntent]);
  // The arrow keys, + and −, C and Esc (useCameraKeys.ts): moving the map by hand is a free intent.
  useCameraKeys({ camRef, replayRef, followRef, setFollowId, free: () => setIntent({ kind: "free" }),
    taken: () => D.taken, followAgain: () => followAgain() });

  // Following an agent (the sidebar, the Readmap, A): the director frames that one, at once, and the camera is its again.
  useEffect(() => { if (followId) followAgain(); }, [followId, followAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const focusOnFile = useCallback((file: string) => {
    setFollowId(null);
    const id = resolveId(file);
    const n = id ? nodeIndexRef.current.get(id) : undefined;
    if (!n) return;
    S.zoomTo = n.id;
    if (selectedRef.current === n.id) { setIntent({ kind: "file", id: n.id, zoom: true }); applyIntent(800); }
    setSelected(n.id);
  }, [resolveId, setIntent, applyIntent]);

  // Frame the map as soon as it has files: the layout is final from the first frame (graph.ts), so no glide.
  useEffect(() => {
    if (!hasNodes) return;
    const t = requestAnimationFrame(() => applyIntent(0));
    return () => cancelAnimationFrame(t);
  }, [hasNodes, applyIntent]);

  // Opening a thread or starting its replay frames its recent window once, locked or not (a link opened straight onto a
  // thread that loads before the map is framed by the hasNodes effect above). Closing the thread frames the whole project again.
  const openThread = replayActive ? replay?.sessionId : undefined;
  const playing = replay?.mode === "play";
  useEffect(() => {
    if (openThread) S.hadThread = true;
    else if (!S.hadThread) return;
    if (!openThread) S.hadThread = false;
    setIntent({ kind: "fit" });
    if (replayCam.current.pinned) return; // a file is selected: the camera stays on the file
    D.taken = false; setTaken(false); D.handAt = performance.now();
    if (!direct(true)) fitAll(700);
  }, [openThread, playing, setIntent, fitAll]);

  // Focus from Follow (and file links)
  useEffect(() => {
    if (!focusFile) return;
    const n = nodeIndex.get(focusFile);
    if (!n) return;
    S.zoomTo = n.id;
    setSelected(n.id);
    setFocusFile(null);
    if (selectedRef.current === n.id) { setIntent({ kind: "file", id: n.id, zoom: true }); applyIntent(900); }
  }, [focusFile, nodeIndex, setFocusFile, setIntent, applyIntent]);

  // A selected file (its details in the sidebar, which unfolds for it): the camera brings it into the uncovered map
  // (zoomed in when it came from a list or a link); letting go of it puts the camera back where it was before (or frames
  // the map, if it had never been framed). An open step takes the camera back (the tracer shows the step).
  const panelFile = step ? null : selected;
  useEffect(() => () => { replayCam.current.pinned = false; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const c = camRef.current;
    replayCam.current.pinned = !!panelFile; // the tracer's camera leaves the selected file alone (it picks up again on close)
    if (panelFile) {
      if (!S.before) {
        const auto = c.userAt() <= S.intentAt ? S.intent : { kind: "free" as const };
        S.before = { view: S.framed ? c.view() : null, intent: auto.kind === "file" ? { kind: "fit" } : auto };
      }
      setIntent({ kind: "file", id: panelFile, zoom: S.zoomTo === panelFile });
      S.zoomTo = null;
      // A file with no position yet (a link that opened with the map): the intent frames it once the layout runs.
      const n = nodeIndexRef.current.get(panelFile);
      if (n?.x === undefined) { const t = setTimeout(() => applyIntent(900), 800); return () => clearTimeout(t); }
      applyIntent(800);
      return;
    }
    const b = S.before;
    S.before = null;
    if (!b) return;
    if (b.view && b.intent.kind !== "fit") { setIntent(b.intent); c.moveTo(b.view, 700); }
    else { setIntent({ kind: "fit" }); applyIntent(700); }
  }, [panelFile, setIntent, applyIntent]);

  // Opening a step gives the camera back to the director.
  useEffect(() => { if (step) followAgain(); }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  return { followId, setFollowId, refollow, followRef, focusOnFile, applyIntent, taken, followAgain };
}
