// Force graph of files/modules, glow by recency, a ripple per agent edit + outline while active, side panel + AskBox.
// The pieces: graph.ts (nodes, layout, forces), drawNode.ts (drawing a frame), color.ts (recency colours), labels.ts
// (names), useMapCamera.ts (what the camera frames), useLiveAgents.ts (agents on the map), redraw.ts (when to redraw).
import { LensSwitch } from "./LensSwitch";
import { clock } from "../lib/live";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProjectMap } from "@contract";
import { mapPrefs, useNavState, useReplay } from "../lib/nav";
import { visibleAgents } from "./agents";
import { TOUR_AGENT, useTour } from "../lib/tour";
import { MapSidebar } from "./sidebar/MapSidebar";
import { Dock } from "./thread/Dock";
import { FileWindow } from "./thread/FileWindow";
import { useStepWindow } from "./prefs";
import { StepPanel } from "./StepPanel";
import { useSelectedFile } from "./useSelectedFile";
import { useThreadLayer, type ThreadLayerApi } from "./thread/ThreadLayer";
import { islandPath, isPlaceRoot, useIslands } from "../lib/islands";
import { enterProject } from "../lib/switcher";
import { focusAgent, setAgentFocus, useAgentFocus } from "../lib/agentFocus";
import { useLiveActions, useLiveSelector, useThreadSteps } from "../lib/live";
import { useNavActions } from "../lib/nav";
import { useCamera, type Camera, type ReplayCamera } from "./camera";
import { useTheme } from "../lib/theme";
import { createRedraw } from "./redraw";
import { readTokens } from "./color";
import { useGraph, type GNode } from "./graph";
import { useFoldOn } from "./fold";
import { newCaches } from "./drawNode";
import { useMapFrame } from "./useMapFrame";
import { useCanvasPointer } from "./useCanvasPointer";
import { useCanvasZoom } from "./useCanvasZoom";
import { useRedrawTriggers } from "./useRedrawTriggers";
import { useOpenFolders } from "./useOpenFolders";
import { useNodeResolver } from "./useNodeResolver";
import { useMapCamera } from "./useMapCamera";
import { useLiveAgents } from "./useLiveAgents";
import { Readmap, trackable } from "./Readmap";
import { useAutoTrack } from "./autoTrack";
import { setReadmap, useReadmap } from "./prefs";
import { useShortcut, windowOpen } from "../switch/shortcuts";
import "./map.css";
import { readStored, writeStored } from "../lib/store";
import { useLatest, useNow, useSize } from "../lib/hooks";

/** Below this width the map is small (the Claude app's browser pane, a half screen): the camera follows an open
 *  thread's agent up close by itself. */
export const SMALL_MAP = 1100;

