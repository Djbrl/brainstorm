// Owner: cowork. The places map: one area per kind of work, sites as bubbles, pages around them.
// Same language as the code map: size = how much the agents worked there, orange = something changed there.
import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D, { type ForceGraphMethods, type NodeObject } from "react-force-graph-2d";
import type { CoworkArea, CoworkPage, CoworkSite, CoworkSummary } from "@contract";
import { AREA_NAME } from "./data";

type GNode = NodeObject & {
  id: string; kind: "site" | "page"; area: CoworkArea; label: string; r: number;
  events: number; changes: number; failed: number; site?: string;
};
type GLink = { source: string | GNode; target: string | GNode };

export const AREA_COLOR: Record<CoworkArea, string> = { web: "#5b5bd6", local: "#7d8597", services: "#1f9d55", apps: "#c2410c" };
const HOT = "#ff6a3d";
const RISK = "#d93025";
const ANCHOR: Record<CoworkArea, [number, number]> = { web: [-330, 60], local: [330, 60], services: [0, -230], apps: [0, 330] };

/** Pulls every node toward its area's anchor so the four kinds of work sit in their own regions. */
function areaForce(strength: number) {
  let nodes: GNode[] = [];
  const f = (alpha: number) => {
    for (const n of nodes) {
      const [ax, ay] = ANCHOR[n.area];
      const k = (n.kind === "site" ? strength : strength * 0.3) * alpha;
      n.vx = (n.vx ?? 0) + (ax - (n.x ?? 0)) * k;
      n.vy = (n.vy ?? 0) + (ay - (n.y ?? 0)) * k;
    }
  };
  f.initialize = (ns: GNode[]) => { nodes = ns; };
  return f;
}

/** Keeps bubbles (and the label under each site) from overlapping. Plain O(n²): a few hundred nodes at most. */
function collideForce() {
  let nodes: GNode[] = [];
  const pad = (n: GNode) => (n.kind === "site" ? n.r + 26 : n.r + 3);
  const f = () => {
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        const dx = (b.x ?? 0) - (a.x ?? 0), dy = (b.y ?? 0) - (a.y ?? 0);
        const min = pad(a) + pad(b);
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2) || 0.01;
        const push = ((min - d) / d) * 0.5;
        const wa = b.kind === "site" && a.kind === "page" ? 0.8 : 0.5, wb = 1 - wa;
        a.x! -= dx * push * wa; a.y! -= dy * push * wa;
        b.x! += dx * push * wb; b.y! += dy * push * wb;
      }
    }
  };
  f.initialize = (ns: GNode[]) => { nodes = ns; };
  return f;
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

const short = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** Node objects are reused across polls so positions survive updates. */
function useGraph(data: CoworkSummary, areas: ReadonlySet<CoworkArea>) {
  const cache = useRef(new Map<string, GNode>());
  return useMemo(() => {
    const nodes: GNode[] = [];
    const links: GLink[] = [];
    const node = (id: string, init: Omit<GNode, "id"> & { area: CoworkArea }) => {
      // New nodes start near their area's anchor, so the regions form right away.
      const [ax, ay] = ANCHOR[init.area];
      const n = cache.current.get(id) ?? ({ id, x: ax + (Math.random() - 0.5) * 120, y: ay + (Math.random() - 0.5) * 120 } as GNode);
      Object.assign(n, init);
      cache.current.set(id, n);
      nodes.push(n);
      return n;
    };
    const pagesBySite = new Map<string, CoworkPage[]>();
    for (const p of data.pages) (pagesBySite.get(p.site) ?? pagesBySite.set(p.site, []).get(p.site)!).push(p);
    for (const s of data.sites as CoworkSite[]) {
      if (!areas.has(s.area)) continue;
      const pages = pagesBySite.get(s.id) ?? [];
      node(s.id, { kind: "site", area: s.area, label: s.name, r: Math.min(34, 7 + Math.sqrt(s.events) * 2.1), events: s.events, changes: s.changes, failed: s.failed });
      if (pages.length < 2) continue; // a one-page site is its page
      for (const p of pages.slice(0, 40)) {
        node(p.id, { kind: "page", area: p.area, site: s.id, label: p.title || p.id.split("|")[1], r: Math.min(10, 2.5 + Math.sqrt(p.events) * 0.9), events: p.events, changes: p.changes, failed: p.failed });
        links.push({ source: p.id, target: s.id });
      }
    }
    return { nodes, links };
  }, [data, areas]);
}

