// What the map's camera frames and when (moved out of MapView.tsx): the whole project or an open thread's
// files, the open file, a followed agent; again when a panel opens or the window resizes, unless you moved it yourself.
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { ThreadReplay } from "../lib/nav";
import { getCameraLock } from "./prefs";
import type { ThreadLayerApi } from "./thread/ThreadLayer";
import { boxOf, fitView, type Camera, type ReplayCamera, type View } from "./camera";
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

export function useMapCamera({ cam, camRef, replayCam, nodeIndex, nodeIndexRef, replayRef, replayActive, replay, step, selected, selectedRef, setSelected,
  resolveId, anim, hasNodes, focusFile, setFocusFile, smallRef }: {
  cam: Camera; camRef: RefObject<Camera>;
  /** What the replay layer's camera follow asks of this camera (thread/ThreadLayer.ts): filled in here. */
  replayCam: RefObject<ReplayCamera>;
  nodeIndex: Map<string, GNode>; nodeIndexRef: RefObject<Map<string, GNode>>;
  replayRef: RefObject<ThreadLayerApi>; replayActive: boolean; replay: ThreadReplay | null; step: string | null;
  selected: string | null; selectedRef: RefObject<string | null>; setSelected: (id: string | null) => void;
  resolveId: (file: string) => string | undefined; anim: RefObject<Map<string, AgentAnim>>; hasNodes: boolean;
  focusFile: string | null; setFocusFile: (f: string | null) => void;
  /** A small map (the Claude app's browser pane): a followed agent is framed again sooner, before it reaches the edge. */
  smallRef: RefObject<boolean>;
}) {
  const [followId, setFollowId] = useState<string | null>(null);
  // Following the same agent again (its button on the Readmap) frames it again, even after you moved the camera.
  const [followAt, setFollowAt] = useState(0);
  const refollow = useCallback((id: string) => { setFollowId(id); setFollowAt((n) => n + 1); }, []);
  // A thread replay takes over the camera: stop following a live agent when one starts.
  useEffect(() => { if (replay) setFollowId(null); }, [replay?.sessionId]);
  const followRef = useRef(followId); followRef.current = followId;

  const state = useRef<CameraState>({ intent: { kind: "fit" }, intentAt: 0, framed: false, before: null, zoomTo: null, hadThread: false });
  const S = state.current;
  const setIntent = useCallback((i: Intent) => { S.intent = i; S.intentAt = performance.now(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  /** Locked onto something that moves (the tracer, a followed agent): the follow owns the centre, so no automatic re-frame. */
  const lockedOn = useCallback(() => getCameraLock() && (replayRef.current.tracing || !!followRef.current), []);
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
    if (i.kind === "fit") { if (!lockedOn() && !followRef.current) fitAll(ms); return; }
    const n = nodeIndexRef.current.get(i.id);
    if (!n || n.x === undefined || n.y === undefined) return;
    if (i.zoom) c.lookAt(n.x, n.y, 3, ms);
    else c.reveal(n.x, n.y, n.r + 14, ms);   // room for its name under it
    S.framed = true;
  }, [fitAll, lockedOn]);
  // Unlocked, the tracer left the view: frame the recent window again (applyIntent: unless you moved the camera since).
  // On a small map it follows the marker instead, as it follows an agent (the frame it's in, not the recent window: that
  // can span the whole project), unless you moved the camera since.
  useEffect(() => {
    const r = replayCam.current;
    r.onLost = () => {
      const c = camRef.current, m = replayRef.current.subject();
      if (!smallRef.current || !m) { applyIntent(700); return; }
      if (c.userAt() > S.intentAt) return;
      c.lookAt(m.x, m.y, undefined, 600);
    };
    r.margin = () => {
      if (!smallRef.current) return 24;
      const s = camRef.current.safe.current;
      return Math.max(24, Math.min(s.w - s.left - s.right, s.h - s.top - s.bottom) * 0.2);
    };
    return () => { r.onLost = null; r.margin = () => 24; };
  }, [applyIntent]);
  // The safe area changed (a panel opened, the sidebar collapsed, the window resized): frame the same thing in it.
  useEffect(() => {
    const t = setTimeout(() => applyIntent(450), 60);
    return () => clearTimeout(t);
  }, [cam.version, applyIntent]);
  // The arrow keys, + and −, C and Esc (useCameraKeys.ts): moving the map by hand is a free intent.
  useCameraKeys({ camRef, replayRef, followRef, setFollowId, anim, replay, free: () => setIntent({ kind: "free" }) });

  // Follow an agent (from the sidebar), like the tracer: the camera frames it once; locked, it keeps it centred (easing,
  // every frame, no stacked tweens) at whatever zoom you pick; unlocked, it stays where you put it, and frames the agent
  // again when it leaves the view only if you haven't moved the camera since following began. On a small map, "the view"
  // is its middle: the agent is framed again once it gets within a fifth of the view of an edge, so it stays readable.
  useEffect(() => {
    if (!followId) return;
    setIntent({ kind: "free" });
    const t0 = performance.now();
    let raf = 0, framedAt = 0;
    const tick = () => {
      const st = anim.current.get(followId), c = camRef.current, now = performance.now();
      if (st) {
        if (!framedAt) { framedAt = now; c.lookAt(st.x, st.y, zoomFor(st.file, c), 700); }
        else if (getCameraLock()) { if (now - framedAt > 700) c.easeToward(st.x, st.y, 0.09); }
        else if (c.userAt() < t0 && now - framedAt > 1200 && !c.sees(st.x, st.y, margin(c))) { framedAt = now; c.lookAt(st.x, st.y, smallRef.current ? zoomFor(st.file, c) : undefined, 700); }
      }
      raf = requestAnimationFrame(tick);
    };
    // How close: on a big map, close enough to read its files; on a small one, the folder it works in fills the view
    // (its neighbours named around it), the camera following it from folder to folder.
    const zoomFor = (file: string, c: Camera) => {
      const k = c.view()?.k ?? 0;
      if (!smallRef.current) return Math.max(2.2, k);
      const n = nodeIndexRef.current.get(file), f = n?.up ?? n;
      if (f?.x === undefined || f.y === undefined) return Math.max(1.6, k);
      return fitView(c.safe.current, { x0: f.x - f.r, x1: f.x + f.r, y0: f.y - f.r, y1: f.y + f.r }, { pad: 16, minZoom: 1.1, maxZoom: 2.2 }).k;
    };
    const margin = (c: Camera) => {
      if (!smallRef.current) return 24;
      const s = c.safe.current;
      return Math.max(24, Math.min(s.w - s.left - s.right, s.h - s.top - s.bottom) * 0.2);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [followId, followAt, setIntent]);
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
    fitAll(700);
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

  return { followId, setFollowId, refollow, followRef, focusOnFile, applyIntent };
}
