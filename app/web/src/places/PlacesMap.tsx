// The places map, in the code map's language: each kind of work (Web, Services, Your apps, Apps) is a
// circle like a top folder, its sites circles inside it, their pages dots, packed the same way (d3-hierarchy: the same
// places always give the same map, nothing floats). A page is coloured by when it was last worked on, ringed orange if
// something changed there, a red dot if a step failed there. The open thread's marker stands on the place it's at (its
// newest while it follows live, the moment you're on when you look back: then a faint second marker, the agent where it
// is now stays solid), its trail through the places it went before. Looking back, only its recent places (the map's
// "last 15 steps" setting, counted in places) are lit and named, the rest fades: what it did up to there, not everything.
// The camera follows it from site to site: on a small map it frames the site it's in. A click on a place opens its step (CoworkView).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NodeObject } from "react-force-graph-2d";
import { hierarchy, pack } from "d3-hierarchy";
import type { CoworkArea, CoworkEvent, CoworkPage, CoworkSite, CoworkSummary } from "@contract";
import { AREA_NAME, HOME, HOME_NAME } from "./data";
import { boxOf, useCamera, type Camera, type View } from "../map/camera";
import { drawName, LabelSpace, textWidth } from "../map/labels";
import { mapStyle } from "../map/themes";
import { drawMarker } from "../map/marks";
import { platform } from "../map/routes";
import { css, readTokens, recencyRGB } from "../map/color";
import { createRedraw, Motion } from "../map/redraw";
import { useTheme } from "../lib/theme";
import { clock, isRecording } from "../lib/live";
import { sinceMs } from "../lib/visit";
import { useStepWindow } from "../map/prefs";
import { glide, GLIDE_MS, setOff, trailPath, type Glider } from "../map/tracer";
import { useSize } from "../lib/hooks";
import { useCanvasZoom } from "../map/useCanvasZoom";

/** One circle of the places map. */
export type PNode = NodeObject & {
  id: string; kind: "area" | "site" | "page" | "home"; area: CoworkArea; label: string; r: number; x: number; y: number;
  events: number; changes: number; failed: number; lastTs?: string;
  up?: PNode;
  /** A circle that holds others (an area, a site with pages), drawn as the code map draws a folder. */
  dir?: object;
};
type PlacesGraph = { id: number; nodes: PNode[]; folders: PNode[] };

const HOT = "#ff6a3d", RISK = "#d93025";
const TRAIL = 6;          // the places before the marker's, its trail

const leafR = (events: number) => Math.min(HOME_R, 3.2 + Math.sqrt(events) * 1.3);
const HOME_R = 22, HOME_EVENTS = ((HOME_R - 3.2) / 1.3) ** 2;   // Your computer: as big as the biggest place
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
  // Your computer first: where every thread starts and comes back to, a place of its own beside the areas.
  const root: Tree = { id: "places", kind: "area", area: "web", label: "", events: 0, changes: 0, failed: 0,
    children: [{ id: HOME, kind: "home", area: "local", label: HOME_NAME, events: HOME_EVENTS, changes: 0, failed: 0 },
      ...[...byArea].map(([area, sites]): Tree => ({ id: `area|${area}`, kind: "area", area, label: AREA_NAME[area], events: 0, changes: 0, failed: 0, children: sites }))] };
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

/** The place under a point (graph units) at zoom k: the one drawn last (on top) whose circle, at least 5 units wide, holds
 *  it. Not the areas: they aren't places, a point on one goes to what's inside or to nothing. */
export function placeUnder(g: PlacesGraph, x: number, y: number, k: number): PNode | null {
  const slack = 1 / k;   // the library's hit map drew each circle one pixel wider
  for (let i = g.nodes.length - 1; i >= 0; i--) {
    const n = g.nodes[i];
    if (n.kind !== "area" && Math.hypot(x - n.x, y - n.y) <= Math.max(n.r, 5) + slack) return n;
  }
  return null;
}

/** Which place a cowork event stands on: its page when the page has its own dot, else its site. */
const placeOf = (e: CoworkEvent, ids: ReadonlySet<string>) => (ids.has(`${e.area}|${e.page}`) ? `${e.area}|${e.page}` : `${e.area}|${e.site}`);