export function WorldMap({ data, areas, selected, highlight, onSelect }: {
  data: CoworkSummary; areas: ReadonlySet<CoworkArea>;
  selected: string | null; highlight: string | null; onSelect: (id: string | null) => void;
}) {
  const [wrapRef, size] = useSize<HTMLDivElement>();
  const fg = useRef<ForceGraphMethods<GNode, GLink> | undefined>(undefined);
  const graph = useGraph(data, areas);
  const [hover, setHover] = useState<string | null>(null);
  const fitted = useRef(false);

  useEffect(() => {
    const g = fg.current;
    if (!g) return;
    g.d3Force("area", areaForce(0.12) as never);
    g.d3Force("collide", collideForce() as never);
    (g.d3Force("charge") as any)?.strength?.((n: GNode) => (n.kind === "site" ? -50 - n.r * 3 : -10));
    (g.d3Force("link") as any)?.distance?.((l: any) => 16 + (l.target as GNode).r * 1.2)?.strength?.(0.9);
    g.d3Force("center", null as never);
    g.d3ReheatSimulation();
  }, [graph]);

  // Frame the places once they've spread out. A running thread refreshes and reheats the layout, so the
  // simulation may never stop: don't wait for onEngineStop alone.
  useEffect(() => {
    if (fitted.current || !graph.nodes.length) return;
    const t = setTimeout(() => { if (!fitted.current) { fitted.current = true; fg.current?.zoomToFit(700, 80); } }, 1200);
    return () => clearTimeout(t);
  }, [graph]);

  // A page of a one-page site has no node of its own: it resolves to the site.
  const siteOfPage = useMemo(() => new Map(data.pages.map((p) => [p.id, p.site])), [data]);
  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const resolve = (id: string | null) => (id ? byId.get(id) ?? byId.get(siteOfPage.get(id) ?? "") ?? null : null);

  // Zoom to the selected place (from the list of changes, or a click).
  const sel = resolve(selected);
  useEffect(() => {
    if (sel && sel.x !== undefined) { fg.current?.centerAt(sel.x, sel.y, 700); fg.current?.zoom(2.4, 700); }
  }, [sel]);

  const usedAreas = useMemo(() => [...new Set(graph.nodes.map((n) => n.area))], [graph]);
  // Lit: the focused place, its site and its pages. Everything else fades.
  const active = resolve(hover ?? highlight) ?? sel;
  const lit = (n: GNode) => !active || n === active || n.site === active.id || n.id === active.site;

  return (
    <div className="cw-map" ref={wrapRef}>
      <ForceGraph2D<GNode, GLink>
        ref={fg}
        width={size.w}
        height={size.h}
        graphData={graph}
        backgroundColor="rgba(0,0,0,0)"
        nodeRelSize={1}
        nodeVal={(n) => n.r * n.r}
        linkColor={() => "rgba(29,29,31,0.10)"}
        linkWidth={1}
        enableNodeDrag={false}
        cooldownTicks={300}
        onEngineStop={() => { if (!fitted.current) { fitted.current = true; fg.current?.zoomToFit(700, 80); } }}
        onNodeHover={(n) => setHover(n ? (n as GNode).id : null)}
        onNodeClick={(n) => onSelect((n as GNode).id)}
        onBackgroundClick={() => onSelect(null)}
        nodePointerAreaPaint={(n, color, ctx) => { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(n.x!, n.y!, Math.max(n.r, 6), 0, Math.PI * 2); ctx.fill(); }}
        onRenderFramePre={(ctx, scale) => {
          ctx.save();
          ctx.textAlign = "center";
          ctx.font = `800 ${Math.round(30 / Math.max(scale, 0.6))}px "Cabinet Grotesk", system-ui, sans-serif`;
          for (const a of usedAreas) {
            const [x, y] = ANCHOR[a];
            ctx.fillStyle = "rgba(29,29,31,0.06)";
            ctx.fillText(AREA_NAME[a], x, y - 150);
          }
          ctx.restore();
        }}
        nodeCanvasObject={(n, ctx, scale) => {
          const on = n === active || n === sel;
          const dim = !lit(n);
          const color = AREA_COLOR[n.area];
          ctx.save();
          ctx.globalAlpha = dim ? 0.35 : 1;
          if (n.changes > 0) { // orange ring: something changed here
            ctx.beginPath(); ctx.arc(n.x!, n.y!, n.r + 3.2, 0, Math.PI * 2);
            ctx.strokeStyle = HOT; ctx.lineWidth = n.kind === "site" ? 2.4 : 1.6; ctx.stroke();
          }
          ctx.beginPath(); ctx.arc(n.x!, n.y!, n.r, 0, Math.PI * 2);
          ctx.fillStyle = n.kind === "site" ? `${color}24` : color; ctx.fill();
          if (n.kind === "site") { ctx.strokeStyle = color; ctx.lineWidth = on ? 2.4 : 1.4; ctx.stroke(); }
          if (n.failed > 0) { ctx.beginPath(); ctx.arc(n.x! + n.r * 0.72, n.y! - n.r * 0.72, Math.max(2.2, n.r * 0.16), 0, Math.PI * 2); ctx.fillStyle = RISK; ctx.fill(); }
          const showLabel = n.kind === "site" || on || scale > 2.4;
          if (showLabel) {
            const fs = (n.kind === "site" ? 12.5 : 10.5) / Math.min(Math.max(scale, 0.7), 2.2);
            ctx.font = `${n.kind === "site" ? 650 : 500} ${fs}px Satoshi, system-ui, sans-serif`;
            ctx.textAlign = "center"; ctx.textBaseline = "top";
            ctx.fillStyle = n.kind === "site" ? "#1d1d1f" : "#515154";
            ctx.fillText(short(n.label, n.kind === "site" ? 30 : 36), n.x!, n.y! + n.r + 4 / Math.max(scale, 0.7));
          }
          ctx.restore();
        }}
      />
    </div>
  );
}
