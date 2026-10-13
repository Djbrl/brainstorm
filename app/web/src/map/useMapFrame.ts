// One frame of the map, in three parts (MapView calls them for each frame useCanvasZoom draws): startFrame (what the frame knows: the clock, the view, what
// is open), drawNode (each file, drawNode.ts), endFrame (the dots, import lines, names, the replay's tracer, the agents,
// and whether another frame must follow: redraw.ts). Moved out of MapView.tsx; it owns what drawing keeps between frames.
import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { ZoomApi } from "./useCanvasZoom";
import type { FileNode } from "@contract";
import { clock, isRecording } from "../lib/live";
import { sinceMs } from "../lib/visit";
import { mapPrefs } from "../lib/nav";
import { tourHidesExtras } from "../lib/tour";
import { drawAgents, type AgentRing, type AgentSpot } from "./agents";
import type { Safe } from "./camera";
import type { ThreadLayerApi } from "./thread/ThreadLayer";
import { drawQueuedLabels, LabelSpace, type QueuedLabel } from "./labels";
import { mapStyle } from "./themes";
import { spriteFrame } from "./sprites";
import { Motion, type Redraw } from "./redraw";
import { css, type Tokens } from "./color";
import { nodeReach, shownLinks, stepTween, type GLink, type Graph, type GNode } from "./graph";
import { foldFrame, openAround } from "./fold";
import { settleLandings, drawFile, drawFocusLinks, drawFolderNames, FILE_LABELS_MAX, flushDots, labelFor, moreMotion, type Caches, type Frame } from "./drawNode";
import type { useLiveAgents } from "./useLiveAgents";
import type { Size } from "../lib/hooks";

/** A recording (the hosted demo) or a shared replay: fixed for the page's life, read once (it parses the URL). */
let replayed: boolean | undefined;
const recorded = () => (replayed ??= isRecording());

/** What the frame reads from the view, as of its last render (MapView's useLatest). */
export type FrameInputs = {
  size: Size; selected: string | null; hover: string | null; tokens: Tokens; linkFocus: string | null;
  /** The folders open at any zoom (useOpenFolders). */
  pinned: ReadonlySet<GNode>;
  foldOn: Parameters<typeof foldFrame>[3];
  /** A thread is open; its replay plays. */
  open: boolean; playing: boolean;
  theme: string;
};

