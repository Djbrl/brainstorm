// Owner: D. Force graph of files/modules, glow by recency, a ripple per agent edit + outline while active, side panel + AskBox.
import { LensSwitch } from "./LensSwitch";
import { MapStats } from "./MapStats";
import "../tasks/track.css";
import { clock, isReplay } from "../lib/live";
import { lastSeen, sinceMs } from "../lib/visit";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const RIPPLE_MS = 700; // one ripple per edit
import ForceGraph2D, { type ForceGraphMethods, type LinkObject, type NodeObject } from "react-force-graph-2d";
import type { AgentPresence, Edge, FileNode, ProjectMap, Step } from "@contract";
import { useLive } from "../lib/live";
import { mapPrefs, useNav } from "../lib/nav";
import { AskBox } from "../ask/AskBox";
import { mockAgents, mockMap } from "./mock";
import { drawAgents, visibleAgents, type AgentAnim } from "./agents";
import { MapSidebar } from "./sidebar/MapSidebar";
import { Dock } from "./replay/ReplayBar";
import { TalkCard } from "./replay/TalkCard";
import { StepPanel } from "./StepPanel";
import { useReplayLayer, type ReplayLayerApi } from "./replay/layer";
import { makeFileResolver } from "../lib/paths";
import { drawModuleLabels, LabelSpace } from "./labels";
import "./map.css";

type GNode = NodeObject & { id: string; file: FileNode; r: number; ax: number; ay: number };
type GLink = LinkObject & { source: string | GNode; target: string | GNode };

const MIN = 60_000;
const HOUR = 60 * MIN;

// ---------- helpers ----------
function hex(c: string): [number, number, number] {
  const h = c.trim().replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((x) => x + x).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const mix = (a: [number, number, number], b: [number, number, number], t: number) => {
  const k = Math.max(0, Math.min(1, t));
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(",")})`;
};
function readTokens() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fb: string) => cs.getPropertyValue(name).trim() || fb;
  return {
    hot: hex(v("--hot", "#ff6a3d")), warm: hex(v("--warm", "#ffb547")), cool: hex(v("--cool", "#c7cbd6")),
    accent: v("--accent", "#5b5bd6"), ink: v("--ink", "#1d1d1f"),
    display: v("--font-display", "-apple-system, sans-serif"), body: v("--font-body", "-apple-system, sans-serif"),
  };
}
type Tokens = ReturnType<typeof readTokens>;

/**
 * A file's color: hot for a few minutes after an edit, warm if it changed since you last looked (see lib/visit.ts),
 * quiet otherwise. A recording (the hosted demo) has no "last visit": there, warm fades out over an hour as before.
 */
function recencyColor(t: Tokens, iso: string | undefined, now: number): string {
  if (!iso) return mix(t.cool, t.cool, 0);
  const at = Date.parse(iso), age = now - at;
  if (!(age >= 0)) return mix(t.hot, t.hot, 0);
  if (age < 5 * MIN) return mix(t.hot, t.warm, (age / (5 * MIN)) ** 1.5);
  if (isReplay()) return age < HOUR ? mix(t.warm, t.cool, (age - 5 * MIN) / (HOUR - 5 * MIN)) : mix(t.cool, t.cool, 0);
  return at > sinceMs ? mix(t.warm, t.warm, 0) : mix(t.cool, t.cool, 0);
}

export function relTime(iso: string | undefined, now = clock()): string {
  if (!iso) return "not changed recently";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 45) return "changed just now";
  if (s < 3600) return `changed ${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `changed ${Math.round(s / 3600)} h ago`;
  return `changed ${Math.round(s / 86400)} days ago`;
}
const relPath = (p: string, root: string) => (p.startsWith(root) ? p.slice(root.length).replace(/^\/+/, "") : p);
const modName = (m: string) => (!m || m === "." ? "root" : m);
const baseName = (p: string) => p.split("/").pop() || p;
const radius = (lines: number) => Math.min(22, 3.5 + Math.sqrt(Math.max(0, lines)) * 0.55);

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

