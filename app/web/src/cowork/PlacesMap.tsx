// Owner: cowork. The places map, in the code map's language: each kind of work (Web, Services, Your apps, Apps) is a
// circle like a top folder, its sites circles inside it, their pages dots, packed the same way (d3-hierarchy: the same
// places always give the same map, nothing floats). A page is coloured by when it was last worked on, ringed orange if
// something changed there, a red dot if a step failed there. The open thread's marker stands on the place it's at (its
// newest while it follows live, the moment you're on when you look back: then a faint second marker, the agent where it
// is now stays solid), its trail through the places it went before. The camera follows it from site to site: on a small
// map it frames the site it's in. A click on a place opens its step (CoworkView).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D, { type ForceGraphMethods, type NodeObject } from "react-force-graph-2d";
import { hierarchy, pack } from "d3-hierarchy";
import type { CoworkArea, CoworkEvent, CoworkPage, CoworkSite, CoworkSummary } from "@contract";
import { AREA_NAME } from "./data";
import { useCamera, type Camera, type View } from "../map/camera";
import { mapStyle, drawMarker, platform } from "../map/themes";
import { css, readTokens, recencyRGB } from "../map/color";
import { createRedraw, Motion } from "../map/redraw";
import { useTheme } from "../lib/theme";
import { clock, isReplay } from "../lib/live";
import { sinceMs } from "../lib/visit";

/** One circle of the places map. */
export type PNode = NodeObject & {
  id: string; kind: "area" | "site" | "page"; area: CoworkArea; label: string; r: number; x: number; y: number;
  events: number; changes: number; failed: number; lastTs?: string;
  up?: PNode;
  /** A circle that holds others (an area, a site with pages), drawn as the code map draws a folder. */
  dir?: object;
};
type PlacesGraph = { id: number; nodes: PNode[]; folders: PNode[] };

const HOT = "#ff6a3d", RISK = "#d93025";
const GLIDE_MS = 650;
const TRAIL = 6;          // the places before the marker's, its trail

const leafR = (events: number) => Math.min(16, 3.2 + Math.sqrt(events) * 1.3);
const short = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const pageName = (p: CoworkPage) => p.title || p.id.split("|")[1] || p.id;

type Tree = { id: string; kind: PNode["kind"]; area: CoworkArea; label: string; events: number; changes: number; failed: number; lastTs?: string; children?: Tree[] };

let builds = 0;
/** Lay the places out: areas, then sites, then pages, biggest first, packed like the code map's folders. */
function layout(data: CoworkSummary): PlacesGraph {
  const pagesBySite = new Map<string, CoworkPage[]>();
  for (const p of data.pages) (pagesBySite.get(p.site) ?? pagesBySite.set(p.site, []).get(p.site)!).push(p);
  const byArea = new Map<CoworkArea, Tree[]>();
  for (const s of data.sites as CoworkSite[]) {
    const pages = pagesBySite.get(s.id) ?? [];
    const site: Tree = { id: s.id, kind: pages.length < 2 ? "page" : "site", area: s.area, label: s.name, events: s.events, changes: s.changes, failed: s.failed, lastTs: s.lastTs };
    if (pages.length >= 2) site.children = pages.slice(0, 80).map((p) => ({ id: p.id, kind: "page", area: p.area, label: pageName(p), events: p.events, changes: p.changes, failed: p.failed, lastTs: p.lastTs }));
    (byArea.get(s.area) ?? byArea.set(s.area, []).get(s.area)!).push(site);
  }
  const root: Tree = { id: "places", kind: "area", area: "web", label: "", events: 0, changes: 0, failed: 0,
    children: [...byArea].map(([area, sites]) => ({ id: `area|${area}`, kind: "area", area, label: AREA_NAME[area], events: 0, changes: 0, failed: 0, children: sites })) };
  const h = hierarchy(root).sum((d) => (d.children ? 0 : leafR(d.events) ** 2))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0) || a.data.label.localeCompare(b.data.label));
  pack<Tree>().radius((d) => leafR(d.data.events)).padding((d) => (d.depth === 0 ? 46 : d.depth === 1 ? 14 : 5))(h);
  const nodes: PNode[] = [], folders: PNode[] = [], byId = new Map<string, PNode>();
  const siteName = new Map<string, string>();
  h.each((d) => {
    if (d.depth === 0) return;
    const t = d.data, c = d as unknown as { x: number; y: number; r: number };
    const up = d.parent && d.parent.depth > 0 ? byId.get(d.parent.data.id) : undefined;
    if (t.kind === "site") siteName.set(t.id, t.label);
    const n: PNode = { id: t.id, kind: t.kind, area: t.area, label: t.label, r: c.r, x: c.x, y: c.y, events: t.events, changes: t.changes, failed: t.failed, lastTs: t.lastTs, up };
    if (t.children) { n.dir = {}; folders.push(n); }
    nodes.push(n); byId.set(n.id, n);
  });
  return { id: ++builds, nodes, folders };
}