export function useMapFrame({ fg, inputs, epoch, caches, tween, graphRef, nodeIndexRef, resolveId, replayRef, live, followRef, ringLayer, edgeLayer, safe, readmap, redraw, files }: {
  fg: RefObject<ZoomApi | undefined>;
  inputs: { readonly current: FrameInputs };
  epoch: RefObject<number>; caches: RefObject<Caches>;
  tween: Parameters<typeof stepTween>[0];
  graphRef: RefObject<Graph>; nodeIndexRef: RefObject<Map<string, GNode>>;
  resolveId: (file: string) => string | undefined;
  replayRef: RefObject<ThreadLayerApi>;
  /** The live agents (useLiveAgents.ts). */
  live: Pick<ReturnType<typeof useLiveAgents>, "agentsRef" | "anim" | "waitingRef" | "thinkingRef" | "dimmedRef" | "behindRef" | "moving">;
  followRef: RefObject<string | null>;
  /** The agents' breathing rings, over the canvas (syncRings). */
  ringLayer: RefObject<HTMLDivElement | null>;
  /** The arrows on the screen's edge for agents off the visible map (syncEdges), and the part of the canvas no panel covers. */
  edgeLayer: RefObject<HTMLDivElement | null>;
  safe: () => Safe | null;
  /** The Readmap's draw, while it shows (Readmap.tsx): it draws on the map's frames; true while it still moves. */
  readmap: RefObject<(() => boolean) | null>;
  redraw: Redraw;
  /** The files: a change to one's size or activity changes its footprint. */
  files: FileNode[] | null;
}) {
  const space = useRef(new LabelSpace());         // taken this frame: files, replay badges, folder names, file names
  const markedRef = useRef<string | null>(null);  // the file the replay's marker names this frame
  const ringsOut = useRef<AgentRing[]>([]);
  const spotsOut = useRef<AgentSpot[]>([]);
  const labelBufs = useRef({ order: [] as number[], queue: [] as QueuedLabel[], pool: [] as QueuedLabel[] });
  // drawAgents' options: one object, refilled each frame; its two callbacks made once.
  const agentOpts = useRef<Parameters<typeof drawAgents>[0]>(null as never);
  agentOpts.current ??= {
    ctx: null as never, scale: 1, agents: [], anim: new Map(), accent: "", font: "", hoverFile: null, followId: null,
    resolveId: () => undefined, showReads: true,
    land: (id, t) => caches.current.landings.set(id, t),
    // The node itself (it has x, y and r): read only.
    resolve: (id) => { const n = nodeIndexRef.current.get(id); return n && n.x !== undefined && n.y !== undefined ? n as { x: number; y: number; r: number } : undefined; },
  };
  const frame = useRef<Frame>(null as never);
  frame.current ??= { id: 0, scale: 1, x0: -Infinity, y0: -Infinity, x1: Infinity, y1: Infinity, now: 0, t: 0, st: mapStyle(),
    sel: null, hover: null, coolCss: "", looks: true, anyLook: false, lookSum: 0, motion: Motion.None, labN: [], labP: [],
    tokens: inputs.current.tokens, epoch: 0, recorded: recorded(), since: sinceMs, look: () => null, linkFocus: null, tracing: false };
  const lastLookSum = useRef(0);
  const vis = useRef({ sig: 0, ver: 0 });   // what's open (fold.ts), and a counter bumped when it or the positions change
  const linkCache = useRef<{ key: string; links: GLink[]; g: Graph | null }>({ key: "", links: [], g: null });

  const startFrame = useCallback((_: CanvasRenderingContext2D, scale: number) => {
    const F = frame.current, g = fg.current, I = inputs.current, { w, h } = I.size;
    F.id++; F.scale = scale; F.now = clock(); F.t = performance.now(); F.st = mapStyle();
    F.sel = I.selected; F.hover = I.hover; F.coolCss = css(I.tokens.cool);
    F.tokens = I.tokens; F.epoch = epoch.current; F.look = replayRef.current.look;
    F.linkFocus = I.linkFocus; F.tracing = replayRef.current.tracing;
    spriteFrame();
    // Off-screen files aren't drawn: the part of the map the camera shows, in graph units.
    const a = g?.screen2GraphCoords(0, 0), b = g?.screen2GraphCoords(w, h);
    if (a && b) { F.x0 = Math.min(a.x, b.x); F.x1 = Math.max(a.x, b.x); F.y0 = Math.min(a.y, b.y); F.y1 = Math.max(a.y, b.y); }
    // The focus is asked about every file only while a thread is open, or its fade back hasn't finished.
    F.looks = replayRef.current.active || F.anyLook;
    F.anyLook = false; F.lookSum = 0; F.motion = Motion.None;
    F.labN.length = 0; F.labP.length = 0;
    for (const d of caches.current.dots.values()) d.xyr.length = 0;
    settleLandings(caches.current.landings, F.t);
    // Files came or went: the circles that moved glide to their new places.
    if (stepTween(tween, F.t)) { moreMotion(F, Motion.Smooth); vis.current.ver++; }
    // What's open at this zoom; an agent at work shows its folders open too.
    let forced: ReadonlySet<GNode> = I.pinned;
    for (const ag of live.agentsRef.current) {
      if ((!ag.active && !I.open) || !ag.file) continue;   // with a thread open, where each of its agents is (or stopped)
      const id = resolveId(ag.file), n = id ? nodeIndexRef.current.get(id) : undefined;
      if (!n) continue;
      if (forced === I.pinned) forced = new Set(forced);
      openAround(n, forced as Set<GNode>);
    }
    const sig = foldFrame(graphRef.current, scale, forced, I.foldOn);
    if (sig !== vis.current.sig) { vis.current.sig = sig; vis.current.ver++; }
  }, [resolveId]); // eslint-disable-line react-hooks/exhaustive-deps

  const drawNode = useCallback((node: GNode, ctx: CanvasRenderingContext2D, scale: number) => {
    drawFile(ctx, node, scale, frame.current, caches.current);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- names: the space they may take (labels.ts), then the open folders' names (drawNode.ts) ----
  const focusVer = useRef<{ ids: string[] | null; v: number }>({ ids: null, v: 0 });
  const geomVer = useRef(0);   // bumped when a file's size or activity changes (its reach, so its footprint)
  const lastGeom = useRef<{ files: FileNode[] | null }>({ files: null });
  useEffect(() => { if (lastGeom.current.files !== files) { lastGeom.current.files = files; geomVer.current++; } }, [files]);
  const drawModules = useCallback((ctx: CanvasRenderingContext2D, scale: number) => {
    // Every file's footprint that shows goes in first (and every closed folder's circle): no name prints over a file.
    // With a thread open, the files it never touched (or hasn't reached yet) are faded into the background: its own
    // names may cross those, not the rest.
    const F = frame.current, st = F.st, sp = space.current, g = graphRef.current;
    sp.reset(48 / scale);
    const ids = replayRef.current.footprint();
    const fv = focusVer.current;
    if (ids?.length !== fv.ids?.length || (ids && fv.ids && ids.some((id, i) => id !== fv.ids![i])) || !ids !== !fv.ids) { fv.ids = ids; fv.v++; }
    const cell = 2 ** Math.round(Math.log2(48 / scale));
    sp.fileLayer(`${vis.current.ver}|${g.id}|${geomVer.current}|${inputs.current.theme}|${cell}|${fv.v}`, cell, (add) => {
      const inFocus = ids ? new Set(ids) : null;
      for (const n of g.nodes) {
        if (n.x === undefined || n.y === undefined || (n.shown ?? 1) < 0.5 || (n.dir && (n.open ?? 0) >= 0.5)) continue;
        if (inFocus && !n.dir && !inFocus.has(n.id)) continue;
        add(n.id, n.x, n.y, nodeReach(n, st));
      }
    });
    const ring = (n: GNode) => (st.node === "dot" || n.dir ? n.r : n.r * 1.35 + 2 / scale);   // the selection ring (drawNode)
    for (const id of [F.sel, F.hover]) {
      const n = id ? nodeIndexRef.current.get(id) : undefined;
      if (n?.x !== undefined && n.y !== undefined) sp.file(n.id, n.x, n.y, Math.max(nodeReach(n, st), ring(n)));
    }
    // The replay's badges and marker are drawn last, on top, but take their space now: names keep off them too.
    const marks = replayRef.current.marks(ctx, scale);
    for (const b of marks.boxes) sp.add(b);
    markedRef.current = marks.named;
    drawFolderNames(ctx, scale, g.folders, F, sp);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Labels go on after the files (folder names, then file names), so no circle covers a name; then the agents.
  const drawAgentLayer = useCallback((ctx: CanvasRenderingContext2D, scale: number) => {
    const F = frame.current, I = inputs.current, tokens = I.tokens;
    // File names go on after every file is drawn, so no circle covers a name (the selected one's last, on top).
    // The file the replay's marker names (drawModules) isn't named twice. Only the most important ones are placed.
    // The lists and labels are kept from frame to frame (refilled, not made again).
    const L = labelBufs.current, order = L.order, queue = L.queue, named = markedRef.current;
    order.length = F.labN.length;
    for (let i = 0; i < order.length; i++) order[i] = i;
    if (order.length > FILE_LABELS_MAX) { order.sort((a, b) => F.labP[b] - F.labP[a]); order.length = FILE_LABELS_MAX; }
    queue.length = 0;
    let used = 0;
    for (const i of order) {
      const l = labelFor(F.labN[i], F.labP[i], F, L.pool[used]);
      if (named && l.at?.id === named && !l.must) { L.pool[used] = l; continue; }
      L.pool[used++] = l;
      queue.push(l);
    }
    drawQueuedLabels(ctx, queue, space.current);
    replayRef.current.draw(ctx, scale);
    const A = agentOpts.current;
    A.ctx = ctx; A.scale = scale; A.agents = live.agentsRef.current; A.anim = live.anim.current; A.accent = tokens.accent; A.font = tokens.body;
    A.hoverFile = I.hover; A.followId = followRef.current; A.resolveId = resolveId; A.showReads = mapPrefs.showReads && !tourHidesExtras();
    A.quiet = !I.open; A.waiting = live.waitingRef.current; A.thinking = live.thinkingRef.current; A.keep = I.open; A.dimmed = live.dimmedRef.current; A.behind = live.behindRef.current;
    ringsOut.current.length = 0; A.rings = ringsOut.current;
    spotsOut.current.length = 0; A.spots = spotsOut.current;
    drawAgents(A);
    syncRings(ringLayer.current, ringsOut.current);
    syncEdges(edgeLayer.current, spotsOut.current, safe(), followRef.current);
  }, [resolveId]); // eslint-disable-line react-hooks/exhaustive-deps

  const endFrame = useCallback((ctx: CanvasRenderingContext2D, scale: number) => {
    const F = frame.current;
    flushDots(ctx, caches.current.dots, scale);
    // The hovered or selected file's import lines, over the files (growing in, fading out: drawFocusLinks).
    if (F.linkFocus || caches.current.lines.size) drawFocusLinks(ctx, scale, shownLinks(graphRef.current, linkCache.current, `${vis.current.sig}`), F, caches.current);
    drawModules(ctx, scale);
    drawAgentLayer(ctx, scale);
    ctx.globalAlpha = 1;
    // What still moves decides whether the next frame comes (redraw.ts).
    if (Math.abs(F.lookSum - lastLookSum.current) > 1e-6) moreMotion(F, Motion.Smooth);   // files easing into or out of a focus
    lastLookSum.current = F.lookSum;
    const am = live.moving(F.t);
    if (am === Motion.Smooth || (replayRef.current.tracing && replayRef.current.active && inputs.current.playing)) moreMotion(F, Motion.Smooth);
    else if (replayRef.current.ringing()) moreMotion(F, Motion.Slow);   // the replay marker's thinking ring, when it was drawn
    if (readmap.current?.()) moreMotion(F, Motion.Smooth);               // the Readmap's camera gliding, a read's ring there
    redraw.drew(F.motion);
  }, [drawModules, drawAgentLayer, redraw]); // eslint-disable-line react-hooks/exhaustive-deps

  return { startFrame, drawNode, endFrame };
}

const EDGE_IN = 22;   // how far inside the visible map's edge an arrow sits (CSS px)
/**
 * An arrow on the edge of the visible map (the part no panel covers) for each agent off it, pointing where it is: its
 * colour and its initial, amber when it waits on you. A button: a click goes to it (MapView's onClick on the layer).
 */
function syncEdges(layer: HTMLDivElement | null, spots: AgentSpot[], safe: Safe | null, followed: string | null) {
  if (!layer) return;
  const seen = new Set<string>();
  if (safe) {
    const x0 = safe.left + EDGE_IN, x1 = safe.w - safe.right - EDGE_IN, y0 = safe.top + EDGE_IN, y1 = safe.h - safe.bottom - EDGE_IN;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    for (const s of spots) {
      if (x1 <= x0 || y1 <= y0 || (s.x >= x0 - EDGE_IN && s.x <= x1 + EDGE_IN && s.y >= y0 - EDGE_IN && s.y <= y1 + EDGE_IN)) continue;   // in view
      const dx = s.x - cx, dy = s.y - cy, k = Math.min((x1 - cx) / Math.max(1e-6, Math.abs(dx)), (y1 - cy) / Math.max(1e-6, Math.abs(dy)));
      const x = cx + dx * k, y = cy + dy * k, ang = Math.atan2(dy, dx);
      seen.add(s.id);
      let el = layer.querySelector<HTMLButtonElement>(`[data-edge="${CSS.escape(s.id)}"]`);
      if (!el) {
        el = document.createElement("button"); el.dataset.edge = s.id; el.className = "agent-edge"; el.type = "button";
        el.innerHTML = "<i></i><span></span>"; layer.appendChild(el);
      }
      const label = `${s.name}${s.waits ? ", waiting on you" : ""}: go to it`;
      if (el.getAttribute("aria-label") !== label) { el.setAttribute("aria-label", label); el.title = label; }
      el.classList.toggle("waits", s.waits);
      el.classList.toggle("on", s.id === followed);
      const tr = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`, rot = `rotate(${ang.toFixed(3)}rad)`;
      if (el.style.transform !== tr) el.style.transform = tr;
      const arrow = el.firstElementChild as HTMLElement, letter = el.lastElementChild as HTMLElement;
      if (arrow.style.transform !== rot) arrow.style.transform = rot;
      if (letter.textContent !== s.letter) letter.textContent = s.letter;
      if (el.style.getPropertyValue("--c") !== s.color) el.style.setProperty("--c", s.color);
    }
  }
  for (const el of [...layer.children] as HTMLElement[]) if (!seen.has(el.dataset.edge ?? "")) el.remove();
}

/** Puts the agents' breathing rings where the frame just drew them (one element per agent and kind, kept between frames
 *  so its CSS animation runs on): only their place and strength change, on a frame the map draws anyway. */
function syncRings(layer: HTMLDivElement | null, rings: AgentRing[]) {
  if (!layer) return;
  const seen = new Set<string>();
  for (const r of rings) {
    const key = `${r.kind}:${r.id}`;
    seen.add(key);
    let el = layer.querySelector<HTMLElement>(`[data-ring="${CSS.escape(key)}"]`);
    if (!el) { el = document.createElement("i"); el.dataset.ring = key; el.className = `agent-ring ${r.kind}`; layer.appendChild(el); }
    const tr = `translate(${r.x.toFixed(1)}px, ${r.y.toFixed(1)}px)`, op = r.alpha.toFixed(2);
    if (el.style.transform !== tr) el.style.transform = tr;
    if (el.style.opacity !== op) el.style.opacity = op;
    if (el.style.getPropertyValue("--c") !== r.color) el.style.setProperty("--c", r.color);
  }
  for (const el of [...layer.children] as HTMLElement[]) if (!seen.has(el.dataset.ring ?? "")) el.remove();
}