export function relTime(iso: string | undefined, now = clock()): string {
  if (!iso) return "not changed recently";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 45) return "changed just now";
  if (s < 3600) return `changed ${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `changed ${Math.round(s / 3600)} h ago`;
  return `changed ${Math.round(s / 86400)} days ago`;
}


// ---------- view ----------
export function MapView() {
  const map = useLiveSelector((s) => s.map);
  const sessions = useLiveSelector((s) => s.sessions);
  const liveAgentsById = useLiveSelector((s) => s.agents);
  const attention = useLiveSelector((s) => s.attention);
  const { focusFile, hiddenAgents, step, showReads } = useNavState();
  const { setFocusFile } = useNavActions();
  const replay = useReplay();
  const theme = useTheme();
  // ---- the layout (graph.ts): files placed once by folder; laid out again only when files come or go ----
  // perf/web-store's structure counter when the store has it (files or imports added, removed or moved).
  const sv = useLiveSelector((s) => s.structureVersion);
  // Files outside the project (another repo an orchestrator edits, a visitor's own project): islands beside the map.
  const islandSteps = useThreadSteps(replay?.sessionId); // held while the thread is open
  // On the overview, only the agents still on the map (working, or seen in the last 10 minutes) keep an island: looked
  // at again every minute, so an agent that went quiet hours ago no longer leaves one beside the map.
  const islandMinute = useNow(60_000);
  const islandAgents = useMemo(() => {
    const all = Object.values(liveAgentsById ?? {});
    return replay ? all.filter((a) => a.sessionId === replay.sessionId) : visibleAgents(all);
  }, [liveAgentsById, replay?.sessionId, islandMinute]); // eslint-disable-line react-hooks/exhaustive-deps
  const islandThread = replay ? sessions.find((x) => x.id === replay.sessionId) : undefined;
  const islands = useIslands(map, islandThread, islandSteps, islandAgents, sessions);
  const { graph, tween } = useGraph(map, theme, sv, islands);
  const graphRef = useRef(graph); graphRef.current = graph;
  // ---- folders (fold.ts): open as you zoom; the files you look at, a thread's, an agent's open theirs at any zoom ----
  const foldOn = useFoldOn();
  const [selected, setSelected, picked] = useSelectedFile(map?.root ?? ""); // in the link: /file/<path>; shown in the sidebar
  const [wrapRef, size] = useSize<HTMLDivElement>();
  const small = size.w < SMALL_MAP;
  const smallRef = useRef(small); smallRef.current = small;
  // The canvas and its camera (useCanvasZoom.ts): it draws only when asked, so the map rests when nothing moves.
  const frameRef = useRef<(ctx: CanvasRenderingContext2D, k: number) => void>(() => {});
  const drawFrame = useCallback((ctx: CanvasRenderingContext2D, k: number) => frameRef.current(ctx, k), []);
  const { canvasRef, ref: fg } = useCanvasZoom({ width: size.w, height: size.h, draw: drawFrame });
  const tokens = useMemo(readTokens, [theme]);   // each theme sets its own colours (themes.css)
  const stepWindow = useStepWindow();
  const [hover, setHover] = useState<string | null>(null);
  // The camera works in the part of the canvas the sidebar, the side panels, the lens pill and the player leave free.
  const cam = useCamera(fg, wrapRef);
  const camRef = useRef<Camera>(cam); camRef.current = cam;

  // ---- redraws: only while something moves (redraw.ts) ----
  const redraw = useMemo(() => createRedraw(() => fg.current?.redraw()), []);
  useEffect(() => () => redraw.stop(), [redraw]);

  // ---- live agents ----
  // The tour's example agent (lib/tour.ts) walks the map with the real ones while its step shows.
  const tourAgent = useTour((t) => t.agent);
  const liveAgents = useMemo(() => (tourAgent ? { ...liveAgentsById, [tourAgent.id]: tourAgent } : liveAgentsById), [liveAgentsById, tourAgent]);
  const live = useLiveAgents({
    agents: liveAgents, attention, hiddenAgents, threadId: replay?.sessionId ?? null,
  });
  const { agents, drawnAgents, waiting, agentsRef, anim, dimmedRef } = live;
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const ringLayer = useRef<HTMLDivElement>(null);   // agents' breathing rings (useMapFrame's syncRings)
  // Every file and folder by id, and how an agent's file finds its node (useNodeResolver.ts).
  const { nodeIndex, nodeIndexRef, resolveId } = useNodeResolver(map, graph);
  const liveShown = useRef(false);
  liveShown.current = !!replay && drawnAgents.some((a) => a.sessionId === replay.sessionId);
  // The replay's camera follow and the map's camera talk through this (useMapCamera fills it in, the layer reads it).
  const replayCam = useRef<ReplayCamera>({ onLost: null, margin: () => 24, pinned: false });
  // What drawing keeps between frames (drawNode.ts): ripples, colour batches, a marker's landings.
  const caches = useRef(newCaches());
  const land = useCallback((id: string, t: number) => { caches.current.landings.set(id, t); }, []);
  const replayLayer = useThreadLayer({ nodeIndexRef, accent: tokens.accent, font: tokens.body, camera: camRef, follow: replayCam, land, liveShown });
  const replayRef = useRef<ThreadLayerApi>(replayLayer); replayRef.current = replayLayer;
  const openRef = useRef(!!replay); openRef.current = !!replay;

  // ---- the camera (useMapCamera.ts) ----
  const hasNodes = graph.nodes.length > 0;
  const { followId, setFollowId, refollow, followRef, focusOnFile } = useMapCamera({
    cam, camRef, replayCam, nodeIndex, nodeIndexRef, replayRef, replayActive: replayLayer.active, replay, step, selected, selectedRef, setSelected,
    resolveId, anim, hasNodes, focusFile, setFocusFile, smallRef,
  });
  // Looking back through the thread (its replay's marker on the map), the camera follows the marker, not an agent where
  // it is now: following stops (back at the newest moment, autoTrack follows the agent again).
  useEffect(() => { if (replay && !replay.live && replayLayer.tracing && followId) setFollowId(null); }, [replay?.live, replayLayer.tracing, followId, setFollowId]);
  // The tour's example agent: the camera follows it while it walks (its trail and reads show), and lets go after.
  const touring = !!tourAgent;
  useEffect(() => {
    if (touring) refollow(TOUR_AGENT);
    else if (followRef.current === TOUR_AGENT) setFollowId(null);
  }, [touring]);
  // A small map with a thread followed live: the camera follows its agent at work by itself (autoTrack.ts).
  useAutoTrack({ on: small && !!replay?.live && replayLayer.active, sessionId: replay?.sessionId ?? null, agents: drawnAgents, followId, setFollowId });

  // Faint: with a thread open, its agents you aren't watching (one followed, or one on its own: agentFocus, the others).
  // Looking back through it they stay as they are: solid where they are now, the replay's own marker faint where the
  // thread was (thread/ThreadLayer.ts).
  const focus = useAgentFocus(replay?.sessionId ?? null);
  dimmedRef.current = useMemo(() => {
    if (!replay) return new Set<string>();
    const lead = followId ?? focus;
    return new Set(lead ? drawnAgents.filter((a) => a.id !== lead).map((a) => a.id) : []);
  }, [replay?.sessionId, replay?.live, drawnAgents, followId, focus]);
  // Another thread: everyone's steps again.
  useEffect(() => () => { if (replay?.sessionId) setAgentFocus(replay.sessionId, null); }, [replay?.sessionId]);
  // Following one of the thread's agents shows it: the thread follows live again, and its steps show on their own.
  const nav0 = useNavActions();
  const follow = useCallback((id: string | null) => {
    if (id) refollow(id); else setFollowId(null);
    if (!replay) return;
    const a = id ? agents.find((x) => x.id === id) : undefined;
    if (id && a?.sessionId !== replay.sessionId) return;
    focusAgent(nav0, { ...replay, live: true }, islandSteps, id && a?.isSubagent ? id : null);
    if (id && !replay.live) nav0.setReplayLive(true);
  }, [replay, agents, islandSteps, setFollowId, refollow, nav0]);

  // ---- the Readmap (Readmap.tsx; M, in switch/Keys.tsx, shows or hides it) and A: follow the next agent (Shift A, the one before) ----
  const readmap = useReadmap();
  const tracks = useMemo(() => trackable(drawnAgents), [drawnAgents]);
  useShortcut("follow.next", (e) => {
    if (windowOpen() || !tracks.length) return false;
    const back = !!e?.shiftKey, i = tracks.findIndex((a) => a.id === followId), n = tracks.length;
    follow(tracks[i < 0 ? (back ? n - 1 : 0) : (i + (back ? n - 1 : 1)) % n].id);
  });
  /** The Readmap follows what agents read, with the map's own rules (agents.tsx): with a thread open, its agents; on
   *  the project overview, only the one followed. */
  const readmapReads = useCallback(() => {
    if (!mapPrefs.showReads) return null;
    const open = openRef.current, follow = followRef.current;
    return {
      resolveId,
      at: (id: string) => nodeIndexRef.current.get(id),
      whose: (a: { id: string }) => open || a.id === follow,
      past: replayRef.current.readsNow(),
    };
  }, [resolveId]);
  /** A click or drag on the Readmap: look there, by hand (no agent followed any more). */
  const lookAt = useCallback((x: number, y: number, ms: number) => {
    setFollowId(null);
    const c = camRef.current;
    c.touch();
    c.lookAt(x, y, undefined, ms);
  }, [setFollowId]);

  // The folders that show open at any zoom (useOpenFolders.ts).
  const pinned = useOpenFolders({ nodeIndex, selected, focusFile, footprint: replayLayer.footprint(), sessionId: replay?.sessionId ?? null,
    followId, agents, resolveId });

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

  // ---- the frame (useMapFrame.ts), and what makes one come (useRedrawTriggers.ts) ----
  // Import lines show only around the file under the pointer, or else the selected one, in every theme.
  const fp = replayLayer.footprint();
  const footprintKey = fp ? `${fp.length}|${fp[0] ?? ""}|${fp[fp.length - 1] ?? ""}` : "";
  const epoch = useRedrawTriggers({
    redraw, caches, files: map?.files, tokens, tween, graph, agents: liveAgentsById,
    picture: [graph, map?.files, drawnAgents, waiting, followId, hover, selected, tokens, theme, replay,
      replayLayer.active, replayLayer.tracing, showReads, stepWindow, footprintKey, size.w, size.h],
    step: [replay?.index, replay?.sessionId, replay?.mode],
  });
  const inputs = useLatest({ size, selected, hover, tokens, linkFocus: hover ?? selected, pinned, foldOn, open: !!replay, playing, theme });
  const readmapFrame = useRef<(() => boolean) | null>(null);   // the Readmap draws on the map's frames
  const { startFrame, drawNode, endFrame } = useMapFrame({
    fg, inputs, epoch, caches, tween, graphRef, nodeIndexRef, resolveId, replayRef, live, followRef, ringLayer, readmap: readmapFrame, redraw, files: map?.files ?? null,
  });
  // One frame: what it knows, each file in drawing order, then everything over the files. The context is saved before
  // the files and restored after each one and at the end, as the graph library painted them (each file starts from the
  // state the frame set up or the one before it left).
  frameRef.current = (ctx, k) => {
    startFrame(ctx, k);
    ctx.save();
    for (const n of graphRef.current.data.nodes) { drawNode(n, ctx, k); ctx.restore(); }
    ctx.restore();
    endFrame(ctx, k);
  };

  // A closed folder: the camera goes into it (which opens it, fold.ts). A file: selected, or let go if it already was.
  const nav = useNavActions();
  const { reload } = useLiveActions();
  const onNodeClick = useCallback((g: GNode) => {
    // An island (or a file on one): go to that project, the open thread still open (it shows there as a visitor).
    let isle: GNode | undefined = g;
    while (isle && !isle.dir?.island) isle = isle.up;
    // A place that isn't a project (the temporary files, Claude Code's own folder): a file there is selected like any
    // (the Files tab shows where it is, with Show in Finder), a folder zoomed into.
    if (isle && !isPlaceRoot(isle.dir!.island!)) {
      const root = isle.dir!.island!;
      const list = replay ? islandSteps ?? [] : [];
      let land: string | undefined;
      for (let i = list.length - 1; i >= 0 && !land; i--) { const f = list[i].filePath; if (f && islandPath(f).startsWith(root + "/")) land = list[i].id; }
      enterProject(root, nav, reload, replay?.sessionId, land).catch(() => {});
      return;
    }
    if (!g.dir) { setSelected(selectedRef.current === g.id ? null : g.id); return; }   // the selected file again: let go of it
    const x = g.x ?? 0, y = g.y ?? 0, r = g.r;
    camRef.current.frame({ x0: x - r, x1: x + r, y0: y - r, y1: y + r }, { pad: 24, maxZoom: 12 }, 750);
  }, [setSelected, nav, reload, replay?.sessionId, islandSteps]);
  const closeFile = useCallback(() => setSelected(null), [setSelected]);
  const hoverNow = useLatest(hover);
  useCanvasPointer({ wrapRef, fg, graphRef, hasCanvas: hasNodes, hover: hoverNow, onHover: setHover, onClick: useLatest(onNodeClick), onMiss: closeFile });
  const sel = selected ? nodeIndex.get(selected)?.file : undefined;

  return (
    <div className="map-wrap" ref={wrapRef}>
      {graph.nodes.length === 0 ? (
        // The map arrives once it's built (GET /api/map waits for it): a map with no files is an empty folder, not one still loading.
        map && map.files.length === 0 ? (
          <div className="map-empty">
            <h2>No files here yet</h2>
            <p>This folder has no files Rundown can map. They show up here as soon as an agent or you create some.</p>
          </div>
        ) : (
          <div className="map-empty">
            <h2>Mapping the codebase…</h2>
            <p>Files appear here as soon as the mapper has read them.</p>
          </div>
        )
      ) : (
        // The class is the one the graph library gave its canvas's box: the themes' overlays and the edge fade use it.
        <div className="force-graph-container"><canvas ref={canvasRef} /></div>
      )}
      {/* Agents' breathing rings (thinking, waiting on you), over the canvas: CSS animates them, the map rests. */}
      <div className="agent-rings" ref={ringLayer} aria-hidden="true" />


      <MapSidebar agents={agents} accent={tokens.accent} followId={followId}
        onFollow={follow} onFocusFile={focusOnFile} map={map}
        file={sel} picked={picked} onCloseFile={closeFile} />
      {/* A project with almost nothing to map (a folder opened from an island that holds little but the touched file). */}
      {map && map.files.length > 0 && map.files.length <= 3 && (
        <p className="map-sparse">This project has only {map.files.length === 1 ? "one file" : `${map.files.length} files`} on the map.</p>
      )}
      {map && <CapNote map={map} />}
      <LensSwitch />
      {hasNodes && readmap && (
        <Readmap graphRef={graphRef} anim={anim} drawnRef={agentsRef} cam={camRef} subject={() => replayRef.current.subject()} now={() => replayRef.current.nowAt()} reads={readmapReads} agents={tracks} followId={followId} accent={tokens.accent}
          big={!small} onTrack={follow} onLook={lookAt} onHide={() => setReadmap(false)} frame={readmapFrame} kick={redraw.kick} />
      )}

      <FileWindow />
      <Dock />

      <StepPanel />
    </div>
  );
}


/**
 * A big project past the file cap (mapper/ignore.ts): the map says it shows some of the files, not all, until you close
 * the note (remembered per project). The Files tab says how they're picked.
 */
function CapNote({ map }: { map: ProjectMap }) {
  const key = "rundown-cap-note:" + map.root;
  const [closed, setClosed] = useState(() => readStored(key) === "1");
  const total = map.totalFiles ?? 0, shown = map.files.length;
  if (closed || total <= shown) return null;
  const close = () => { setClosed(true); writeStored(key, "1"); }; // storage blocked: shown again next time
  return (
    <p className="map-cap">
      The map shows {shown.toLocaleString()} of this project's {total.toLocaleString()} files, the ones that matter most. Files says how they're picked.
      <button onClick={close} aria-label="Close this note">×</button>
    </p>
  );
}
