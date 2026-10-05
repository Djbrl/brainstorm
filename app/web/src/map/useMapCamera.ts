// Owner: D. What the map's camera frames and when (moved out of MapView.tsx): the whole project or an open thread's
// files, the open file, a followed agent; again when a panel opens or the window resizes, unless you moved it yourself.
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { ThreadReplay } from "../lib/nav";
import { getCameraLock } from "./prefs";
import { replayCamera } from "./replay/store";
import type { ReplayLayerApi } from "./replay/layer";
import { boxOf, isFitKey, type Camera, type View } from "./camera";
import type { AgentAnim } from "./agents";
import type { GNode } from "./graph";

// ---- camera intent: what the camera is framing, so it can frame it again when a panel opens or the window resizes ----
// "fit": the whole project (or the open thread's footprint); "file": the open file; "free": the user's own view.
type Intent = { kind: "fit" } | { kind: "file"; id: string; zoom: boolean } | { kind: "free" };

export function useMapCamera({ cam, camRef, nodeIndex, nodeIndexRef, replayRef, replayActive, replay, step, selected, selectedRef, setSelected,
  resolveId, anim, hasNodes, focusFile, setFocusFile }: {
  cam: Camera; camRef: RefObject<Camera>; nodeIndex: Map<string, GNode>; nodeIndexRef: RefObject<Map<string, GNode>>;
  replayRef: RefObject<ReplayLayerApi>; replayActive: boolean; replay: ThreadReplay | null; step: string | null;
  selected: string | null; selectedRef: RefObject<string | null>; setSelected: (id: string | null) => void;
  resolveId: (file: string) => string | undefined; anim: RefObject<Map<string, AgentAnim>>; hasNodes: boolean;
  focusFile: string | null; setFocusFile: (f: string | null) => void;
}) {
  const [followId, setFollowId] = useState<string | null>(null);
  // A thread replay takes over the camera: stop following a live agent when one starts.
  useEffect(() => { if (replay) setFollowId(null); }, [replay?.sessionId]);
  const followRef = useRef(followId); followRef.current = followId;

  const intent = useRef<Intent>({ kind: "fit" });
  const intentAt = useRef(0);
  const setIntent = useCallback((i: Intent) => { intent.current = i; intentAt.current = performance.now(); }, []);
  const framed = useRef(false);   // the camera has framed the map at least once
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
    framed.current = true;
  }, []);
  /** Frame what the intent says, unless the user has moved the camera since. */
  const applyIntent = useCallback((ms = 600) => {
    const i = intent.current, c = camRef.current;
    if (i.kind === "free" || c.userAt() > intentAt.current) return;
    if (i.kind === "fit") { if (!lockedOn()) fitAll(ms); return; }
    const n = nodeIndexRef.current.get(i.id);
    if (!n || n.x === undefined || n.y === undefined) return;
    if (i.zoom) c.lookAt(n.x, n.y, 3, ms);
    else c.reveal(n.x, n.y, n.r + 14, ms);   // room for its name under it
    framed.current = true;
  }, [fitAll, lockedOn]);
  // Unlocked, the tracer left the view: frame the recent window again (applyIntent: unless you moved the camera since).
  useEffect(() => { replayCamera.lost = () => applyIntent(700); return () => { replayCamera.lost = null; }; }, [applyIntent]);
  // The safe area changed (a panel opened, the sidebar collapsed, the window resized): frame the same thing in it.
  useEffect(() => {
    const t = setTimeout(() => applyIntent(450), 60);
    return () => clearTimeout(t);
  }, [cam.version, applyIntent]);
  /** The fit button and F / 0: the open thread's recent window, or the whole project (and stop following an agent). */
  const fitNow = useCallback(() => {
    setFollowId(null);
    setIntent({ kind: "fit" });
    fitAll(700);
  }, [fitAll, setIntent]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (isFitKey(e)) { e.preventDefault(); fitNow(); } };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [fitNow]);

  // Follow an agent (from the sidebar), like the tracer: the camera frames it once; locked, it keeps it centred (easing,
  // every frame, no stacked tweens) at whatever zoom you pick; unlocked, it stays where you put it, and frames the agent
  // again when it leaves the view only if you haven't moved the camera since following began.
  useEffect(() => {
    if (!followId) return;
    setIntent({ kind: "free" });
    const t0 = performance.now();
    let raf = 0, framedAt = 0;
    const tick = () => {
      const st = anim.current.get(followId), c = camRef.current, now = performance.now();
      if (st) {
        if (!framedAt) { framedAt = now; c.lookAt(st.x, st.y, Math.max(2.2, c.view()?.k ?? 0), 700); }
        else if (getCameraLock()) { if (now - framedAt > 700) c.easeToward(st.x, st.y, 0.09); }
        else if (c.userAt() < t0 && now - framedAt > 1200 && !c.sees(st.x, st.y)) { framedAt = now; c.lookAt(st.x, st.y, undefined, 700); }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [followId, setIntent]);
  /** A file to zoom to once it's selected (the selected file's effect below does the move). */
  const zoomTo = useRef<string | null>(null);
  const focusOnFile = useCallback((file: string) => {
    setFollowId(null);
    const id = resolveId(file);
    const n = id ? nodeIndexRef.current.get(id) : undefined;
    if (!n) return;
    zoomTo.current = n.id;
    if (selectedRef.current === n.id) { setIntent({ kind: "file", id: n.id, zoom: true }); applyIntent(800); }
    setSelected(n.id);
  }, [resolveId, setIntent, applyIntent]);

  // Frame the map as soon as it has files: the layout is final from the first frame (graph.ts), so no glide.
  useEffect(() => {
    if (!hasNodes) return;
    const t = requestAnimationFrame(() => applyIntent(0));
    return () => cancelAnimationFrame(t);
  }, [hasNodes, applyIntent]);

  // Opening a thread or starting its replay frames its recent window once, locked or not (and again as the layout settles,
  // unlocked and untouched: a link opened straight onto a thread loads the map at the same time). Closing the thread
  // frames the whole project again.
  const openThread = replayActive ? replay?.sessionId : undefined;
  const playing = replay?.mode === "play";
  const hadThread = useRef(false);
  useEffect(() => {
    if (openThread) hadThread.current = true;
    else if (!hadThread.current) return;
    if (!openThread) hadThread.current = false;
    setIntent({ kind: "fit" });
    if (replayCamera.pinned) return; // a file is selected: the camera stays on the file
    fitAll(700);
    const ts = openThread ? [600, 1800].map((ms) => setTimeout(() => applyIntent(700), ms)) : [];
    return () => ts.forEach(clearTimeout);
  }, [openThread, playing, setIntent, applyIntent, fitAll]);

  // Focus from Follow (and file links)
  useEffect(() => {
    if (!focusFile) return;
    const n = nodeIndex.get(focusFile);
    if (!n) return;
    zoomTo.current = n.id;
    setSelected(n.id);
    setFocusFile(null);
    if (selectedRef.current === n.id) { setIntent({ kind: "file", id: n.id, zoom: true }); applyIntent(900); }
  }, [focusFile, nodeIndex, setFocusFile, setIntent, applyIntent]);

  // A selected file (its details in the sidebar, which unfolds for it): the camera brings it into the uncovered map
  // (zoomed in when it came from a list or a link); letting go of it puts the camera back where it was before (or frames
  // the map, if it had never been framed). An open step takes the camera back (the tracer shows the step).
  const panelFile = step ? null : selected;
  const before = useRef<{ view: View | null; intent: Intent } | null>(null);
  useEffect(() => () => { replayCamera.pinned = false; }, []);
  useEffect(() => {
    const c = camRef.current;
    replayCamera.pinned = !!panelFile; // the tracer's camera leaves the selected file alone (it picks up again on close)
    if (panelFile) {
      if (!before.current) {
        const auto = c.userAt() <= intentAt.current ? intent.current : { kind: "free" as const };
        before.current = { view: framed.current ? c.view() : null, intent: auto.kind === "file" ? { kind: "fit" } : auto };
      }
      setIntent({ kind: "file", id: panelFile, zoom: zoomTo.current === panelFile });
      zoomTo.current = null;
      // A file with no position yet (a link that opened with the map): the intent frames it once the layout runs.
      const n = nodeIndexRef.current.get(panelFile);
      if (n?.x === undefined) { const t = setTimeout(() => applyIntent(900), 800); return () => clearTimeout(t); }
      applyIntent(800);
      return;
    }
    const b = before.current;
    before.current = null;
    if (!b) return;
    if (b.view && b.intent.kind !== "fit") { setIntent(b.intent); c.moveTo(b.view, 700); }
    else { setIntent({ kind: "fit" }); applyIntent(700); }
  }, [panelFile, setIntent, applyIntent]);

  return { followId, setFollowId, followRef, fitNow, focusOnFile, applyIntent };
}
