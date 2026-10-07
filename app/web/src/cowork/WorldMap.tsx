// Owner: cowork. The places map: one area per kind of work, sites as bubbles, pages around them.
// Same language as the code map: size = how much the agents worked there, orange = something changed there.
import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D, { type ForceGraphMethods, type NodeObject } from "react-force-graph-2d";
import type { CoworkArea, CoworkPage, CoworkSite, CoworkSummary } from "@contract";
import { AREA_NAME } from "./data";
import { boxOf, isFitKey, useCamera, type Camera, type View } from "../map/camera";
import { LabelSpace } from "../map/labels";
import { mapStyle } from "../map/themes";
import { useTheme } from "../lib/theme";

type GNode = NodeObject & {
  id: string; kind: "site" | "page"; area: CoworkArea; label: string; r: number;
  events: number; changes: number; failed: number; site?: string;
};
type GLink = { source: string | GNode; target: string | GNode };

export const AREA_COLOR: Record<CoworkArea, string> = { web: "#2563eb", local: "#7d8597", services: "#1f9d55", apps: "#c2410c" };
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

/** Room for an area's heading above its places, in graph units (the heading itself is ~30px on screen). */
const HEAD_GAP = 22;
const HEAD_PX = 30;

/** Each area's heading spot: centred over its places, just above the topmost one. */
function headings(nodes: GNode[]) {
  const out = new Map<CoworkArea, { x0: number; x1: number; top: number }>();
  for (const n of nodes) {
    if (n.x === undefined || n.y === undefined) continue;
    const h = out.get(n.area) ?? { x0: Infinity, x1: -Infinity, top: Infinity };
    h.x0 = Math.min(h.x0, n.x - n.r); h.x1 = Math.max(h.x1, n.x + n.r);
    h.top = Math.min(h.top, n.y - n.r - (n.kind === "site" ? 6 : 2));
    out.set(n.area, h);
  }
  return out;
}

type Label = { text: string; x: number; y: number; font: string; size: number; ink: string; prio: number; forced: boolean; alpha: number };

