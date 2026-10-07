// Owner: D. Force graph of files/modules, glow by recency, a ripple per agent edit + outline while active, side panel + AskBox.
// The pieces: graph.ts (nodes, layout, forces), drawNode.ts (drawing a frame), color.ts (recency colours), labels.ts
// (names), useMapCamera.ts (what the camera frames), useLiveAgents.ts (agents on the map), redraw.ts (when to redraw).
import { LensSwitch } from "./LensSwitch";
import { MapStats } from "./MapStats";
import { clock, isReplay } from "../lib/live";
import { sinceMs } from "../lib/visit";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D, { type ForceGraphMethods, type NodeObject } from "react-force-graph-2d";
import type { FileNode } from "@contract";
import { useLive } from "../lib/live";
import { mapPrefs, useNav } from "../lib/nav";
import { drawAgents } from "./agents";
import { MapSidebar } from "./sidebar/MapSidebar";
import { Dock, FileToggle, GitToggle, LockToggle, ReadsToggle } from "./replay/ReplayBar";
import { Peek } from "./replay/Peek";
import { useStepWindow } from "./prefs";
import { TalkCard } from "./replay/TalkCard";
import { StepPanel } from "./StepPanel";
import { useSelectedFile } from "./useSelectedFile";
import { useReplayLayer, type ReplayLayerApi } from "./replay/layer";
import { makeFileResolver } from "../lib/paths";
import { clearTextWidths, drawQueuedLabels, LabelSpace, type QueuedLabel } from "./labels";
import { boxOf, useCamera, type Camera } from "./camera";
import { FitButton } from "./FitButton";
import { useTheme } from "../lib/theme";
import { mapStyle, settleLandings } from "./themes";
import { clearSprites, spriteFrame } from "./sprites";
import { createRedraw, Motion } from "./redraw";
import { css, readTokens } from "./color";
import { hitAt, nodeReach, shownLinks, stepTween, useGraph, type GLink, type GNode } from "./graph";
import { foldFrame, openAround, useFoldOn } from "./fold";
import { GIT_COLOURS, gitFiles, useShowGit, worktreeOf } from "./gitFilter";
import { drawFile, drawFocusLinks, drawFolderNames, FILE_LABELS_MAX, flushDots, labelFor, lookOf, moreMotion, newCaches, RIPPLE_MS, type Frame } from "./drawNode";
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
  // ---- the layout (graph.ts): files placed once by folder; laid out again only when files come or go ----
  // perf/web-store's structure counter when the store has it (files or imports added, removed or moved).
  const sv = (state as unknown as { structureVersion?: number }).structureVersion;
  const { graph, tween } = useGraph(map, theme, sv);
  const graphRef = useRef(graph); graphRef.current = graph;
  // ---- folders (fold.ts): open as you zoom; the files you look at, a thread's, an agent's open theirs at any zoom ----
  const foldOn = useFoldOn();
  const foldOnRef = useRef(foldOn); foldOnRef.current = foldOn;
  const [selected, setSelected, picked] = useSelectedFile(map?.root ?? ""); // in the link: /file/<path>; shown in the sidebar
  // What an open thread showed on the map and where a followed agent worked: their folders stay open while you watch.
  const [watched, setWatched] = useState<{ key: string; files: string[] }>({ key: "", files: [] });
  const [wrapRef, size] = useSize<HTMLDivElement>();
  const sizeRef = useRef(size); sizeRef.current = size;
  const fg = useRef<ForceGraphMethods<GNode, never> | undefined>(undefined);
  const tokens = useMemo(readTokens, [theme]);   // each theme sets its own colours (themes.css)
  const tokensRef = useRef(tokens); tokensRef.current = tokens;
  const style = mapStyle();
  const stepWindow = useStepWindow();
  const [hover, setHover] = useState<string | null>(null);
  // The camera works in the part of the canvas the sidebar, the side panels, the stats line and the footer leave free.
  const cam = useCamera(fg as never, wrapRef);
  const camRef = useRef<Camera>(cam); camRef.current = cam;

  // ---- redraws: only while something moves (redraw.ts) ----
  const redraw = useMemo(() => createRedraw(() => { const g = fg.current; if (g) g.zoom(g.zoom()); }), []);
  useEffect(() => () => redraw.stop(), [redraw]);

  // ---- live agents ----
  const { agents, drawnAgents, waiting, waitingRef, thinkingRef, agentsRef, anim, moving: agentsMoving } = useLiveAgents({
    agents: state.agents, attention: state.attention, hiddenAgents, threadId: replay?.sessionId ?? null, liveThread: !!replay?.live,
  });
  const hoverRef = useRef(hover); hoverRef.current = hover;
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const space = useRef(new LabelSpace());         // taken this frame: files, replay badges, folder names, file names
  const markedRef = useRef<string | null>(null);  // the file the replay's marker names this frame
  // Every file and folder by id (a folder's ends in "/").
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
  const liveShown = useRef(false);
  liveShown.current = !!replay && drawnAgents.some((a) => a.sessionId === replay.sessionId);
  const replayLayer = useReplayLayer({ fg: fg as never, wrapRef, nodeIndexRef, accent: tokens.accent, font: tokens.body, camera: camRef, liveShown });
  const replayRef = useRef<ReplayLayerApi>(replayLayer); replayRef.current = replayLayer;
  const openRef = useRef(!!replay); openRef.current = !!replay;
  const playingRef = useRef(false); playingRef.current = !!replay?.playing;

  // ---- the camera (useMapCamera.ts) ----
  const hasNodes = graph.nodes.length > 0;
  const { followId, setFollowId, followRef, fitNow, focusOnFile, applyIntent } = useMapCamera({
    cam, camRef, nodeIndex, nodeIndexRef, replayRef, replayActive: replayLayer.active, replay, step, selected, selectedRef, setSelected,
    resolveId, anim, hasNodes, focusFile, setFocusFile,
  });

  // The thread's files in view (its recent window, or all of it) and a followed agent's file open their folders, and
  // keep them open until the thread closes or you stop following: folders don't fold and open again as the window moves.
  const fpNow = replayLayer.footprint();
  useEffect(() => {
    const key = `${replay?.sessionId ?? ""}|${followId ?? ""}`;
    const add: string[] = [...(fpNow ?? [])];
    const agent = followId ? agents.find((a) => a.id === followId) : undefined;
    const at = agent?.file ? resolveId(agent.file) : undefined;
    if (at) add.push(at);
    setWatched((w) => {
      const base = w.key === key ? w.files : [], had = new Set(base);
      const more = add.filter((f) => !had.has(f));
      return more.length || w.key !== key ? { key, files: base.concat(more) } : w;
    });
  });

  // ---- when the selected file lets go by itself ----
  // A file is what you're looking at: it stays through tabs, zooms, steps and the Places lens, and lets go when your
  // attention moves to something that also wants the map. Entering a thread: unless the thread touched the file (you
  // likely came to see who changed it), as soon as the thread is loaded. Leaving a thread, pressing Play, changing
  // project: always.
  const sid = replay?.sessionId ?? null, playing = !!replay?.playing;
  const was = useRef<{ sid: string | null; playing: boolean; root: string; check: string | null }>({ sid, playing, root: map?.root ?? "", check: sid });
  useEffect(() => {
    const w = was.current, root = map?.root ?? "";
    if (sid !== w.sid) { if (!sid) setSelected(null); w.check = sid; }
    if (playing && !w.playing) setSelected(null);
    if (w.root && root && root !== w.root) setSelected(null);
    // The thread just entered, once it's built: keep the file only if the thread touched it.
    if (w.check && w.check === sid && replayLayer.active) {
      w.check = null;
      const f = selectedRef.current;
      if (f && !replayLayer.touches(f)) setSelected(null);
    }
    w.sid = sid; w.playing = playing; w.root = root || w.root;
  }, [sid, playing, map?.root, replayLayer.active, replayLayer.touches, setSelected]);

  // Import lines show only around the file under the pointer, or else the selected one, in every theme.
  const linkFocus = hover ?? selected;
  const linkFocusRef = useRef(linkFocus); linkFocusRef.current = linkFocus;

  // The folders that show open at any zoom: around the selected file, the one a link focuses, what the thread showed
  // and where a followed agent worked (agents at work are added per frame).
  // ---- the dock's Show git (gitFilter.ts): the files it rings, by id, with their colours and folders ----
  const gitState = state.git, showGit = useShowGit();
  const gitWt = worktreeOf(gitState, replay?.sessionId);
  const only = useMemo(() => {
    if (!showGit || !gitState || !map) return { files: null, dirs: null, nodes: [] as GNode[] };
    // A folder's ring, while it's closed: not committed inside it over committed (purple, blue).
    const base = map.root.replace(/\/+$/, ""), files = new Map<string, string>(), dirs = new Map<string, string>(), nodes: GNode[] = [];
    const quiet = new Set<string>([GIT_COLOURS.unpushed, GIT_COLOURS.branch]);
    for (const [rel, colour] of gitFiles(gitState, gitWt)) {
      const n = nodeIndex.get(`${base}/${rel}`);
      if (!n) continue;
      files.set(n.id, colour); nodes.push(n);
      for (let u = n.up; u; u = u.up) { const had = dirs.get(u.id); if (!had || (quiet.has(had) && !quiet.has(colour))) dirs.set(u.id, colour); }
    }
    return { files, dirs, nodes };
  }, [showGit, gitState, gitWt, map?.root, nodeIndex]);
  const onlyRef = useRef(only); onlyRef.current = only;

  const pinned = useMemo(() => {
    const set = new Set<GNode>();
    for (const f of [selected, focusFile, ...watched.files]) if (f) openAround(nodeIndex.get(f), set);
    if (only.nodes.length <= 400) for (const n of only.nodes) openAround(n, set);
    return set;
  }, [nodeIndex, selected, focusFile, watched.files, only]);
  const pinnedRef = useRef(pinned); pinnedRef.current = pinned;

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
    sel: null, hover: null, coolCss: "", looks: true, anyLook: false, lookSum: 0, motion: Motion.None, labN: [], labP: [],
    tokens, epoch: 0, recorded: recorded(), since: sinceMs, look: () => null, linkFocus: null, tracing: false, only: null, onlyDirs: null });
  const lastLookSum = useRef(0);
  const vis = useRef({ sig: 0, ver: 0 });   // what's open (fold.ts), and a counter bumped when it or the positions change
  const linkCache = useRef<{ key: string; links: GLink[]; g: typeof graph | null }>({ key: "", links: [], g: null });

  const startFrame = useCallback((_: CanvasRenderingContext2D, scale: number) => {
    const F = frame.current, g = fg.current, { w, h } = sizeRef.current;
    F.id++; F.scale = scale; F.now = clock(); F.t = performance.now(); F.st = mapStyle();
    F.sel = selectedRef.current; F.hover = hoverRef.current; F.coolCss = css(tokensRef.current.cool);
    F.tokens = tokensRef.current; F.epoch = epoch.current; F.look = replayRef.current.look;
    F.linkFocus = linkFocusRef.current; F.tracing = replayRef.current.tracing;
    F.only = onlyRef.current.files; F.onlyDirs = onlyRef.current.dirs;
    spriteFrame();
    // Off-screen files aren't drawn: the part of the map the camera shows, in graph units.
    const a = g?.screen2GraphCoords(0, 0), b = g?.screen2GraphCoords(w, h);
    if (a && b) { F.x0 = Math.min(a.x, b.x); F.x1 = Math.max(a.x, b.x); F.y0 = Math.min(a.y, b.y); F.y1 = Math.max(a.y, b.y); }
    // The focus is asked about every file only while a thread is open, or its fade back hasn't finished.
    F.looks = replayRef.current.active || F.anyLook;
    F.anyLook = false; F.lookSum = 0; F.motion = Motion.None;
    F.labN.length = 0; F.labP.length = 0;
    for (const d of caches.current.dots.values()) d.xyr.length = 0;
    settleLandings(F.t);
    // Files came or went: the circles that moved glide to their new places.
    if (stepTween(tween, F.t)) { moreMotion(F, Motion.Smooth); vis.current.ver++; }
    // What's open at this zoom; an agent at work shows its folders open too.
    let forced: ReadonlySet<GNode> = pinnedRef.current;
    for (const ag of agentsRef.current) {
      if (!ag.active || !ag.file) continue;
      const id = resolveId(ag.file), n = id ? nodeIndexRef.current.get(id) : undefined;
      if (!n) continue;
      if (forced === pinnedRef.current) forced = new Set(forced);
      openAround(n, forced as Set<GNode>);
    }
    const sig = foldFrame(graphRef.current, scale, forced, foldOnRef.current);
    if (sig !== vis.current.sig) { vis.current.sig = sig; vis.current.ver++; }
  }, [resolveId]);

  const drawNode = useCallback((node: NodeObject, ctx: CanvasRenderingContext2D, scale: number) => {
    const F = frame.current;
    drawFile(ctx, node as GNode, scale, F, caches.current);
  }, []);

  // ---- names: the space they may take (labels.ts), then the open folders' names (drawNode.ts) ----
  const focusVer = useRef<{ ids: string[] | null; v: number }>({ ids: null, v: 0 });
  const geomVer = useRef(0);   // bumped when a file's size or activity changes (its reach, so its footprint)
  const lastGeom = useRef<{ files: FileNode[] | null }>({ files: null });
  useEffect(() => { if (lastGeom.current.files !== (map?.files ?? null)) { lastGeom.current.files = map?.files ?? null; geomVer.current++; } }, [map?.files]);
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
    sp.fileLayer(`${vis.current.ver}|${g.id}|${geomVer.current}|${theme}|${cell}|${fv.v}`, cell, (add) => {
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
  }, [theme]);

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
      thinking: thinkingRef.current, keep: openRef.current,
      resolve: (id) => { const n = nodeIndexRef.current.get(id); return n && n.x !== undefined && n.y !== undefined ? { x: n.x, y: n.y, r: n.r } : undefined; },
    });
  }, [resolveId]);

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
    if (agentsMoving(F.t) || (replayRef.current.tracing && replayRef.current.active && playingRef.current)) moreMotion(F, Motion.Smooth);
    else if (replayRef.current.thinking && replayRef.current.tracing) moreMotion(F, Motion.Slow);   // the marker's thinking ring
    redraw.drew(F.motion);
  }, [drawModules, drawAgentLayer, redraw]);


  // ---- what makes a frame come ----
  const fp = replayLayer.footprint();
  const footprintKey = fp ? `${fp.length}|${fp[0] ?? ""}|${fp[fp.length - 1] ?? ""}` : "";
  // Anything that changes the picture: one frame (the frame itself says if more must follow).
  useEffect(() => { redraw.kick(); }, [redraw, graph, map?.files, drawnAgents, waiting, followId, hover, selected, tokens, theme, replay,
    replayLayer.active, replayLayer.tracing, replayLayer.footprintMode, showReads, stepWindow, footprintKey, size.w, size.h, only]);
  // A replay step: the tracer glides, a read flashes, an edit pulses (up to about a second).
  useEffect(() => { redraw.kick(1300); }, [redraw, replay?.index, replay?.sessionId, replay?.mode]);
  // A new agent position, error or activity: its glide, flash or pulse plays out (drawAgents), the frame keeps them coming.
  useEffect(() => { redraw.kick(100); }, [redraw, state.agents]);

  // Files came or went: the frame keeps coming while the circles that moved glide (stepTween).
  useEffect(() => { if (tween.current) redraw.kick(700); }, [graph, redraw, tween]);
  // A closed folder: the camera goes into it (which opens it, fold.ts). A file: selected, or let go if it already was.
  const onNodeClick = useCallback((g: GNode) => {
    if (!g.dir) { setSelected(selectedRef.current === g.id ? null : g.id); return; }   // the selected file again: let go of it
    const x = g.x ?? 0, y = g.y ?? 0, r = g.r;
    camRef.current.frame({ x0: x - r, x1: x + r, y0: y - r, y1: y + r }, { pad: 24, maxZoom: 12 }, 750);
  }, [setSelected]);
  // Pointing and clicking, worked out against where the circles are this frame (graph.ts hitAt), not force-graph's hit
  // map (repainted at most every 0.8 s). A click is a press and release less than 5 px apart: a trackpad's wobble
  // still clicks, a pan doesn't.
  const clickRef = useRef(onNodeClick); clickRef.current = onNodeClick;
  const hasCanvas = graph.nodes.length > 0;
  useEffect(() => {
    const canvas = wrapRef.current?.querySelector("canvas");
    if (!canvas) return;
    const at = (e: PointerEvent) => {
      const g = fg.current, r = canvas.getBoundingClientRect();
      if (!g) return null;
      const p = g.screen2GraphCoords(e.clientX - r.left, e.clientY - r.top);
      return hitAt(graphRef.current, p.x, p.y, g.zoom());
    };
    let down: { x: number; y: number; t: number } | null = null, raf = 0, last: PointerEvent | null = null;
    const point = () => {
      raf = 0;
      if (!last || down) return;
      const n = at(last), id = n?.id ?? null;
      canvas.style.cursor = n ? "pointer" : "";
      if (id !== hoverRef.current) setHover(id);
    };
    const onMove = (e: PointerEvent) => { last = e; if (!raf) raf = requestAnimationFrame(point); };
    const onDown = (e: PointerEvent) => { if (e.button === 0) down = { x: e.clientX, y: e.clientY, t: performance.now() }; };
    const onUp = (e: PointerEvent) => {
      const d = down; down = null;
      if (!d || e.button !== 0 || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) return;
      const n = at(e);
      if (n) clickRef.current(n); else setSelected(null);
    };
    const onLeave = () => { last = null; down = null; canvas.style.cursor = ""; if (hoverRef.current) setHover(null); };
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener("pointermove", onMove); canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp); canvas.removeEventListener("pointerleave", onLeave);
    };
  }, [hasCanvas, setSelected]);

  const sel = selected ? nodeIndex.get(selected)?.file : undefined;
  const closeFile = useCallback(() => setSelected(null), [setSelected]);

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
          onRenderFramePre={startFrame}
          onRenderFramePost={endFrame}
          warmupTicks={0}
          cooldownTicks={0}
          enableNodeDrag={false}
          enablePointerInteraction={false}
        />
      )}


      <MapSidebar agents={agents} accent={tokens.accent} followId={followId}
        onFollow={(id) => setFollowId(id)} onFocusFile={focusOnFile} map={map}
        file={sel} picked={picked} onCloseFile={closeFile} />
      <MapStats />
      <TalkCard />
      <LensSwitch />
      {graph.nodes.length > 0 && <FitButton onFit={fitNow} label={replay ? "Fit the thread's files" : "Fit the whole project"} />}

      <Peek />
      <Dock>
        <ReadsToggle />
        <FileToggle />
        <GitToggle />
        <LockToggle shown={!!replay || !!followId} />
      </Dock>

      <StepPanel />
    </div>
  );
}

const nodeVal = (n: NodeObject) => (n as GNode).r * (n as GNode).r;
const noLabel = () => "";