function useNow(ms = 20000) {
  const [now, setNow] = useState(clock());
  useEffect(() => { const t = setInterval(() => setNow(clock()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

// ---------- graph data (node objects are reused so positions survive live updates) ----------
function useGraph(map: ProjectMap | null) {
  const nodesRef = useRef(new Map<string, GNode>());
  const lastRef = useRef<{ key: string; edges: ProjectMap["edges"]; graph: { nodes: GNode[]; links: GLink[]; anchors: Map<string, { x: number; y: number }> } } | null>(null);
  return useMemo(() => {
    if (!map) return { nodes: [] as GNode[], links: [] as GLink[], anchors: new Map<string, { x: number; y: number }>() };
    // Same files, modules and edges: update node data in place so the simulation is not disturbed.
    // (The store only replaces the edges array when an import actually changed.)
    const key = map.files.map((f) => f.path + "|" + f.module).join(",");
    if (lastRef.current && lastRef.current.key === key && lastRef.current.edges === map.edges) {
      for (const f of map.files) { const n = nodesRef.current.get(f.path); if (n) { n.file = f; n.r = radius(f.lines); } }
      return lastRef.current.graph;
    }
    // Module anchors: top-level folders on a sunflower spiral, biggest in the middle; the subfolders of one folder
    // gather around its spot (a small spiral of their own), so "app/server" sits next to "app/web".
    const counts = new Map<string, number>();
    for (const f of map.files) counts.set(f.module, (counts.get(f.module) ?? 0) + 1);
    const top = new Map<string, string[]>();
    for (const m of counts.keys()) { const p = m === "." ? "." : m.split("/")[0]; top.set(p, [...(top.get(p) ?? []), m]); }
    const size = (ms: string[]) => ms.reduce((s, m) => s + (counts.get(m) ?? 0), 0);
    const groups = [...top.values()].map((ms) => ms.sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))).sort((a, b) => size(b) - size(a));
    const anchors = new Map<string, { x: number; y: number }>();
    const spread = 70 + Math.sqrt(map.files.length) * 4, inner = 46;
    const extent = (ms: string[]) => (ms.length > 1 ? inner * Math.sqrt(ms.length) : 0);
    groups.forEach((ms, i) => {
      const r = i === 0 ? 0 : extent(groups[0]) + spread * Math.sqrt(i + 0.5), a = i * 2.39996;
      const gx = Math.cos(a) * r, gy = Math.sin(a) * r;
      ms.forEach((m, j) => {
        const rr = j === 0 ? 0 : inner * Math.sqrt(j + 0.5), aa = j * 2.39996 + a;
        anchors.set(m, { x: gx + Math.cos(aa) * rr, y: gy + Math.sin(aa) * rr });
      });
    });
    const prev = nodesRef.current;
    const next = new Map<string, GNode>();
    const nodes = map.files.map((f) => {
      const an = anchors.get(f.module) ?? { x: 0, y: 0 };
      const n = prev.get(f.path) ?? ({ id: f.path, x: an.x + (Math.random() - 0.5) * 40, y: an.y + (Math.random() - 0.5) * 40 } as GNode);
      n.file = f; n.r = radius(f.lines); n.ax = an.x; n.ay = an.y;
      next.set(f.path, n);
      return n;
    });
    nodesRef.current = next;
    const links: GLink[] = map.edges.filter((e) => next.has(e.from) && next.has(e.to) && e.from !== e.to).map((e) => ({ source: e.from, target: e.to }));
    const graph = { nodes, links, anchors };
    lastRef.current = { key, edges: map.edges, graph };
    return graph;
  }, [map?.files, map?.edges]);
}

/** Weak pull of each file toward its module's anchor. */
function moduleForce(strength: number) {
  let nodes: GNode[] = [];
  const f = (alpha: number) => {
    for (const n of nodes) {
      n.vx = (n.vx ?? 0) + (n.ax - (n.x ?? 0)) * strength * alpha;
      n.vy = (n.vy ?? 0) + (n.ay - (n.y ?? 0)) * strength * alpha;
    }
  };
  f.initialize = (ns: GNode[]) => { nodes = ns; };
  return f;
}

// ---------- import links ----------
const IMPORTS_COLOR = "rgba(91,91,214,0.7)";   // this file → what it imports
const USED_BY_COLOR = "rgba(15,157,138,0.7)";  // files that import this one → this file
const endId = (e: unknown) => (typeof e === "object" && e ? (e as GNode).id : (e as string));
function linkRole(l: GLink, focus: string | null): "imports" | "usedBy" | null {
  if (!focus) return null;
  if (endId(l.source) === focus) return "imports";
  if (endId(l.target) === focus) return "usedBy";
  return null;
}

// ---------- view ----------
export function MapView() {
  const { state } = useLive();
  const { focusFile, setFocusFile, hiddenAgents, replay, step, showReads, setShowReads } = useNav();
  const mock = useMemo(() => new URLSearchParams(location.search).has("mockmap"), []);
  const map = useMemo(() => (mock ? mockMap() : state.map), [mock, state.map]);
  const graph = useGraph(map);
  const [wrapRef, size] = useSize<HTMLDivElement>();
  const fg = useRef<ForceGraphMethods<GNode, GLink> | undefined>(undefined);
  const tokens = useMemo(readTokens, []);
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const fitted = useRef(false);
  const settledFit = useRef(false);
  const root = map?.root ?? "";

  // ---- live agents ----
  const [mockTick, setMockTick] = useState(0);
  useEffect(() => { if (!mock) return; const t = setInterval(() => setMockTick((x) => x + 1), 2600); return () => clearInterval(t); }, [mock]);
  const agents: AgentPresence[] = useMemo(
    () => visibleAgents(mock && map ? mockAgents(map, mockTick) : Object.values(state.agents ?? {})),
    [mock, map, mockTick, state.agents],
  );
  // Hidden agents (sidebar toggles) and all live agents while a thread replay is on are not drawn.
  const drawnAgents = useMemo(() => (replay ? [] : agents.filter((a) => !hiddenAgents.has(a.id))), [agents, hiddenAgents, replay]);
  const agentsRef = useRef(drawnAgents); agentsRef.current = drawnAgents;
  const anim = useRef(new Map<string, AgentAnim>());
  const [followId, setFollowId] = useState<string | null>(null);
  // A thread replay takes over the camera: stop following a live agent when one starts.
  useEffect(() => { if (replay) setFollowId(null); }, [replay?.sessionId]);
  const followRef = useRef(followId); followRef.current = followId;
  const hoverRef = useRef(hover); hoverRef.current = hover;
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const moduleSpace = useRef(new LabelSpace());   // folder names taken this frame
  const fileSpace = useRef(new LabelSpace());     // file names taken this frame
  const nodeIndex = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph.nodes]);
  const nodeIndexRef = useRef(nodeIndex); nodeIndexRef.current = nodeIndex;
  /** Map an agent's file (or a searched directory) to a node id on the map. */
  const fileResolver = useMemo(() => makeFileResolver(map), [map]);
  const fileResolverRef = useRef(fileResolver); fileResolverRef.current = fileResolver;
  const resolveId = useCallback((file: string): string | undefined => {
    const idx = nodeIndexRef.current;
    if (idx.has(file)) return file;
    const same = fileResolverRef.current(file); // same file in another worktree of this repo
    if (same && idx.has(same)) return same;
    const dir = file.replace(/\/+$/, "") + "/";
    for (const id of idx.keys()) if (id.startsWith(dir)) return id;
    return undefined;
  }, []);
  const replayLayer = useReplayLayer({ fg: fg as never, wrapRef, nodeIndexRef, accent: tokens.accent, font: tokens.body });
  const replayRef = useRef<ReplayLayerApi>(replayLayer); replayRef.current = replayLayer;
  const openRef = useRef(!!replay); openRef.current = !!replay;
  const drawAgentLayer = useCallback((ctx: CanvasRenderingContext2D, scale: number) => {
    replayRef.current.draw(ctx, scale);
    drawAgents({
      ctx, scale, agents: agentsRef.current, anim: anim.current, accent: tokens.accent, font: tokens.body,
      hoverFile: hoverRef.current, followId: followRef.current, resolveId, showReads: mapPrefs.showReads, quiet: !openRef.current,
      resolve: (id) => { const n = nodeIndexRef.current.get(id); return n && n.x !== undefined && n.y !== undefined ? { x: n.x, y: n.y, r: n.r } : undefined; },
    });
  }, [tokens, resolveId]);

  // Follow an agent: keep the camera on its marker until the user drags, zooms or clicks the map.
  useEffect(() => {
    if (!followId) return;
    fg.current?.zoom(Math.max(2.2, fg.current?.zoom() ?? 0), 700);
    // Ease the camera toward the marker every frame (no stacked tweens).
    let raf = 0;
    const tick = () => {
      const st = anim.current.get(followId);
      const g = fg.current;
      if (st && g) {
        const c = g.centerAt() as unknown as { x: number; y: number };
        const dx = st.x - c.x, dy = st.y - c.y;
        if (Math.hypot(dx, dy) * g.zoom() > 1.5) g.centerAt(c.x + dx * 0.09, c.y + dy * 0.09);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [followId]);
  const focusOnFile = useCallback((file: string) => {
    setFollowId(null);
    const id = resolveId(file);
    const n = id ? nodeIndexRef.current.get(id) : undefined;
    if (!n) return;
    setSelected(n.id);
    fg.current?.centerAt((n.x ?? 0) + 220 / 3, n.y ?? 0, 800);
    fg.current?.zoom(3, 800);
  }, [resolveId]);

  // Forces
  useEffect(() => {
    const g = fg.current;
    if (!g) return;
    g.d3Force("module", moduleForce(0.1) as never);
    (g.d3Force("charge") as any)?.strength?.((n: GNode) => -30 - n.r * 6);
    (g.d3Force("link") as any)?.distance?.((l: GLink) => {
      const s = l.source as GNode, t = l.target as GNode;
      return s.file?.module === t.file?.module ? 34 : 110;
    })?.strength?.((l: GLink) => ((l.source as GNode).file?.module === (l.target as GNode).file?.module ? 0.25 : 0.03));
    (g.d3Force("center") as any)?.strength?.(0.02);
    g.d3ReheatSimulation();
  }, [graph]);

  // Zoom to fit once, after the first layout settles a bit.
  useEffect(() => {
    if (fitted.current || graph.nodes.length === 0) return;
    const t = setTimeout(() => { fg.current?.zoomToFit(900, 130); fitted.current = true; }, 1600);
    return () => clearTimeout(t);
  }, [graph.nodes.length]);

  // Focus from Follow
  useEffect(() => {
    if (!focusFile) return;
    const n = graph.nodes.find((x) => x.id === focusFile);
    if (!n) return;
    setSelected(n.id);
    const go = () => { fg.current?.centerAt((n.x ?? 0) + 220 / 3, n.y ?? 0, 900); fg.current?.zoom(3, 900); fitted.current = true; setFocusFile(null); };
    if (n.x === undefined) setTimeout(go, 800); else go();
  }, [focusFile, graph.nodes, setFocusFile]);

  // Import links show only around the selected file.
  const linkFocus = selected; // on click, not hover: moving the mouse across the map shouldn't flash lines everywhere
  const activePaths = useMemo(() => new Set((map?.files ?? []).filter((f) => f.activeSessionId).map((f) => f.path)), [map?.files]);

  // One-shot ripples: start one when a file receives a new agent edit (not on first load).
  const ripples = useRef(new Map<string, number>());
  const seenEdits = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    const files = map?.files ?? [];
    const first = seenEdits.current === null;
    const seen = seenEdits.current ?? new Map<string, string>();
    for (const f of files) {
      const sig = `${f.lastChangedAt ?? ""}|${f.activeSessionId ?? ""}`;
      const prev = seen.get(f.path);
      if (!first && prev !== undefined && prev !== sig && f.activeSessionId && f.lastChangedAt !== prev.split("|")[0]) ripples.current.set(f.path, performance.now());
      seen.set(f.path, sig);
    }
    seenEdits.current = seen;
  }, [map?.files]);

  const drawNode = useCallback((node: NodeObject, ctx: CanvasRenderingContext2D, scale: number) => {
    const n = node as GNode;
    const x = n.x ?? 0, y = n.y ?? 0, r = n.r;
    const now = clock();
    const active = !!n.file.activeSessionId;
    const isSel = n.id === selected, isHover = n.id === hover;
    const alpha = replayRef.current.nodeAlpha(n.id);
    ctx.save();
    ctx.globalAlpha = alpha;

    // An edit lands: one ripple, once. While the file stays active: a steady outline, no motion.
    const rippleStart = ripples.current.get(n.id);
    if (rippleStart !== undefined) {
      const t = (performance.now() - rippleStart) / RIPPLE_MS;
      if (t >= 1) ripples.current.delete(n.id);
      else {
        const e = 1 - Math.pow(1 - t, 3); // ease-out
        ctx.beginPath();
        ctx.arc(x, y, r + (3 + e * 26) / scale, 0, Math.PI * 2); // screen-constant size, readable at any zoom
        ctx.strokeStyle = tokens.accent;
        ctx.globalAlpha = (1 - t) * 0.75 * alpha;
        ctx.lineWidth = 2 / scale;
        ctx.stroke();
        ctx.globalAlpha = alpha;
      }
    }
    if (active) {
      ctx.beginPath();
      ctx.arc(x, y, r + 3.5 / scale, 0, Math.PI * 2);
      ctx.strokeStyle = tokens.accent;
      ctx.globalAlpha = 0.9 * alpha;
      ctx.lineWidth = 1.6 / scale;
      ctx.stroke();
      ctx.globalAlpha = alpha;
    }

    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = recencyColor(tokens, n.file.lastChangedAt, now);
    ctx.fill();
    if (isSel || isHover || active) {
      ctx.lineWidth = (isSel ? 2.4 : 1.4) / scale;
      ctx.strokeStyle = active ? tokens.accent : tokens.ink;
      ctx.stroke();
    }

    const forced = isSel || isHover || active;
    // With a thread open, only the files it touched are named: the rest of the project stays in the background.
    let showLabel = forced || (alpha >= 1 && (r * scale > 9 || scale > 3.2));
    const fs = Math.max(11, Math.min(14, 11 + r * scale * 0.08)) / scale;
    const label = baseName(n.id);
    const ty = y + r + 3 / scale;
    if (showLabel) {
      // Skip a file name that would print over one already drawn this frame (the ones you point at always win).
      ctx.font = `${isSel || active ? 600 : 500} ${fs}px ${tokens.body}`;
      const w = ctx.measureText(label).width, pad = 3 / scale;
      showLabel = fileSpace.current.claim({ x0: x - w / 2 - pad, x1: x + w / 2 + pad, y0: ty - pad, y1: ty + fs + pad }, forced);
    }
    if (showLabel) {
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.lineWidth = 3 / scale;
      ctx.strokeStyle = "rgba(251,251,253,0.9)";
      ctx.strokeText(label, x, ty);
      ctx.fillStyle = isSel || active || isHover ? tokens.ink : "rgba(29,29,31,0.62)";
      ctx.fillText(label, x, ty);
    }
    ctx.restore();
  }, [tokens, selected, hover]);

  const drawModules = useCallback((ctx: CanvasRenderingContext2D, scale: number) => {
    moduleSpace.current.reset(); fileSpace.current.reset();
    const idx = nodeIndexRef.current;
    const focus = new Set<string>();
    for (const id of [hoverRef.current, selectedRef.current]) { const n = id ? idx.get(id) : undefined; if (n) focus.add(n.file.module); }
    const busy = new Set<string>();
    for (const a of agentsRef.current) {
      if (!a.active || !a.file) continue;
      const id = resolveId(a.file), n = id ? idx.get(id) : undefined;
      if (n) busy.add(n.file.module);
    }
    drawModuleLabels(ctx, scale, graph.nodes.map((n) => ({ x: n.x, y: n.y, r: n.r, module: n.file.module, lastChangedAt: n.file.lastChangedAt, active: !!n.file.activeSessionId })),
      { font: tokens.display, now: clock(), focus, busy, space: moduleSpace.current });
  }, [graph.nodes, tokens, resolveId]);

  const sel = selected ? graph.nodes.find((n) => n.id === selected)?.file : undefined;

  return (
    <div className="map-wrap" ref={wrapRef}
      onPointerDown={(e) => { if ((e.target as HTMLElement).tagName === "CANVAS") setFollowId(null); }}
      onWheel={(e) => { if ((e.target as HTMLElement).tagName === "CANVAS") setFollowId(null); }}>
      {graph.nodes.length === 0 ? (
        <div className="map-empty">
          <h2>Mapping the codebase…</h2>
          <p>Files appear here as soon as the mapper has read them.</p>
        </div>
      ) : (
        <ForceGraph2D<GNode, GLink>
          ref={fg as never}
          width={size.w}
          height={size.h}
          graphData={graph}
          backgroundColor="rgba(0,0,0,0)"
          nodeId="id"
          nodeRelSize={1}
          nodeVal={(n) => (n as GNode).r * (n as GNode).r}
          nodeLabel={() => ""}
          nodeCanvasObject={drawNode}
          nodePointerAreaPaint={(n, color, ctx) => { const g = n as GNode; ctx.fillStyle = color; ctx.beginPath(); ctx.arc(g.x ?? 0, g.y ?? 0, g.r + 3, 0, Math.PI * 2); ctx.fill(); }}
          onRenderFramePre={drawModules}
          onRenderFramePost={drawAgentLayer}
          linkColor={(l) => linkRole(l as GLink, linkFocus) === "imports" ? IMPORTS_COLOR : linkRole(l as GLink, linkFocus) === "usedBy" ? USED_BY_COLOR : linkFocus ? "rgba(29,29,31,0.04)" : "rgba(29,29,31,0.08)"}
          linkWidth={(l) => (linkRole(l as GLink, linkFocus) ? 1.6 : 0.6)}
          linkDirectionalArrowLength={(l) => (linkRole(l as GLink, linkFocus) ? 3.5 : 0)}
          linkDirectionalArrowRelPos={0.92}
          autoPauseRedraw={false}
          cooldownTicks={400}
          d3VelocityDecay={0.35}
          onEngineStop={() => { if (!settledFit.current && !selected && !openRef.current) { settledFit.current = true; fg.current?.zoomToFit(900, 130); } }}
          onNodeHover={(n) => setHover(n ? (n as GNode).id : null)}
          onNodeClick={(n) => setSelected((n as GNode).id)}
          onBackgroundClick={() => setSelected(null)}
        />
      )}


      <MapSidebar agents={agents} accent={tokens.accent} followId={followId}
        onFollow={(id) => setFollowId(id)} onFocusFile={focusOnFile} map={map} />
      <MapStats />
      <TalkCard />
      <LensSwitch />

      <Dock>
        <div className="dock-legend" aria-label="Legend">
          <span><i style={{ background: "var(--hot)" }} />Just now</span>
          <span><i style={{ background: "var(--warm)" }} />{isReplay() ? "This hour" : lastSeen ? "Since you last looked" : "In the last day"}</span>
          <span><i style={{ background: "var(--cool)" }} />Earlier</span>
          {sel && <span title="What the selected file imports"><i className="line" style={{ background: IMPORTS_COLOR }} />Imports</span>}
        </div>
        <div className="map-seg" role="radiogroup" aria-label="Agent activity shown">
          <button role="radio" aria-checked={!showReads} onClick={() => setShowReads(false)}>Writes</button>
          <button role="radio" aria-checked={showReads} onClick={() => setShowReads(true)}>Reads too</button>
        </div>
      </Dock>

      <StepPanel />
      <FilePanel file={step ? undefined : sel} root={root} steps={state.steps} edges={map?.edges ?? []} onFocus={focusOnFile} onClose={() => setSelected(null)} />
    </div>
  );
}

function FilePanel({ file, root, steps, edges, onFocus, onClose }: {
  file?: FileNode; root: string; steps: Record<string, Step[]>; edges: Edge[]; onFocus: (path: string) => void; onClose: () => void;
}) {
  const now = useNow();
  // Unique: a file can import from the same module in several statements.
  const imports = useMemo(() => (file ? [...new Set(edges.filter((e) => e.from === file.path).map((e) => e.to))] : []), [file?.path, edges]);
  const usedBy = useMemo(() => (file ? [...new Set(edges.filter((e) => e.to === file.path).map((e) => e.from))] : []), [file?.path, edges]);
  const touching = useMemo(() => {
    if (!file) return [];
    const out: Step[] = [];
    for (const list of Object.values(steps)) for (const s of list) if (s.filePath === file.path) out.push(s);
    return out.sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 6);
  }, [file?.path, steps]);

  return (
    <aside className={`map-panel ${file ? "open" : ""}`} aria-hidden={!file}>
      {file && (
        <div className="map-panel-inner">
          <button className="map-close" onClick={onClose} aria-label="Close">×</button>
          <h2>{baseName(file.path)}</h2>
          <p className="map-path">{relPath(file.path, root)}</p>
          <p className="map-meta">
            {modName(file.module)} · {file.lines.toLocaleString()} lines · {relTime(file.lastChangedAt, now)}
          </p>
          {file.activeSessionId && <p className="map-live"><i />An agent is editing this file right now</p>}

          <section>
            <h3>What it does</h3>
            {file.summary ? <p className="map-summary">{file.summary}</p> : <p className="map-quiet">Summarizing…</p>}
          </section>

          {(imports.length > 0 || usedBy.length > 0) && (
            <section className="map-deps">
              {imports.length > 0 && (<>
                <h3><i style={{ background: IMPORTS_COLOR }} />Imports</h3>
                <ul>{imports.map((p) => <li key={p}><button onClick={() => onFocus(p)} title={relPath(p, root)}>{baseName(p)}</button></li>)}</ul>
              </>)}
              {usedBy.length > 0 && (<>
                <h3><i style={{ background: USED_BY_COLOR }} />Used by</h3>
                <ul>{usedBy.map((p) => <li key={p}><button onClick={() => onFocus(p)} title={relPath(p, root)}>{baseName(p)}</button></li>)}</ul>
              </>)}
            </section>
          )}

          {touching.length > 0 && (
            <section>
              <h3>Recent agent steps</h3>
              <ul className="map-steps">
                {touching.map((s) => (
                  <li key={s.id}>
                    <span>{s.label ?? (s.tool ? `${s.tool} ${baseName(file.path)}` : s.kind)}</span>
                    <time>{relTime(s.ts, now).replace("changed ", "")}</time>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h3>Ask about this file</h3>
            <AskBox key={file.path} context={{ filePath: file.path }} placeholder={`What does ${baseName(file.path)} do?`} />
          </section>
        </div>
      )}
    </aside>
  );
}