export function WorldMap({ data, areas, selected, highlight, onSelect, rightInset = 0 }: {
  data: CoworkSummary; areas: ReadonlySet<CoworkArea>;
  selected: string | null; highlight: string | null; onSelect: (id: string | null) => void;
  /** No longer used: the map measures what covers it (sidebar, side panel, stats line, lens pill). */
  leftInset?: number;
  /** Set while the step panel is open on the right (its width is measured, not taken from here). */
  rightInset?: number;
}) {
  const [wrapRef, size] = useSize<HTMLDivElement>();
  const fg = useRef<ForceGraphMethods<GNode, GLink> | undefined>(undefined);
  const graph = useGraph(data, areas);
  const [hover, setHover] = useState<string | null>(null);
  const theme = useTheme();
  // Fitting and centring happen in the part of the map no panel covers (map/camera.ts).
  const cam = useCamera(fg as never, wrapRef);
  const camRef = useRef<Camera>(cam); camRef.current = cam;
  const graphRef = useRef(graph); graphRef.current = graph;

  // What the camera frames: every place ("fit"), the selected one ("sel"), or the user's own view ("free").
  const intent = useRef<"fit" | "sel" | "free">("fit");
  const intentAt = useRef(0);
  const setIntent = (i: "fit" | "sel" | "free") => { intent.current = i; intentAt.current = performance.now(); };
  const fitAll = (ms = 700) => {
    const ns = graphRef.current.nodes;
    const box = boxOf(ns);
    if (!box) return;
    for (const h of headings(ns).values()) box.y0 = Math.min(box.y0, h.top - HEAD_GAP - HEAD_PX); // the area headings too
    camRef.current.frame(box, { pad: 40, maxZoom: 2.4 }, ms);
  };

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

  // A page of a one-page site has no node of its own: it resolves to the site.
  const siteOfPage = useMemo(() => new Map(data.pages.map((p) => [p.id, p.site])), [data]);
  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const resolve = (id: string | null) => (id ? byId.get(id) ?? byId.get(siteOfPage.get(id) ?? "") ?? null : null);
  const sel = resolve(selected);
  // The camera goes to a place while its step is open in the panel, and comes back when the panel closes
  // (the place can stay picked in the list).
  const focus = rightInset > 0 ? sel : null;
  const selRef = useRef(focus); selRef.current = focus;

  /** Frame what the intent says, unless the user moved the camera since. */
  const apply = (ms = 600) => {
    if (intent.current === "free" || camRef.current.userAt() > intentAt.current) return;
    if (intent.current === "fit") fitAll(ms);
    else { const s = selRef.current; if (s && s.x !== undefined && s.y !== undefined) camRef.current.lookAt(s.x, s.y, 2.4, ms); }
  };

  // Frame the places once they've spread out. A running thread refreshes and reheats the layout, so the
  // simulation may never stop: don't wait for onEngineStop alone.
  const framed = useRef(false);
  useEffect(() => {
    if (framed.current || !graph.nodes.length) return;
    const t = setTimeout(() => { framed.current = true; apply(700); }, 1200);
    return () => clearTimeout(t);
  }, [graph]);
  const onEngineStop = () => { if (!framed.current) { framed.current = true; apply(700); } };

  // A panel opened or closed, the sidebar collapsed, the window resized: frame the same thing in the new space.
  useEffect(() => {
    const t = setTimeout(() => apply(450), 60);
    return () => clearTimeout(t);
  }, [cam.version]);

  // Zoom to the selected place (from the list of changes, or a click); closing its panel puts the camera back.
  const before = useRef<{ view: View | null; intent: "fit" | "sel" | "free" } | null>(null);
  useEffect(() => {
    const c = camRef.current;
    if (focus) {
      if (!before.current) before.current = { view: framed.current ? c.view() : null, intent: c.userAt() > intentAt.current ? "free" : intent.current };
      setIntent("sel");
      if (focus.x !== undefined) apply(700);
      return;
    }
    const b = before.current;
    before.current = null;
    if (!b) return;
    if (b.view && b.intent === "free") { setIntent("free"); c.moveTo(b.view, 700); }
    else { setIntent("fit"); apply(700); }
  }, [focus]);

  const fitNow = () => { setIntent("fit"); fitAll(700); };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (isFitKey(e)) { e.preventDefault(); fitNow(); } };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  const usedAreas = useMemo(() => [...new Set(graph.nodes.map((n) => n.area))], [graph]);
  // Lit: the focused place, its site and its pages. Everything else fades.
  const active = resolve(hover ?? highlight) ?? sel;
  const lit = (n: GNode) => !active || n === active || n.site === active.id || n.id === active.site;

  // Names go on after every bubble is drawn (no bubble covers a name), the ones you point at on top.
  const labels = useRef<Label[]>([]);
  const space = useRef(new LabelSpace());
  const ink = useMemo(() => { const s = mapStyle(); return { site: s.fileInk, page: s.fileInkQuiet, halo: s.halo, head: s.moduleInk, link: s.linkIdle }; }, [theme]);

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
        linkColor={() => ink.link}
        linkWidth={1}
        enableNodeDrag={false}
        cooldownTicks={300}
        onEngineStop={onEngineStop}
        onNodeHover={(n) => setHover(n ? (n as GNode).id : null)}
        onNodeClick={(n) => onSelect((n as GNode).id)}
        onBackgroundClick={() => onSelect(null)}
        nodePointerAreaPaint={(n, color, ctx) => { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(n.x!, n.y!, Math.max(n.r, 6), 0, Math.PI * 2); ctx.fill(); }}
        onRenderFramePre={(ctx, scale) => {
          labels.current = [];
          space.current.reset();
          // Area headings, quiet, over the topmost place of each area (so the fit keeps them clear of the lens pill).
          ctx.save();
          ctx.textAlign = "center";
          ctx.textBaseline = "bottom";
          ctx.font = `800 ${Math.round(HEAD_PX / Math.max(scale, 0.6))}px system-ui, -apple-system, "Segoe UI", sans-serif`;
          ctx.fillStyle = ink.head;
          ctx.globalAlpha = 0.45;
          const hs = headings(graph.nodes);
          for (const a of usedAreas) {
            const h = hs.get(a);
            if (h) ctx.fillText(AREA_NAME[a], (h.x0 + h.x1) / 2, h.top - HEAD_GAP / Math.max(scale, 0.6));
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
          ctx.restore();
          if (n.kind === "site" || on || scale > 2.4) {
            const k = Math.min(Math.max(scale, 0.7), 2.2), fs = (n.kind === "site" ? 12.5 : 10.5) / k;
            labels.current.push({
              text: short(n.label, n.kind === "site" ? 30 : 36), x: n.x!, y: n.y! + n.r + 4 / Math.max(scale, 0.7), size: fs,
              font: `${n.kind === "site" ? 650 : 500} ${fs}px system-ui, -apple-system, "Segoe UI", sans-serif`, ink: n.kind === "site" ? ink.site : ink.page,
              prio: (n.id === hover ? 4e6 : 0) + (on ? 2e6 : 0) + (n.kind === "site" ? 1e5 : 0) + n.r, forced: on || n.id === hover, alpha: dim ? 0.45 : 1,
            });
          }
        }}
        onRenderFramePost={(ctx, scale) => {
          const keep: Label[] = [];
          for (const l of labels.current.sort((a, b) => b.prio - a.prio)) {
            ctx.font = l.font;
            const w = ctx.measureText(l.text).width, pad = 2 / scale;
            if (space.current.claim({ x0: l.x - w / 2 - pad, x1: l.x + w / 2 + pad, y0: l.y - pad, y1: l.y + l.size + pad }, l.forced)) keep.push(l);
          }
          ctx.save();
          ctx.textAlign = "center"; ctx.textBaseline = "top";
          ctx.lineWidth = 3 / scale; ctx.strokeStyle = ink.halo; ctx.lineJoin = "round";
          for (const l of keep.reverse()) {
            ctx.globalAlpha = l.alpha; ctx.font = l.font;
            ctx.strokeText(l.text, l.x, l.y);
            ctx.fillStyle = l.ink; ctx.fillText(l.text, l.x, l.y);
          }
          ctx.restore();
        }}
      />
    </div>
  );
}

