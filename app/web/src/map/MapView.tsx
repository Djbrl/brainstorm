// Owner: D. Force graph of files/modules, glow by recency, a ripple per agent edit + outline while active, side panel + AskBox.
// The pieces: graph.ts (nodes, layout, forces), drawNode.ts (drawing a frame), color.ts (recency colours), labels.ts
// (names), useMapCamera.ts (what the camera frames), useLiveAgents.ts (agents on the map), redraw.ts (when to redraw).
import { LensSwitch } from "./LensSwitch";
import { MapStats } from "./MapStats";
import { clock, isReplay } from "../lib/live";
import { lastSeen, sinceMs } from "../lib/visit";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D, { type ForceGraphMethods, type NodeObject } from "react-force-graph-2d";
import type { FileNode } from "@contract";
import { useLive } from "../lib/live";
import { mapPrefs, useNav } from "../lib/nav";
import { drawAgents } from "./agents";
import { MapSidebar } from "./sidebar/MapSidebar";
import { Dock, LockToggle, ReadsToggle } from "./replay/ReplayBar";
import { useStepWindow } from "./prefs";
import { TalkCard } from "./replay/TalkCard";
import { StepPanel } from "./StepPanel";
import { FilePanel, useSelectedFile } from "./FilePanel";
import { useReplayLayer, type ReplayLayerApi } from "./replay/layer";
import { makeFileResolver } from "../lib/paths";
import { aggregateFolders, clearTextWidths, drawModuleLabels, drawQueuedLabels, LabelSpace, type Folders, type QueuedLabel } from "./labels";
import { useCamera, type Camera } from "./camera";
import { FitButton } from "./FitButton";
import { useTheme } from "../lib/theme";
import { mapStyle, reachOf, settleLandings } from "./themes";
import { clearSprites, spriteFrame } from "./sprites";
import { createRedraw, Motion } from "./redraw";
import { savePositions, useSavedPositions } from "./positions";
import { css, readTokens } from "./color";
import { useForces, useGraph, type GNode } from "./graph";
import { drawFile, drawLinks, FILE_LABELS_MAX, flushDots, labelFor, lookOf, moreMotion, newCaches, paintHit, RIPPLE_MS, type Frame } from "./drawNode";
import { useMapCamera } from "./useMapCamera";
import { useLiveAgents } from "./useLiveAgents";
import "./map.css";

/** A recording (the hosted demo) or a shared replay: fixed for the page's life, read once (it parses the URL). */
let replayed: boolean | undefined;
const recorded = () => (replayed ??= isReplay());