/** Which place a cowork event stands on: its page when the page has its own dot, else its site. */
const placeOf = (e: CoworkEvent, ids: ReadonlySet<string>) => (ids.has(`${e.area}|${e.page}`) ? `${e.area}|${e.page}` : `${e.area}|${e.site}`);

export function PlacesMap({ data, selected, highlight, onSelect, rightInset = 0, small, beatOf, cursor, live, letter }: {
  data: CoworkSummary; selected: string | null; highlight: string | null; onSelect: (id: string | null) => void;
  /** Set while the step panel is open on the right. */
  rightInset?: number;
  /** A small map (the Claude app's browser pane): the camera frames the site the thread is in. */
  small: boolean;
  /** The thread's moment of a step (thread.stepBeat), to place the marker at the replay's cursor. */
  beatOf: (stepId: string) => number | undefined;
  /** The replay's cursor (a moment), and whether the thread follows live (the marker on its newest place). */
  cursor: number; live: boolean;
  /** The letter on the marker (the thread's). */
  letter: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const fg = useRef<ForceGraphMethods<PNode, never> | undefined>(undefined);
  const theme = useTheme();
  const tokens = useMemo(readTokens, [theme]);
  const graph = useMemo(() => layout(data), [data]);
  const graphRef = useRef(graph); graphRef.current = graph;
  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const ids = useMemo(() => new Set(byId.keys()), [byId]);
  const cam = useCamera(fg as never, wrapRef);
  const camRef = useRef<Camera>(cam); camRef.current = cam;
  const redraw = useMemo(() => createRedraw(() => { const g = fg.current; if (g) g.zoom(g.zoom()); }), []);
  useEffect(() => () => redraw.stop(), [redraw]);

  // ---- where the thread is: the events up to the cursor (all of them, live), their places in order ----
  const placeAt = useMemo(() => {
    const evs = data.events.map((e) => ({ e, beat: beatOf(e.stepId) ?? Infinity, place: placeOf(e, ids) }));
    return (upTo: number) => {
      const out: { place: string; e: CoworkEvent }[] = [];
      for (const x of evs) if (x.beat <= upTo) { if (out[out.length - 1]?.place !== x.place) out.push({ place: x.place, e: x.e }); else out[out.length - 1].e = x.e; }
      return out;
    };
  }, [data, ids, beatOf]);
  const now = useMemo(() => placeAt(Infinity), [placeAt]);
  const past = useMemo(() => (live ? null : placeAt(cursor)), [placeAt, cursor, live]);
  const path = past ?? now;                            // the trail the camera and the marker follow
  const here = path[path.length - 1]?.place ?? null;
  const nowAt = now[now.length - 1]?.place ?? null;    // the agent where it is now (solid while you look back)

  // The marker glides from place to place.
  const mark = useRef<{ x: number; y: number; fx: number; fy: number; t0: number; at: string | null }>({ x: 0, y: 0, fx: 0, fy: 0, t0: -1e9, at: null });
  useEffect(() => {
    const m = mark.current, n = here ? byId.get(here) : undefined;
    if (!n) { m.at = null; return; }
    const p = platform(n.x, n.y, n.r, 1);
    if (m.at === null) { m.x = m.fx = p.x; m.y = m.fy = p.y; m.t0 = -1e9; }
    else { m.fx = m.x; m.fy = m.y; m.t0 = performance.now(); }
    m.at = here;
    redraw.kick(GLIDE_MS + 50);
  }, [here, byId, redraw]);

  // ---- the camera: everything at first; then the thread's place, from site to site ----
  const userAt0 = useRef(0), framed = useRef(false), lastSite = useRef<string | null>(null);
  const fitAll = useCallback((ms = 700) => {
    const ns = graphRef.current.nodes.filter((n) => !n.up);
    if (!ns.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of ns) { x0 = Math.min(x0, n.x - n.r); x1 = Math.max(x1, n.x + n.r); y0 = Math.min(y0, n.y - n.r - 30); y1 = Math.max(y1, n.y + n.r); }
    camRef.current.frame({ x0, y0, x1, y1 }, { pad: 36, maxZoom: 3 }, ms);
  }, []);
  const siteOf = (n: PNode) => (n.kind === "page" && n.up?.kind === "site" ? n.up : n);
  const frameSite = useCallback((n: PNode, ms = 650) => {
    const s = siteOf(n);
    camRef.current.frame({ x0: s.x - s.r, x1: s.x + s.r, y0: s.y - s.r - 18, y1: s.y + s.r }, { pad: 28, maxZoom: 3.2, minZoom: 0.6 }, ms);
  }, []);
  useEffect(() => {
    if (framed.current || !graph.nodes.length) return;
    const t = requestAnimationFrame(() => { framed.current = true; fitAll(0); });
    return () => cancelAnimationFrame(t);
  }, [graph, fitAll]);
  // The thread moved to another place: frame its site if it left the view (on a small map, as soon as it goes to
  // another site), unless you moved the camera since it last did.
  const sel = selected ? byId.get(selected) ?? null : null;
  const focus = rightInset > 0 ? sel : null;
  useEffect(() => {
    const n = here ? byId.get(here) : undefined, c = camRef.current;
    if (!n || focus || c.userAt() > userAt0.current) return;
    const s = siteOf(n), m = small ? Math.min(c.safe.current.w, c.safe.current.h) * 0.18 : 24;
    const moved = s.id !== lastSite.current;
    lastSite.current = s.id;
    if ((small && moved) || !c.sees(n.x, n.y, m)) { frameSite(n); userAt0.current = performance.now(); }
  }, [here, byId, small, focus, frameSite]);
  // A place's step open in the panel: the camera on it; closed: back where it was.
  const before = useRef<View | null>(null);
  useEffect(() => {
    const c = camRef.current;
    if (focus) { before.current ??= c.view(); c.lookAt(focus.x, focus.y, Math.max(2.2, c.view()?.k ?? 0), 650); return; }
    if (before.current) { c.moveTo(before.current, 650); before.current = null; }
  }, [focus]);

  // ---- drawing ----
  const [hover, setHover] = useState<string | null>(null);
  const active = (hover ? byId.get(hover) : undefined) ?? (highlight ? byId.get(highlight) : undefined) ?? sel ?? undefined;
  // Lit: the place pointed at or picked, what it holds and what holds it. The rest fades.
  const lit = (n: PNode) => !active || n === active || n.up === active || active.up === n || (active.kind === "page" && n.up === active.up);
  const st = mapStyle();
  const recorded = isReplay();
  useEffect(() => { redraw.kick(); }, [graph, hover, highlight, selected, theme, here, nowAt, size.w, size.h, redraw]);

  const drawNode = (n: PNode, ctx: CanvasRenderingContext2D, scale: number) => {
    const dim = lit(n) ? 1 : 0.35;
    ctx.save();
    if (n.dir) {
      ctx.globalAlpha = (n.kind === "area" ? 0.22 : 0.16) * dim;
      ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.strokeStyle = st.fileInk; ctx.lineWidth = (n === sel ? 2 : 1) / scale; ctx.stroke();
      ctx.globalAlpha = (n.kind === "area" ? 0.02 : 0.03) * dim; ctx.fillStyle = st.fileInk; ctx.fill();
    } else {
      const c = css(recencyRGB(tokens, n.lastTs, clock(), recorded, sinceMs));
      ctx.globalAlpha = dim;
      ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2); ctx.fillStyle = n.changes > 0 ? HOT : c; ctx.fill();
      if (n.changes > 0) { ctx.beginPath(); ctx.arc(n.x, n.y, n.r + 2.2 / scale, 0, Math.PI * 2); ctx.strokeStyle = HOT; ctx.lineWidth = 1.6 / scale; ctx.stroke(); }
      if (n === sel || n === active) { ctx.beginPath(); ctx.arc(n.x, n.y, n.r + 4 / scale, 0, Math.PI * 2); ctx.strokeStyle = tokens.accent; ctx.lineWidth = 2 / scale; ctx.stroke(); }
      if (n.failed > 0) { ctx.beginPath(); ctx.arc(n.x + n.r * 0.72, n.y - n.r * 0.72, Math.max(2 / scale, n.r * 0.2), 0, Math.PI * 2); ctx.fillStyle = RISK; ctx.fill(); }
    }
    ctx.restore();
  };

  const endFrame = (ctx: CanvasRenderingContext2D, scale: number) => {
    const g = graphRef.current, t = performance.now(), font = tokens.body;
    // Names: areas over their circles, sites inside their tops, pages under them once they're big enough; no two cross.
    const taken: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const label = (text: string, x: number, y: number, px: number, weight: number, fill: string, alpha: number, force = false) => {
      ctx.font = `${weight} ${px / scale}px ${font}`;
      const w = ctx.measureText(text).width, p = 2 / scale, b = { x0: x - w / 2 - p, x1: x + w / 2 + p, y0: y - p, y1: y + px / scale + p };
      if (!force && taken.some((o) => o.x0 < b.x1 && b.x0 < o.x1 && o.y0 < b.y1 && b.y0 < o.y1)) return;
      taken.push(b);
      ctx.globalAlpha = alpha; ctx.lineWidth = 3.2 / scale; ctx.strokeStyle = st.halo; ctx.strokeText(text, x, y);
      ctx.fillStyle = fill; ctx.fillText(text, x, y);
    };
    ctx.save(); ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.lineJoin = "round";
    const cur = here ? byId.get(here) : undefined;
    if (cur) label(short(cur.label, 40), cur.x, cur.y + cur.r + 4 / scale, 12.5, 700, tokens.accent, 1, true);
    for (const n of g.nodes) if (n.kind === "area") label(n.label, n.x, n.y - n.r - 26 / scale, 17, 750, st.fileInk, 0.42);
    for (const n of g.nodes) if (n.kind === "site" && n.r * scale > 26) label(short(n.label, 30), n.x, n.y - n.r + 6 / scale, 12.5, 650, st.fileInk, lit(n) ? 0.75 : 0.35);
    for (const n of g.nodes) {
      if (n.dir || n === cur || n.r * scale < (n.kind === "page" && !n.up?.dir ? 3 : 5.5)) continue;
      label(short(n.label, 32), n.x, n.y + n.r + 3 / scale, n.up?.kind === "site" ? 10.5 : 12, n.up?.kind === "site" ? 500 : 650, n.up?.kind === "site" ? st.fileInkQuiet : st.fileInk, lit(n) ? 1 : 0.4);
    }
    ctx.restore();

    // The trail: through the places the thread went before this one, newest strongest.
    const pts = path.slice(-TRAIL - 1).map((x) => byId.get(x.place)).filter((n): n is PNode => !!n);
    const m = mark.current, p = Math.min(1, (t - m.t0) / GLIDE_MS), e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
    const tn = here ? byId.get(here) : undefined;
    if (tn) { const to = platform(tn.x, tn.y, tn.r, scale); m.x = m.fx + (to.x - m.fx) * e; m.y = m.fy + (to.y - m.fy) * e; }
    if (pts.length > 1) {
      ctx.save(); ctx.lineCap = "round"; ctx.strokeStyle = tokens.accent;
      for (let k = 0; k < pts.length - 1; k++) {
        const a = pts[k], b = k === pts.length - 2 ? { x: m.x, y: m.y } : pts[k + 1], w = (k + 1) / (pts.length - 1);
        ctx.globalAlpha = (past ? 0.45 : 1) * (0.12 + 0.5 * w); ctx.lineWidth = (1.2 + 1.4 * w) / scale;
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, dx = b.x - a.x, dy = b.y - a.y;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(mx - dy * 0.15, my + dx * 0.15, b.x, b.y); ctx.stroke();
      }
      ctx.restore();
    }
    // The marker: where the thread is (faint when you look back), and the agent where it is now, solid, on top.
    const nn = nowAt ? byId.get(nowAt) : undefined;
    if (past && tn) { ctx.save(); ctx.globalAlpha = 0.42; drawMarker(ctx, m.x, m.y, 9 / scale, tokens.accent, letter, 10, font, scale, { ...st, glow: false }); ctx.restore(); }
    if (nn) { const q = past ? platform(nn.x, nn.y, nn.r, scale) : { x: m.x, y: m.y }; drawMarker(ctx, q.x, q.y, 9 / scale, tokens.accent, letter, 10, font, scale, { ...st, glow: false }); }
    redraw.drew(p < 1 ? Motion.Smooth : Motion.None);
  };

  return (
    <div className="cw-map" ref={wrapRef}>
      <ForceGraph2D<PNode, never>
        ref={fg as never}
        width={size.w}
        height={size.h}
        graphData={{ nodes: graph.nodes, links: [] }}
        backgroundColor="rgba(0,0,0,0)"
        nodeRelSize={1}
        nodeVal={(n) => (n as PNode).r ** 2}
        nodeLabel={() => ""}
        warmupTicks={0}
        cooldownTicks={0}
        enableNodeDrag={false}
        nodeCanvasObject={(n, ctx, scale) => drawNode(n as PNode, ctx, scale)}
        onRenderFramePost={endFrame}
        onNodeHover={(n) => setHover(n && (n as PNode).kind !== "area" ? (n as PNode).id : null)}
        onNodeClick={(n) => { if ((n as PNode).kind !== "area") onSelect((n as PNode).id); }}
        onBackgroundClick={() => onSelect(null)}
        nodePointerAreaPaint={(n, color, ctx) => {
          const p = n as PNode;
          if (p.kind === "area") return;   // the areas aren't places: clicks go through to what's inside
          ctx.fillStyle = color; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(p.r, 5), 0, Math.PI * 2); ctx.fill();
        }}
      />
    </div>
  );
}
