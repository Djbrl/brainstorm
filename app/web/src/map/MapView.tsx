// Owner: D. Force graph of files/modules, glow by recency, pulse on activeSessionId, side panel + AskBox.
import { clock } from "../lib/live";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D, { type ForceGraphMethods, type LinkObject, type NodeObject } from "react-force-graph-2d";
import type { AgentPresence, FileNode, ProjectMap, Step } from "@contract";
import { useLive } from "../lib/live";
import { useNav } from "../lib/nav";
import { AskBox } from "../ask/AskBox";
import { mockAgents, mockMap } from "./mock";
import { drawAgents, visibleAgents, type AgentAnim } from "./agents";
import { MapSidebar } from "./sidebar/MapSidebar";
import { ReplayBar } from "./replay/ReplayBar";
import { useReplayLayer, type ReplayLayerApi } from "./replay/layer";
import { makeFileResolver } from "../lib/paths";
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

function recencyColor(t: Tokens, iso: string | undefined, now: number): string {
  if (!iso) return mix(t.cool, t.cool, 0);
  const age = now - Date.parse(iso);
  if (!(age >= 0)) return mix(t.hot, t.hot, 0);
  if (age < 5 * MIN) return mix(t.hot, t.warm, (age / (5 * MIN)) ** 1.5);
  if (age < HOUR) return mix(t.warm, t.cool, (age - 5 * MIN) / (HOUR - 5 * MIN));
  return mix(t.cool, t.cool, 0);
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
const projectName = (root: string) => (root ? baseName(root.replace(/\/\.claude\/worktrees\/.*$/, "").replace(/\/+$/, "")) : "Map");
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
  const lastRef = useRef<{ key: string; graph: { nodes: GNode[]; links: GLink[]; anchors: Map<string, { x: number; y: number }> } } | null>(null);
  return useMemo(() => {
    if (!map) return { nodes: [] as GNode[], links: [] as GLink[], anchors: new Map<string, { x: number; y: number }>() };
    // Same files, modules and edges: update node data in place so the simulation is not disturbed.
    const key = map.files.map((f) => f.path + "|" + f.module).join(",") + "#" + map.edges.length;
    if (lastRef.current && lastRef.current.key === key) {
      for (const f of map.files) { const n = nodesRef.current.get(f.path); if (n) { n.file = f; n.r = radius(f.lines); } }
      return lastRef.current.graph;
    }
    // Module anchors on a sunflower spiral, biggest modules in the middle.
    const counts = new Map<string, number>();
    for (const f of map.files) counts.set(f.module, (counts.get(f.module) ?? 0) + 1);
    const mods = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m);
    const anchors = new Map<string, { x: number; y: number }>();
    const spread = 70 + Math.sqrt(map.files.length) * 4;
    mods.forEach((m, i) => {
      const r = i === 0 ? 0 : spread * Math.sqrt(i + 0.5);
      const a = i * 2.39996;
      anchors.set(m, { x: Math.cos(a) * r, y: Math.sin(a) * r });
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
    lastRef.current = { key, graph };
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

// ---------- view ----------
export function MapView() {
  const { state } = useLive();
  const { focusFile, setFocusFile, hiddenAgents, replay } = useNav();
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
  const followRef = useRef(followId); followRef.current = followId;
  const hoverRef = useRef(hover); hoverRef.current = hover;
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
  const drawAgentLayer = useCallback((ctx: CanvasRenderingContext2D, scale: number) => {
    replayRef.current.draw(ctx, scale);
    drawAgents({
      ctx, scale, agents: agentsRef.current, anim: anim.current, accent: tokens.accent, font: tokens.body,
      hoverFile: hoverRef.current, followId: followRef.current, resolveId,
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

  const activePaths = useMemo(() => new Set((map?.files ?? []).filter((f) => f.activeSessionId).map((f) => f.path)), [map?.files]);

  const drawNode = useCallback((node: NodeObject, ctx: CanvasRenderingContext2D, scale: number) => {
    const n = node as GNode;
    const x = n.x ?? 0, y = n.y ?? 0, r = n.r;
    const now = clock();
    const active = !!n.file.activeSessionId;
    const isSel = n.id === selected, isHover = n.id === hover;
    const alpha = replayRef.current.nodeAlpha(n.id);
    ctx.save();
    ctx.globalAlpha = alpha;

    if (active) {
      const period = 1600;
      for (const off of [0, period / 2]) {
        const p = ((now + off) % period) / period;
        ctx.beginPath();
        ctx.arc(x, y, r + (4 + p * 34) / scale, 0, Math.PI * 2); // screen-constant so it reads at any zoom
        ctx.strokeStyle = tokens.accent;
        ctx.globalAlpha = (1 - p) * 0.85 * alpha;
        ctx.lineWidth = 2.6 / scale;
        ctx.stroke();
      }
      ctx.globalAlpha = 0.18 * alpha;
      ctx.beginPath(); ctx.arc(x, y, r + 9 / scale, 0, Math.PI * 2); ctx.fillStyle = tokens.accent; ctx.fill();
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

    const showLabel = isSel || isHover || active || r * scale > 9 || scale > 3.2;
    if (showLabel) {
      const fs = Math.max(11, Math.min(14, 11 + r * scale * 0.08)) / scale;
      ctx.font = `${isSel || active ? 600 : 500} ${fs}px ${tokens.body}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const label = baseName(n.id);
      const ty = y + r + 3 / scale;
      ctx.lineWidth = 3 / scale;
      ctx.strokeStyle = "rgba(251,251,253,0.9)";
      ctx.strokeText(label, x, ty);
      ctx.fillStyle = isSel || active || isHover ? tokens.ink : "rgba(29,29,31,0.62)";
      ctx.fillText(label, x, ty);
    }
    ctx.restore();
  }, [tokens, selected, hover]);

  const drawModules = useCallback((ctx: CanvasRenderingContext2D, scale: number) => {
    const acc = new Map<string, { x: number; y: number; n: number; minY: number }>();
    for (const n of graph.nodes) {
      if (n.x === undefined || n.y === undefined) continue;
      const a = acc.get(n.file.module) ?? { x: 0, y: 0, n: 0, minY: Infinity };
      a.x += n.x; a.y += n.y; a.n++; a.minY = Math.min(a.minY, n.y - n.r);
      acc.set(n.file.module, a);
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const [m, a] of acc) {
      const px = Math.max(20, Math.min(40, 16 + Math.sqrt(a.n) * 3.5));
      ctx.font = `700 ${px / scale}px ${tokens.display}`;
      ctx.fillStyle = "rgba(29,29,31,0.2)";
      ctx.textBaseline = "bottom";
      ctx.fillText(modName(m), a.x / a.n, a.minY - 10 / scale);
    }
  }, [graph.nodes, tokens]);

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
          linkColor={(l) => (activePaths.has(((l as GLink).source as GNode).id) || activePaths.has(((l as GLink).target as GNode).id) ? "rgba(91,91,214,0.35)" : "rgba(29,29,31,0.08)")}
          linkWidth={0.6}
          linkDirectionalParticles={(l) => (activePaths.has(((l as GLink).source as GNode).id) || activePaths.has(((l as GLink).target as GNode).id) ? 2 : 0)}
          linkDirectionalParticleWidth={2.2}
          linkDirectionalParticleSpeed={0.008}
          linkDirectionalParticleColor={() => tokens.accent}
          autoPauseRedraw={false}
          cooldownTicks={400}
          d3VelocityDecay={0.35}
          onEngineStop={() => { if (!settledFit.current && !selected) { settledFit.current = true; fg.current?.zoomToFit(900, 130); } }}
          onNodeHover={(n) => setHover(n ? (n as GNode).id : null)}
          onNodeClick={(n) => setSelected((n as GNode).id)}
          onBackgroundClick={() => setSelected(null)}
        />
      )}

      <div className="map-head">
        <h1>{projectName(root)}</h1>
        <p>{graph.nodes.length} files · {graph.anchors.size} modules{activePaths.size ? ` · ${activePaths.size} being edited now` : ""}</p>
      </div>

      <MapSidebar agents={agents} accent={tokens.accent} followId={followId}
        onFollow={(id) => setFollowId(id)} onFocusFile={focusOnFile} map={map} />
      {replay && <ReplayBar />}

      <div className="map-legend" aria-label="Legend">
        <span><i style={{ background: "var(--hot)" }} />Just now</span>
        <span><i style={{ background: "var(--warm)" }} />This hour</span>
        <span><i style={{ background: "var(--cool)" }} />Earlier</span>
        <span><i className="ring" />Agent editing</span>
      </div>

      <FilePanel file={sel} root={root} steps={state.steps} onClose={() => setSelected(null)} />
    </div>
  );
}

function FilePanel({ file, root, steps, onClose }: { file?: FileNode; root: string; steps: Record<string, Step[]>; onClose: () => void }) {
  const now = useNow();
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