export function PlacesMap({ data, selected, highlight, onSelect, rightInset = 0, small, beatOf, beats, cursor, until, live, letter }: {
  data: CoworkSummary; selected: string | null; highlight: string | null; onSelect: (id: string | null) => void;
  /** Set while the step panel is open on the right. */
  rightInset?: number;
  /** A small map (the Claude app's browser pane): the camera frames the site the thread is in. */
  small: boolean;
  /** A step's place in the thread, step by step (places/rows.ts usePlaceTimeline), and how many steps it has (after
   *  its last trip out, it's back on Your computer). */
  beatOf: (stepId: string) => number | undefined;
  beats: number;
  /** Where the thread is, in the same steps as beatOf, and the event to stop at there (the list's row: a step can hold
   *  several); whether it follows live (the marker on its newest place). */
  cursor: number; until?: string | null; live: boolean;
  /** The letter on the marker (the thread's). */
  letter: string;
}) {
  const [wrapRef, size] = useSize<HTMLDivElement>();
  // The canvas and its camera (map/useCanvasZoom.ts), as on the code map: drawn only when something changes.
  const frameRef = useRef<(ctx: CanvasRenderingContext2D, k: number) => void>(() => {});
  const drawFrame = useCallback((ctx: CanvasRenderingContext2D, k: number) => frameRef.current(ctx, k), []);
  const { canvasRef, ref: fg, canvas } = useCanvasZoom({ width: size.w, height: size.h, draw: drawFrame });
  const theme = useTheme();
  const tokens = useMemo(readTokens, [theme]);
  const graph = useMemo(() => layout(data), [data]);
  const graphRef = useRef(graph); graphRef.current = graph;
  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const ids = useMemo(() => new Set(byId.keys()), [byId]);
  const cam = useCamera(fg, wrapRef);
  const camRef = useRef<Camera>(cam); camRef.current = cam;
  const redraw = useMemo(() => createRedraw(() => fg.current?.redraw()), []);
  useEffect(() => () => redraw.stop(), [redraw]);

  // ---- where the thread is: Your computer, then the places of its events up to the cursor (all of them, live), in
  // order, back on Your computer for each stretch of work in the code between them (a moment with no event) ----
  const placeAt = useMemo(() => {
    const evs = data.events.map((e) => ({ e, beat: beatOf(e.stepId) ?? Infinity, place: placeOf(e, ids) }));
    /** The path up to a moment, or up to one event in it (the list's row: a moment can hold several stretches). */
    return (upTo: number, until?: string | null) => {
      const out: { place: string; e?: CoworkEvent }[] = [{ place: HOME }];
      const push = (place: string, e?: CoworkEvent) => { const l = out[out.length - 1]; if (l.place !== place) out.push({ place, e }); else if (e) l.e = e; };
      let prev = -1;
      for (const x of evs) {
        if (x.beat > upTo) break;
        if (prev >= 0 && x.beat - prev > 1) push(HOME);   // moments between two trips out: back in the code
        push(x.place, x.e);
        prev = Math.max(prev, x.beat);
        if (until && x.e.id === until) return out;
      }
      const end = Math.min(upTo, beats - 1);
      if (prev >= 0 && end > prev) push(HOME);
      return out;
    };
  }, [data, ids, beatOf, beats]);
  const now = useMemo(() => placeAt(Infinity), [placeAt]);
  const past = useMemo(() => (live ? null : placeAt(cursor, until)), [placeAt, cursor, live, until]);
  const path = past ?? now;                            // the trail the camera and the marker follow
  const here = path[path.length - 1]?.place ?? null;
  const nowAt = now[now.length - 1]?.place ?? null;    // the agent where it is now (solid while you look back)
  // Looking back: the places of its recent window, and the sites and areas that hold them.
  const win = useStepWindow();
  const focus = useMemo(() => {
    if (!past) return null;
    const set = new Set<string>();
    for (const x of win === "all" ? past : past.slice(-win)) {
      for (let n = byId.get(x.place); n; n = n.up) set.add(n.id);
    }
    return set;
  }, [past, win, byId]);

  // The marker glides from place to place.
  const mark = useRef<Glider & { at: string | null }>({ x: 0, y: 0, fromX: 0, fromY: 0, t0: -1e9, at: null });
  useEffect(() => {
    const m = mark.current, n = here ? byId.get(here) : undefined;
    if (!n) { m.at = null; return; }
    const p = platform(n.x, n.y, n.r, 1);
    if (m.at === null) { m.x = m.fromX = p.x; m.y = m.fromY = p.y; m.t0 = -1e9; }
    else setOff(m, performance.now());
    m.at = here;
    redraw.kick(GLIDE_MS + 50);
  }, [here, byId, redraw]);

  // ---- the camera: everything at first; then the thread's place, from site to site ----
  const userAt0 = useRef(0), framed = useRef(false), lastSite = useRef<string | null>(null);
  const fitAll = useCallback((ms = 700) => {
    const box = boxOf(graphRef.current.nodes.filter((n) => !n.up));
    if (!box) return;
    box.y0 -= 30;   // room for the areas' names over their circles
    camRef.current.frame(box, { pad: 36, maxZoom: 3 }, ms);
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
  const panelOn = rightInset > 0 ? sel : null;
  useEffect(() => {
    const n = here ? byId.get(here) : undefined, c = camRef.current;
    if (!n || panelOn || c.userAt() > userAt0.current) return;
    const s = siteOf(n), m = small ? Math.min(c.safe.current.w, c.safe.current.h) * 0.18 : 24;
    const moved = s.id !== lastSite.current;
    lastSite.current = s.id;
    if ((small && moved) || !c.sees(n.x, n.y, m)) { frameSite(n); userAt0.current = performance.now(); }
  }, [here, byId, small, panelOn, frameSite]);
  // A place's step open in the panel: the camera on it; closed: back where it was.
  const before = useRef<View | null>(null);
  useEffect(() => {
    const c = camRef.current;
    if (panelOn) { before.current ??= c.view(); c.lookAt(panelOn.x, panelOn.y, Math.max(2.2, c.view()?.k ?? 0), 650); return; }
    if (before.current) { c.moveTo(before.current, 650); before.current = null; }
  }, [panelOn]);

  // ---- drawing ----
  const [hover, setHover] = useState<string | null>(null);
  const active = (hover ? byId.get(hover) : undefined) ?? (highlight ? byId.get(highlight) : undefined) ?? sel ?? undefined;
  // Lit: the place pointed at or picked, what it holds and what holds it. The rest fades.
  const pointed = (n: PNode) => !active || n === active || n.up === active || active.up === n || (active.kind === "page" && n.up === active.up);
  const lit = (n: PNode) => pointed(n) && (!focus || n.kind === "area" || n.kind === "home" || focus.has(n.id));
  const st = mapStyle();
  const recorded = isRecording();
  useEffect(() => { redraw.kick(); }, [graph, hover, highlight, selected, theme, here, nowAt, focus, size.w, size.h, redraw]);

  const drawNode = (n: PNode, ctx: CanvasRenderingContext2D, scale: number) => {
    const dim = lit(n) ? 1 : 0.35;
    ctx.save();
    if (n.kind === "home") {
      ctx.globalAlpha = dim;
      ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fillStyle = st.halo; ctx.fill();
      ctx.strokeStyle = st.fileInk; ctx.globalAlpha = 0.35 * dim; ctx.lineWidth = 1.4 / scale; ctx.stroke();
      // A screen: the computer.
      const w = n.r * 0.9, h = n.r * 0.58;
      ctx.globalAlpha = 0.55 * dim; ctx.lineWidth = 1.6 / scale; ctx.lineJoin = "round";
      ctx.beginPath(); ctx.roundRect?.(n.x - w / 2, n.y - h * 0.7, w, h, n.r * 0.08); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(n.x - w * 0.62, n.y + h * 0.45); ctx.lineTo(n.x + w * 0.62, n.y + h * 0.45); ctx.stroke();
      if (n === sel || n === active) { ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(n.x, n.y, n.r + 4 / scale, 0, Math.PI * 2); ctx.strokeStyle = tokens.accent; ctx.lineWidth = 2 / scale; ctx.stroke(); }
    } else if (n.dir) {
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

  const space = useRef(new LabelSpace());
  const endFrame = (ctx: CanvasRenderingContext2D, scale: number) => {
    const g = graphRef.current, t = performance.now(), font = tokens.body;
    // Names: areas over their circles, sites inside their tops, pages under them once they're big enough; no two cross.
    // Placed in the map's label space (a grid: map/labels.ts) and stamped as the map stamps its names (drawName).
    const sp = space.current;
    sp.reset(48 / scale);
    const label = (text: string, x: number, y: number, px: number, weight: number, fill: string, alpha: number, force = false) => {
      const w = textWidth(ctx, text, weight, font, px, px) / scale, p = 2 / scale;
      if (!sp.claim({ x0: x - w / 2 - p, x1: x + w / 2 + p, y0: y - p, y1: y + px / scale + p }, force)) return;
      drawName(ctx, text, x, y, px, weight, font, fill, st.halo, alpha);
    };
    ctx.save();
    const cur = here ? byId.get(here) : undefined;
    if (cur) label(short(cur.label, 40), cur.x, cur.y + cur.r + 4 / scale, 12.5, 700, tokens.accent, 1, true);
    for (const n of g.nodes) if (n.kind === "area") label(n.label, n.x, n.y - n.r - 26 / scale, 17, 750, st.fileInk, 0.42);
    const home = byId.get(HOME);
    if (home && home !== cur) label(HOME_NAME, home.x, home.y + home.r + 4 / scale, 12.5, 650, st.fileInk, lit(home) ? 0.85 : 0.4);
    for (const n of g.nodes) if (n.kind === "site" && n.r * scale > 26 && (!focus || focus.has(n.id))) label(short(n.label, 30), n.x, n.y - n.r + 6 / scale, 12.5, 650, st.fileInk, lit(n) ? 0.75 : 0.35);
    for (const n of g.nodes) {
      if (n.dir || n.kind === "home" || n === cur || (focus && !focus.has(n.id)) || n.r * scale < (n.kind === "page" && !n.up?.dir ? 3 : 5.5)) continue;
      label(short(n.label, 32), n.x, n.y + n.r + 3 / scale, n.up?.kind === "site" ? 10.5 : 12, n.up?.kind === "site" ? 500 : 650, n.up?.kind === "site" ? st.fileInkQuiet : st.fileInk, lit(n) ? 1 : 0.4);
    }
    ctx.restore();

    // The trail: through the places the thread went before this one, newest strongest.
    const pts = path.slice(-TRAIL - 1).map((x) => byId.get(x.place)).filter((n): n is PNode => !!n);
    // The marker glides as the map's do (map/tracer.ts), always on the soft curve: places have no theme routes.
    const m = mark.current, tn = here ? byId.get(here) : undefined;
    let p = Math.min(1, (t - m.t0) / GLIDE_MS);
    if (tn) { const to = platform(tn.x, tn.y, tn.r, scale); p = glide(m, to.x, to.y, t, "glide").p; }
    if (pts.length > 1) {
      ctx.save(); ctx.lineCap = "round"; ctx.strokeStyle = tokens.accent;
      for (let k = 0; k < pts.length - 1; k++) {
        const a = pts[k], b = k === pts.length - 2 ? { x: m.x, y: m.y } : pts[k + 1], w = (k + 1) / (pts.length - 1);
        ctx.globalAlpha = (past ? 0.45 : 1) * (0.12 + 0.5 * w); ctx.lineWidth = (1.2 + 1.4 * w) / scale;
        trailPath(ctx, a, b, "glide", scale); ctx.stroke();
      }
      ctx.restore();
    }
    // The marker: where the thread is (faint when you look back), and the agent where it is now, solid, on top.
    const nn = nowAt ? byId.get(nowAt) : undefined;
    if (past && tn) { ctx.save(); ctx.globalAlpha = 0.42; drawMarker(ctx, m.x, m.y, 9 / scale, tokens.accent, letter, 10, font, scale, { ...st, glow: false }); ctx.restore(); }
    if (nn) { const q = past ? platform(nn.x, nn.y, nn.r, scale) : { x: m.x, y: m.y }; drawMarker(ctx, q.x, q.y, 9 / scale, tokens.accent, letter, 10, font, scale, { ...st, glow: false }); }
    redraw.drew(p < 1 ? Motion.Smooth : Motion.None);
  };

  // One frame: the places in drawing order (the context saved before them, restored after each and at the end, as the
  // graph library painted them), then the names, the trail and the marker.
  frameRef.current = (ctx, k) => {
    ctx.save();
    for (const n of graphRef.current.nodes) { drawNode(n, ctx, k); ctx.restore(); }
    ctx.restore();
    endFrame(ctx, k);
  };

  // Pointing and clicking: the place under the pointer (placeUnder), worked out where the circles are now.
  const onSelectRef = useRef(onSelect); onSelectRef.current = onSelect;
  useEffect(() => {
    if (!canvas) return;
    canvas.style.cursor = "pointer";   // a place opens its step, the background closes it: everything is clickable
    const at = (e: PointerEvent) => { const g = fg.current; if (!g) return null; const p = g.toGraph(e.clientX, e.clientY); return placeUnder(graphRef.current, p.x, p.y, g.zoom()); };
    let down: { x: number; y: number } | null = null, moved = false;
    const onMove = (e: PointerEvent) => {
      if (down) { if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 1) moved = true; return; }
      const n = at(e);
      setHover(n ? n.id : null);
    };
    const onDown = (e: PointerEvent) => { if (e.button === 0) { down = { x: e.clientX, y: e.clientY }; moved = false; } };
    const onUp = (e: PointerEvent) => {
      const d = down; down = null;
      if (!d || e.button !== 0 || moved) return;   // a drag pans: no click
      const n = at(e);
      onSelectRef.current(n ? n.id : null);
    };
    const onLeave = () => { down = null; setHover(null); };
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointerleave", onLeave);
    return () => {
      canvas.removeEventListener("pointermove", onMove); canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp); canvas.removeEventListener("pointerleave", onLeave);
    };
  }, [canvas]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="cw-map" ref={wrapRef}>
      <div className="force-graph-container"><canvas ref={canvasRef} /></div>
    </div>
  );
}