export function relTime(iso: string | undefined, now = clock()): string {
  if (!iso) return "not changed recently";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 45) return "changed just now";
  if (s < 3600) return `changed ${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `changed ${Math.round(s / 3600)} h ago`;
  return `changed ${Math.round(s / 86400)} days ago`;
}

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

// ---------- view ----------
export function MapView() {
  const { state } = useLive();
  const { focusFile, setFocusFile, hiddenAgents, replay, step, showReads } = useNav();
  const map = state.map;
  const theme = useTheme();
  const saved = useSavedPositions(map?.root ?? null, theme);
  // perf/web-store's structure counter when the store has it (files or imports added, removed or moved), else content.
  const graph = useGraph(map, theme, saved, (state as unknown as { structureVersion?: number }).structureVersion);
  const graphRef = useRef(graph); graphRef.current = graph;
  const [wrapRef, size] = useSize<HTMLDivElement>();
  const sizeRef = useRef(size); sizeRef.current = size;
  const fg = useRef<ForceGraphMethods<GNode, never> | undefined>(undefined);
  const { heat, big } = useForces(fg, graph, theme);
  const tokens = useMemo(readTokens, [theme]);   // each theme sets its own colours (themes.css)
  const tokensRef = useRef(tokens); tokensRef.current = tokens;
  const style = mapStyle();
  const stepWindow = useStepWindow();
  const [selected, setSelected] = useSelectedFile(map?.root ?? ""); // in the link: /file/<path>
  const [hover, setHover] = useState<string | null>(null);
  const settledFit = useRef(false);
  const root = map?.root ?? "";
  // The camera works in the part of the canvas the sidebar, the side panels, the stats line and the footer leave free.
  const cam = useCamera(fg as never, wrapRef);
  const camRef = useRef<Camera>(cam); camRef.current = cam;

  // ---- redraws: only while something moves (redraw.ts) ----
  const redraw = useMemo(() => createRedraw(() => { const g = fg.current; if (g) g.zoom(g.zoom()); }), []);
  useEffect(() => () => redraw.stop(), [redraw]);

  // ---- live agents ----
  const { agents, drawnAgents, waiting, waitingRef, agentsRef, anim, moving: agentsMoving } = useLiveAgents({
    agents: state.agents, attention: state.attention, hiddenAgents, threadId: replay?.sessionId ?? null, liveThread: !!replay?.live,
  });
  const hoverRef = useRef(hover); hoverRef.current = hover;
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const space = useRef(new LabelSpace());         // taken this frame: files, replay badges, folder names, file names
  const markedRef = useRef<string | null>(null);  // the file the replay's marker names this frame
  const nodeIndex = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph.nodes]);
  const nodeIndexRef = useRef(nodeIndex); nodeIndexRef.current = nodeIndex;
  /** Map an agent's file (or a searched directory) to a node id on the map. */
  const fileResolver = useMemo(() => makeFileResolver(map), [nodeIndex, map?.root, map?.formerRoots]);   // paths only: not every file update
  // Every answer is kept (misses too) until the files change: agents ask for the same few files on every frame.
  const resolved = useMemo(() => new Map<string, string | null>(), [nodeIndex, fileResolver]);
  const resolvedRef = useRef({ resolved, fileResolver }); resolvedRef.current = { resolved, fileResolver };
  const resolveId = useCallback((file: string): string | undefined => {
    const { resolved: memo, fileResolver: same } = resolvedRef.current;
    const hit = memo.get(file);
    if (hit !== undefined) return hit ?? undefined;
    const idx = nodeIndexRef.current;
    let id: string | undefined;
    if (idx.has(file)) id = file;
    else {
      const other = same(file); // same file in another worktree of this repo
      if (other && idx.has(other)) id = other;
      else {
        const dir = file.replace(/\/+$/, "") + "/";
        for (const k of idx.keys()) if (k.startsWith(dir)) { id = k; break; }
      }
    }
    memo.set(file, id ?? null);
    return id;
  }, []);
  const replayLayer = useReplayLayer({ fg: fg as never, wrapRef, nodeIndexRef, accent: tokens.accent, font: tokens.body, camera: camRef });
  const replayRef = useRef<ReplayLayerApi>(replayLayer); replayRef.current = replayLayer;
  const openRef = useRef(!!replay); openRef.current = !!replay;
  const playingRef = useRef(false); playingRef.current = !!replay?.playing;

  // ---- the camera (useMapCamera.ts) ----
  const hasNodes = graph.nodes.length > 0;
  const { followId, setFollowId, followRef, fitNow, focusOnFile, applyIntent } = useMapCamera({
    cam, camRef, nodeIndex, nodeIndexRef, replayRef, replayActive: replayLayer.active, replay, step, selected, selectedRef, setSelected,
    resolveId, anim, hasNodes, focusFile, setFocusFile,
  });

  // Import lines show only around the file under the pointer, or else the selected one (Metro keeps all its lines).
  const linkFocus = hover ?? selected;
  const linkFocusRef = useRef(linkFocus); linkFocusRef.current = linkFocus;

  // ---- what drawing keeps between frames (drawNode.ts) ----
  const caches = useRef(newCaches());
  // One-shot ripples: start one when a file receives a new agent edit (not on first load).
  const seenEdits = useRef<Map<string, FileNode> | null>(null);
  useEffect(() => {
    const files = map?.files ?? [];
    const first = seenEdits.current === null;
    const seen = seenEdits.current ?? new Map<string, FileNode>();
    let started = false;
    for (const f of files) {
      const prev = seen.get(f.path);
      if (prev === f) continue;   // the store keeps unchanged files as they were: only the changed ones are compared
      if (!first && prev !== undefined && (prev.lastChangedAt !== f.lastChangedAt || prev.activeSessionId !== f.activeSessionId)
        && f.activeSessionId && f.lastChangedAt !== prev.lastChangedAt) { caches.current.ripples.set(f.path, performance.now()); started = true; }
      seen.set(f.path, f);
    }
    seenEdits.current = seen;
    if (started) redraw.kick(RIPPLE_MS);
  }, [map?.files, redraw]);

  // ---- colours: kept per file, worked out again when its time changes, and every few seconds (recency fades) ----
  const epoch = useRef(0);
  useEffect(() => {
    const t = setInterval(() => { epoch.current++; redraw.kick(); }, 5000);
    return () => clearInterval(t);
  }, [redraw]);
  useEffect(() => { epoch.current++; clearSprites(); }, [tokens]);
  useEffect(() => {
    // A web font arrived: names were measured in the fallback font.
    const f = typeof document !== "undefined" ? document.fonts : undefined;
    if (!f) return;
    const done = () => { clearTextWidths(); redraw.kick(); };
    f.addEventListener?.("loadingdone", done);
    return () => f.removeEventListener?.("loadingdone", done);
  }, [redraw]);

  // ---- the frame ----
  const frame = useRef<Frame>({ id: 0, scale: 1, x0: -Infinity, y0: -Infinity, x1: Infinity, y1: Infinity, now: 0, t: 0, st: style,
    sel: null, hover: null, coolCss: "", looks: true, anyLook: false, lookSum: 0, motion: Motion.None, linksDone: false, labN: [], labP: [],
    tokens, epoch: 0, recorded: recorded(), since: sinceMs, look: () => null, linkFocus: null, tracing: false });
  const lastLookSum = useRef(0);
  const ticks = useRef(0);

  const startFrame = useCallback((_: CanvasRenderingContext2D, scale: number) => {
    const F = frame.current, g = fg.current, { w, h } = sizeRef.current;
    F.id++; F.scale = scale; F.now = clock(); F.t = performance.now(); F.st = mapStyle();
    F.sel = selectedRef.current; F.hover = hoverRef.current; F.coolCss = css(tokensRef.current.cool);
    F.tokens = tokensRef.current; F.epoch = epoch.current; F.look = replayRef.current.look;
    F.linkFocus = linkFocusRef.current; F.tracing = replayRef.current.tracing;
    spriteFrame();
    // Off-screen files aren't drawn: the part of the map the camera shows, in graph units.
    const a = g?.screen2GraphCoords(0, 0), b = g?.screen2GraphCoords(w, h);
    if (a && b) { F.x0 = Math.min(a.x, b.x); F.x1 = Math.max(a.x, b.x); F.y0 = Math.min(a.y, b.y); F.y1 = Math.max(a.y, b.y); }
    // The focus is asked about every file only while a thread is open, or its fade back hasn't finished.
    F.looks = replayRef.current.active || F.anyLook;
    F.anyLook = false; F.lookSum = 0; F.motion = Motion.None; F.linksDone = false;
    F.labN.length = 0; F.labP.length = 0;
    for (const d of caches.current.dots.values()) d.xyr.length = 0;
    settleLandings(F.t);
  }, []);

  const drawNode = useCallback((node: NodeObject, ctx: CanvasRenderingContext2D, scale: number) => {
    const F = frame.current;
    if (!F.linksDone) { F.linksDone = true; drawLinks(ctx, scale, graphRef.current.links, F, caches.current); }   // after the layout's tick, before the first file
    drawFile(ctx, node as GNode, scale, F, caches.current);
  }, []);

  // ---- folder names (labels.ts): the folders' outlines are kept until the files move or change ----
  const folders = useRef<{ key: string; folders: Folders } | null>(null);
  const focusVer = useRef<{ ids: string[] | null; v: number }>({ ids: null, v: 0 });
  const geomVer = useRef(0);   // bumped when a file's size or activity changes (its reach, so its footprint)
  const lastGeom = useRef<{ files: FileNode[] | null }>({ files: null });
  useEffect(() => { if (lastGeom.current.files !== (map?.files ?? null)) { lastGeom.current.files = map?.files ?? null; geomVer.current++; } }, [map?.files]);
  const editedAt = useRef(new Map<string, number>());
  const drawModules = useCallback((ctx: CanvasRenderingContext2D, scale: number) => {
    // Every file's footprint goes in first: no name, folder or file, prints over a file. With a thread open, the files it
    // never touched (or hasn't reached yet) are faded into the background: its own names may cross those, not the rest.
    const F = frame.current, st = F.st, sp = space.current, g = graphRef.current;
    sp.reset(48 / scale);
    const ids = replayRef.current.footprint();
    const fv = focusVer.current;
    if (ids?.length !== fv.ids?.length || (ids && fv.ids && ids.some((id, i) => id !== fv.ids![i])) || !ids !== !fv.ids) { fv.ids = ids; fv.v++; }
    const cell = 2 ** Math.round(Math.log2(48 / scale));
    sp.fileLayer(`${ticks.current}|${g.id}|${geomVer.current}|${theme}|${cell}|${fv.v}`, cell, (add) => {
      const inFocus = ids ? new Set(ids) : null;
      for (const n of g.nodes) {
        if (n.x === undefined || n.y === undefined || (inFocus && !inFocus.has(n.id))) continue;
        add(n.id, n.x, n.y, reachOf(n.r, !!n.file.activeSessionId, st));
      }
    });
    const ring = (n: GNode) => (st.node === "dot" ? n.r : n.r * 1.35 + 2 / scale);   // the selection ring (drawNode)
    for (const id of [F.sel, F.hover]) {
      const n = id ? nodeIndexRef.current.get(id) : undefined;
      if (n?.x !== undefined && n.y !== undefined) sp.file(n.id, n.x, n.y, Math.max(reachOf(n.r, !!n.file.activeSessionId, st), ring(n)));
    }
    // The replay's badges and marker are drawn last, on top, but take their space now: names keep off them too.
    const marks = replayRef.current.marks(ctx, scale);
    for (const b of marks.boxes) sp.add(b);
    markedRef.current = marks.named;
    // The folders' outlines, kept until the files move (the layout ticks: every few ticks while it runs, and once it
    // stops) or change.
    const fkey = `${Math.floor(ticks.current / 6)}|${g.id}|${geomVer.current}|${theme}`;
    if (folders.current?.key !== fkey) {
      folders.current = { key: fkey, folders: aggregateFolders(g.nodes.map((n) => ({ x: n.x, y: n.y, r: reachOf(n.r, !!n.file.activeSessionId, st),
        module: n.file.module, lastChangedAt: n.file.lastChangedAt, active: !!n.file.activeSessionId }))) };
    }
    // In a focus, folder names rank by what the thread changed, not by what the rest of the project did; a folder with
    // none of its files in the focus steps back with them.
    let lit: Set<string> | null = null, focusRecent: Map<string, number> | null = null;
    if (ids) {
      // Every file eases into the focus together: one of them says whether it has taken over (a thread that changed
      // nothing has no files of its own in it, and every folder steps back).
      const one = g.nodes[0] ? lookOf(g.nodes[0], F) : null;
      if (one && one.tone > 0.5) { lit = new Set(); focusRecent = new Map(); }
      for (const id of ids) {
        const n = nodeIndexRef.current.get(id), l = n ? lookOf(n, F) : null;
        if (!n || !l || l.tone <= 0.5) continue;
        lit ??= new Set(); focusRecent ??= new Map();
        if (l.alpha > 0.3) lit.add(n.file.module);
        if (l.edited) {
          let ms = editedAt.current.get(l.edited);
          if (ms === undefined) { ms = Date.parse(l.edited); if (editedAt.current.size > 5000) editedAt.current.clear(); editedAt.current.set(l.edited, ms); }
          if (ms > (focusRecent.get(n.file.module) ?? 0)) focusRecent.set(n.file.module, ms);
        }
      }
    }
    const idx = nodeIndexRef.current;
    const focus = new Set<string>();
    for (const id of [F.hover, F.sel]) { const n = id ? idx.get(id) : undefined; if (n) focus.add(n.file.module); }
    const busy = new Set<string>();
    for (const a of agentsRef.current) {
      if (!a.active || !a.file) continue;
      const id = resolveId(a.file), n = id ? idx.get(id) : undefined;
      if (n) busy.add(n.file.module);
    }
    drawModuleLabels(ctx, scale, folders.current.folders, { font: tokensRef.current.display, now: F.now, focus, busy, space: sp, lit, focusRecent, view: F });
  }, [theme, resolveId]);

  // Labels go on after the files (folder names, then file names), so no circle covers a name; then the agents.
  const drawAgentLayer = useCallback((ctx: CanvasRenderingContext2D, scale: number) => {
    const F = frame.current, tokens = tokensRef.current;
    // File names go on after every file is drawn, so no circle covers a name (the selected one's last, on top).
    // The file the replay's marker names (drawModules) isn't named twice. Only the most important ones are placed.
    const named = markedRef.current, order = F.labN.map((_, i) => i);
    if (order.length > FILE_LABELS_MAX) { order.sort((a, b) => F.labP[b] - F.labP[a]); order.length = FILE_LABELS_MAX; }
    const queue: QueuedLabel[] = [];
    for (const i of order) {
      const l = labelFor(F.labN[i], F.labP[i], F);
      if (named && l.at?.id === named && !l.must) continue;
      queue.push(l);
    }
    drawQueuedLabels(ctx, queue, space.current);
    replayRef.current.draw(ctx, scale);
    drawAgents({
      ctx, scale, agents: agentsRef.current, anim: anim.current, accent: tokens.accent, font: tokens.body,
      hoverFile: hoverRef.current, followId: followRef.current, resolveId, showReads: mapPrefs.showReads, quiet: !openRef.current, waiting: waitingRef.current,
      resolve: (id) => { const n = nodeIndexRef.current.get(id); return n && n.x !== undefined && n.y !== undefined ? { x: n.x, y: n.y, r: n.r } : undefined; },
    });
  }, [resolveId]);

  const endFrame = useCallback((ctx: CanvasRenderingContext2D, scale: number) => {
    const F = frame.current;
    flushDots(ctx, caches.current.dots, scale);
    drawModules(ctx, scale);
    drawAgentLayer(ctx, scale);
    ctx.globalAlpha = 1;
    // What still moves decides whether the next frame comes (redraw.ts).
    if (Math.abs(F.lookSum - lastLookSum.current) > 1e-6) moreMotion(F, Motion.Smooth);   // files easing into or out of a focus
    lastLookSum.current = F.lookSum;
    if (agentsMoving(F.t) || (replayRef.current.tracing && replayRef.current.active && playingRef.current)) moreMotion(F, Motion.Smooth);
    redraw.drew(F.motion);
  }, [drawModules, drawAgentLayer, redraw]);

  const paintHitArea = useCallback((node: NodeObject, color: string, ctx: CanvasRenderingContext2D, scale: number) =>
    paintHit(node as GNode, color, ctx, scale, frame.current), []);

  // ---- what makes a frame come ----
  const fp = replayLayer.footprint();
  const footprintKey = fp ? `${fp.length}|${fp[0] ?? ""}|${fp[fp.length - 1] ?? ""}` : "";
  // Anything that changes the picture: one frame (the frame itself says if more must follow).
  useEffect(() => { redraw.kick(); }, [redraw, graph, map?.files, drawnAgents, waiting, followId, hover, selected, tokens, theme, replay,
    replayLayer.active, replayLayer.tracing, replayLayer.footprintMode, showReads, stepWindow, footprintKey, size.w, size.h]);
  // A replay step: the tracer glides, a read flashes, an edit pulses (up to about a second).
  useEffect(() => { redraw.kick(1300); }, [redraw, replay?.index, replay?.sessionId, replay?.mode]);
  // A new agent position, error or activity: its glide, flash or pulse plays out (drawAgents), the frame keeps them coming.
  useEffect(() => { redraw.kick(100); }, [redraw, state.agents]);

  // Where the files settled, remembered for the next visit (positions.ts).
  const saveTimer = useRef(0);
  useEffect(() => () => clearTimeout(saveTimer.current), []);
  const onEngineStop = useCallback(() => {
    if (!settledFit.current) { settledFit.current = true; applyIntent(900); }
    geomVer.current++;   // the folders' outlines where the files came to rest
    const g = graphRef.current, r = root;
    clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => { if (g.nodes.length) void savePositions(r, theme, g.nodes); }, 800);
    redraw.kick();
  }, [applyIntent, root, theme, redraw]);
  const onEngineTick = useCallback(() => { ticks.current++; redraw.ticked(); }, [redraw]);
  const onNodeHover = useCallback((n: NodeObject | null) => setHover(n ? (n as GNode).id : null), []);
  const onNodeClick = useCallback((n: NodeObject) => setSelected((n as GNode).id), [setSelected]);
  const onBackgroundClick = useCallback(() => setSelected(null), [setSelected]);
  // A file dragged by hand: its neighbours answer in full, for as long as the drag lasts (a full run's stopping point).
  const [dragged, setDragged] = useState<typeof graph | null>(null);
  const onNodeDrag = useCallback(() => { heat.current = 1; setDragged(() => graphRef.current); }, []);

  const sel = selected ? nodeIndex.get(selected)?.file : undefined;
  // A layout run stops once its push is spent (d3AlphaMin, in force-graph's alpha). A big map cools faster: fewer, bigger
  // steps. A small map's full layout runs as it always did (cooldownTicks). A gentle run is short: about 40 steps to make
  // room for a few new files, 15 to settle positions put back from the last visit.
  const alphaDecay = big ? 0.05 : 0.0228;
  const alphaMin = graph.heat >= 1 || dragged === graph ? (big ? 0.002 : 0) : (1 - alphaDecay) ** (graph.heat <= 0.02 ? 15 : 40);

  return (
    <div className="map-wrap" ref={wrapRef}>
      {graph.nodes.length === 0 ? (
        <div className="map-empty">
          <h2>Mapping the codebase…</h2>
          <p>Files appear here as soon as the mapper has read them.</p>
        </div>
      ) : (
        <ForceGraph2D<GNode, never>
          ref={fg as never}
          width={size.w}
          height={size.h}
          graphData={graph.data}
          backgroundColor="rgba(0,0,0,0)"
          nodeId="id"
          nodeRelSize={1}
          nodeVal={nodeVal}
          nodeLabel={noLabel}
          nodeCanvasObject={drawNode}
          nodePointerAreaPaint={paintHitArea}
          onRenderFramePre={startFrame}
          onRenderFramePost={endFrame}
          cooldownTicks={400}
          d3AlphaMin={alphaMin}
          d3AlphaDecay={alphaDecay}
          d3VelocityDecay={0.35}
          onEngineTick={onEngineTick}
          onEngineStop={onEngineStop}
          onNodeHover={onNodeHover}
          onNodeClick={onNodeClick}
          onNodeDrag={onNodeDrag}
          onBackgroundClick={onBackgroundClick}
        />
      )}


      <MapSidebar agents={agents} accent={tokens.accent} followId={followId}
        onFollow={(id) => setFollowId(id)} onFocusFile={focusOnFile} map={map} />
      <MapStats />
      <TalkCard />
      <LensSwitch />
      {graph.nodes.length > 0 && <FitButton onFit={fitNow} label={replay ? "Fit the thread's files" : "Fit the whole project"} />}

      <Dock>
        <div className="dock-legend" aria-label="Legend">
          <span><i style={{ background: "var(--hot)" }} />Just now</span>
          <span><i style={{ background: "var(--warm)" }} />{isReplay() ? "This hour" : lastSeen ? "Since you last looked" : "In the last day"}</span>
          <span><i style={{ background: "var(--cool)" }} />Earlier</span>
          {/* With a thread open the colours are its own changes; what it only read is the faint dot. */}
          {replay && showReads && <span className="dock-legend-read" title="Files this thread read but didn't change"><i style={{ background: "var(--cool)", opacity: 0.5 }} />Read</span>}
          {sel && <span title="What the selected file imports"><i className="line" style={{ background: style.imports }} />Imports</span>}
        </div>
        <ReadsToggle />
        <LockToggle shown={!!replay || !!followId} />
      </Dock>

      <StepPanel />
      <FilePanel file={step ? undefined : sel} root={root} steps={state.steps} edges={map?.edges ?? []} onFocus={focusOnFile} onClose={() => setSelected(null)} />
    </div>
  );
}

const nodeVal = (n: NodeObject) => (n as GNode).r * (n as GNode).r;
const noLabel = () => "";
