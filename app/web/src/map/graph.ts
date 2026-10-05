// Owner: D. The map's files as a force graph: the nodes (reused so positions survive live updates), the folders'
// anchors, and the forces that lay them out (moved out of MapView.tsx).
import { useEffect, useMemo, useRef, type RefObject } from "react";
import type { ForceGraphMethods, NodeObject } from "react-force-graph-2d";
import type { Edge, FileNode, ProjectMap } from "@contract";
import type { Look } from "./replay/layer";
import type { StampMemo } from "./sprites";
import type { Positions } from "./positions";
import { mapStyle, reachOf, type MapStyle, type RGB } from "./themes";
import type { Fold, FoldFile } from "./fold";

export type GNode = NodeObject & {
  id: string; file: FileNode; r: number; ax: number; ay: number;
  /** A folded folder's circle (fold.ts): what it holds. */
  fold?: Fold;
  // Kept per file between frames (perf-canvas): its colour, its focus look this frame, its cube's turn.
  cAt?: string; cEp?: number; c?: RGB; css?: string;
  lf?: number; lk?: Look | null;
  sp?: number; bn?: string; stamp?: StampMemo;
};
export type GLink = { source: GNode; target: GNode };

export const radius = (lines: number) => Math.min(22, 3.5 + Math.sqrt(Math.max(0, lines)) * 0.55);
/** The room a file takes in the layout: its reach in the theme plus air, squared (an area, give or take π). */
const roomOf = (f: FileNode, st: MapStyle) => (reachOf(radius(f.lines), false, st) + AIR) ** 2;
/** A folded folder's circle takes the room its files would: opening it doesn't push the rest of the map around. */
const foldRadius = (fold: Fold, st: MapStyle) => Math.max(6, Math.sqrt(fold.files.reduce((s, f) => s + roomOf(f, st), 0)) - AIR);
/** How far a circle reaches on the canvas: a file as its theme draws it, a folder's circle as it is. */
export const nodeReach = (n: GNode, st?: MapStyle) => (n.fold ? n.r : reachOf(n.r, !!n.file.activeSessionId, st));

// ---------- layout: room for every file ----------
export const AIR = 8;          // clear space around each file's mark, past its reach (graph units): neighbours sit 2×AIR apart
const PACKED = 0.65;    // how much of a folder's disc its files fill once settled (the rest is air and link slack)
const GAP_IN = 18;      // between subfolders of one folder
const GAP_OUT = 36;     // between top-level folders: room for a folder name above each group
/** A big map: the layout settles in fewer, looser steps, and idle import lines step out when zoomed out. */
export const BIG = 5000;
type Disc = { x: number; y: number; r: number };
/**
 * Greedy packing, in the order given (biggest first): each shape (a folder's discs) takes the first spot on a spiral out
 * from the middle where none of its discs comes within `gap` of one placed before. Shapes, not their bounding circles,
 * so small folders tuck into the bays around "app/web" + "app/server" instead of ringing them at a distance.
 * Cheap enough for hundreds of folders (a grid of placed discs; each search starts two turns inside the last spot found).
 */
function pack(shapes: Disc[][], gap: number) {
  const rs = shapes.flat().map((a) => a.r).sort((a, b) => a - b), cell = 2 * (rs[rs.length >> 1] ?? 1) + gap;
  const grid = new Map<number, Disc[]>(), at: { x: number; y: number }[] = [];
  const cells = (x: number, y: number, r: number, f: (k: number) => boolean | void) => {
    const e = r + gap / 2;
    for (let i = Math.floor((x - e) / cell); i <= Math.floor((x + e) / cell); i++) for (let j = Math.floor((y - e) / cell); j <= Math.floor((y + e) / cell); j++) if (f(i * 65536 + j)) return true;
    return false;
  };
  const near = (x: number, y: number, r: number) => cells(x, y, r, (k) => grid.get(k)?.some((b) => Math.hypot(x - b.x, y - b.y) < r + b.r + gap));
  let from = 0;
  for (const s of shapes) {
    const step = Math.max(6, Math.min(...s.map((a) => a.r)) * 0.75);   // about one disc's width along the spiral
    for (let t = Math.max(0, from - 4 * Math.PI); ; t += Math.min(0.5, step / Math.max(t * 6, 8))) {
      const d = t * 6, ox = Math.cos(t) * d * 1.25, oy = Math.sin(t) * d;   // a little wider than tall, like the screen
      if (s.some((a) => near(a.x + ox, a.y + oy, a.r))) continue;
      at.push({ x: ox, y: oy }); from = t;
      for (const a of s) { const b = { x: a.x + ox, y: a.y + oy, r: a.r }; cells(b.x, b.y, b.r, (k) => { const l = grid.get(k); if (l) l.push(b); else grid.set(k, [b]); }); }
      break;
    }
  }
  return at;
}

// ---------- graph data (node objects are reused so positions survive live updates) ----------
type Pt = { x: number; y: number };
export type Graph = {
  nodes: GNode[]; links: GLink[]; anchors: Map<string, Pt>;
  /** How hard this layout run pushes: 1 a full layout, less to settle a few new files (or restored ones) in place. */
  heat: number;
  /** What force-graph gets: the files only. Import lines are drawn by the map and pulled by its own link force. */
  data: { nodes: GNode[]; links: never[] };
  /** Bumped per rebuild: what the label caches key on. */
  id: number;
};
let graphIds = 0;
const NO_LINKS: never[] = [];
const EMPTY: Graph = { nodes: [], links: [], anchors: new Map(), heat: 1, data: { nodes: [], links: NO_LINKS }, id: 0 };

/** Same files in the same folders (a "map" message that resends the project, a file's lines or times changing). */
function sameFiles(a: FileNode[], b: FileNode[]) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) { const x = a[i], y = b[i]; if (x !== y && (x.path !== y.path || x.module !== y.module)) return false; }
  return true;
}
function sameEdges(a: Edge[], b: Edge[]) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) { const x = a[i], y = b[i]; if (x !== y && (x.from !== y.from || x.to !== y.to)) return false; }
  return true;
}

/**
 * The map's files as graph nodes. Nothing is rebuilt (and the layout isn't disturbed) while the files, their folders and
 * the imports stay the same, compared by content: a resent project or a changed file updates the nodes in place.
 * When files come or go, the folders keep their places if they barely changed size, and a new file starts by an import
 * of it or among its folder's files: the layout only needs a gentle push. On first load, the positions saved last time
 * (positions.ts) put every file back where it was.
 */
export function useGraph(map: ProjectMap | null, theme: string, saved: { pos: Positions; sameTheme: boolean } | null | undefined, structureVersion?: number | string) {
  const nodesRef = useRef(new Map<string, GNode>());
  const lastRef = useRef<{ root: string; files: FileNode[]; edges: Edge[]; theme: string; sv?: number | string; graph: Graph; discs: Map<string, number> } | null>(null);
  return useMemo(() => {
    if (!map || saved === undefined) return EMPTY;   // saved positions still loading (a moment at most)
    const last = lastRef.current;
    const sameRoot = last?.root === map.root;
    const st = mapStyle();
    const shape = (n: GNode, f: FoldFile) => { n.file = f; n.fold = f.fold; n.r = f.fold ? foldRadius(f.fold, st) : radius(f.lines); };
    if (last && sameRoot && last.theme === theme && ((structureVersion !== undefined && structureVersion === last.sv) || (sameFiles(last.files, map.files) && sameEdges(last.edges, map.edges)))) {
      for (const f of map.files) { const n = nodesRef.current.get(f.path); if (n) shape(n, f); }
      last.files = map.files; last.edges = map.edges; last.sv = structureVersion;
      return last.graph;
    }
    // Module anchors, sized by the room each folder's files take once none covers another: the subfolders of one folder
    // packed around the biggest (so "app/server" sits next to "app/web"), then the top-level folders packed the same way.
    const room = new Map<string, number>();
    for (const f of map.files as FoldFile[]) room.set(f.module, (room.get(f.module) ?? 0) + (f.fold ? f.fold.files.reduce((s, c) => s + roomOf(c, st), 0) : roomOf(f, st)));
    const disc = (m: string) => Math.sqrt((room.get(m) ?? 0) / PACKED);
    const discs = new Map([...room.keys()].map((m) => [m, disc(m)]));
    // Same folders, each within 15% of its size: they keep their places (a repack would move every folder for one file).
    const keep = last && sameRoot && last.theme === theme && last.discs.size === discs.size
      && [...discs].every(([m, d]) => { const o = last.discs.get(m); return o !== undefined && d <= o * 1.15 && d >= o / 1.15; });
    let anchors: Map<string, Pt>;
    if (keep) anchors = last!.graph.anchors;
    else {
      const top = new Map<string, string[]>();
      for (const m of room.keys()) { const p = m === "." ? "." : m.split("/")[0]; top.set(p, [...(top.get(p) ?? []), m]); }
      const groups = [...top.values()].map((ms) => {
        ms.sort((a, b) => disc(b) - disc(a));
        const at = pack(ms.map((m) => [{ x: 0, y: 0, r: disc(m) }]), GAP_IN);
        return { ms, at, size: ms.reduce((s, m) => s + (room.get(m) ?? 0), 0) };
      }).sort((a, b) => b.size - a.size);
      anchors = new Map();
      const spots = pack(groups.map((g) => g.ms.map((m, j) => ({ ...g.at[j], r: disc(m) }))), GAP_OUT);
      groups.forEach((g, i) => g.ms.forEach((m, j) => anchors.set(m, { x: spots[i].x + g.at[j].x, y: spots[i].y + g.at[j].y })));
    }
    const prev = sameRoot ? nodesRef.current : new Map<string, GNode>();
    const next = new Map<string, GNode>();
    const restore = prev.size === 0 && saved ? saved : null;
    let fresh = 0, restored = 0, unfolded = 0;
    const placeLater: GNode[] = [];
    const nodes = (map.files as FoldFile[]).map((f) => {
      const an = anchors.get(f.module) ?? { x: 0, y: 0 };
      let n = prev.get(f.path);
      if (!n) {
        const at = restore?.pos.get(f.path);
        n = { id: f.path } as GNode;
        if (at) { n.x = at.x; n.y = at.y; restored++; }
        else { fresh++; placeLater.push(n); }
      }
      shape(n, f); n.ax = an.x; n.ay = an.y;
      next.set(f.path, n);
      return n;
    });
    // A folder opened or folded (fold.ts): its files burst out of its circle, or its circle forms where its files were.
    if (placeLater.length && prev.size) {
      const born = (n: GNode) => {
        if (n.fold) {
          let x = 0, y = 0, k = 0;
          for (const [id, o] of prev) if (id.startsWith(n.id) && o.x !== undefined && o.y !== undefined) { x += o.x; y += o.y; k++; }
          if (k) { n.x = x / k; n.y = y / k; }
          if (k) return true;
        }
        for (let cut = n.id.lastIndexOf("/", n.id.length - 2); cut > 0; cut = n.id.lastIndexOf("/", cut - 1)) {
          const o = prev.get(n.id.slice(0, cut + 1));
          if (o?.fold && o.x !== undefined && o.y !== undefined) {
            const a = Math.random() * 2 * Math.PI, d = Math.sqrt(Math.random()) * Math.max(0, o.r - n.r);
            n.x = o.x + Math.cos(a) * d; n.y = o.y + Math.sin(a) * d;
            return true;
          }
        }
        return false;
      };
      for (let i = placeLater.length - 1; i >= 0; i--) if (born(placeLater[i])) { placeLater.splice(i, 1); unfolded++; }
    }
    // New files: by a file they import or that imports them (in their own folder first), else among their folder's
    // files, else at the folder's anchor. Random only within their own room.
    if (placeLater.length) {
      const near = new Map<string, string[]>();
      if (next.size > placeLater.length) for (const e of map.edges) {
        (near.get(e.from) ?? near.set(e.from, []).get(e.from)!).push(e.to);
        (near.get(e.to) ?? near.set(e.to, []).get(e.to)!).push(e.from);
      }
      const centre = new Map<string, { x: number; y: number; n: number }>();
      for (const n of next.values()) if (n.x !== undefined && n.y !== undefined) {
        const c = centre.get(n.file.module) ?? { x: 0, y: 0, n: 0 };
        c.x += n.x; c.y += n.y; c.n++; centre.set(n.file.module, c);
      }
      for (const n of placeLater) {
        const jit = nodeReach(n, st) + AIR;
        const nb = (near.get(n.id) ?? []).map((id) => next.get(id)).filter((o): o is GNode => !!o && o.x !== undefined)
          .sort((a, b) => Number(b.file.module === n.file.module) - Number(a.file.module === n.file.module))[0];
        const c = centre.get(n.file.module);
        const at = nb ? { x: nb.x!, y: nb.y! } : c ? { x: c.x / c.n, y: c.y / c.n } : null;
        if (at) { n.x = at.x + (Math.random() - 0.5) * 2 * jit; n.y = at.y + (Math.random() - 0.5) * 2 * jit; }
        else { n.x = n.ax + (Math.random() - 0.5) * 40; n.y = n.ay + (Math.random() - 0.5) * 40; }
      }
    }
    nodesRef.current = next;
    const links: GLink[] = [];
    for (const e of map.edges) { const s = next.get(e.from), t = next.get(e.to); if (s && t && s !== t) links.push({ source: s, target: t }); }
    // How hard to push: a full layout for a new map (or a theme's new room), gently when a few files come or go,
    // barely when the saved positions came back.
    const total = nodes.length || 1;
    let heat = 1;
    if (!last || !sameRoot || prev.size === 0) heat = restore ? (restored / total >= 0.95 && restore.sameTheme ? 0.02 : restored / total >= 0.5 ? 0.1 : 1) : 1;
    else if (last.theme !== theme) heat = 1;
    else if (unfolded && unfolded === fresh) heat = 0.15;   // a folder opened or folded: its files settle in its room
    else heat = fresh / total > 0.3 ? 1 : fresh || prev.size !== next.size ? 0.1 : 0.05;
    const graph: Graph = { nodes, links, anchors, heat, data: { nodes, links: NO_LINKS }, id: ++graphIds };
    lastRef.current = { root: map.root, files: map.files, edges: map.edges, theme, sv: structureVersion, graph, discs };
    return graph;
  }, [map?.files, map?.edges, map?.root, theme, saved, structureVersion]);
}

// ---------- forces ----------
export type HeatRef = { current: number };
export type Force = ((alpha: number) => void) & { initialize?: (nodes: GNode[], ...rest: unknown[]) => void };
/** A d3 force run at `heat` times the simulation's strength (alpha): a gentle reheat without touching force-graph's alpha. */
function heated(inner: Force, heat: HeatRef): Force & { inner: Force } {
  const f = ((alpha: number) => inner(alpha * heat.current)) as Force & { inner: Force };
  f.initialize = (nodes, ...rest) => inner.initialize?.(nodes, ...rest);
  f.inner = inner;
  return f;
}

/**
 * Import lines pull their two files together (d3's forceLink, one iteration): a file and its imports in one folder sit
 * close, across folders the pull is weak. The map's own link force, so force-graph needn't hold (or scan) the lines.
 */
function linkForce(links: { current: GLink[] }, heat: HeatRef) {
  let ls: GLink[] = [], dist = new Float64Array(0), str = dist, bias = dist;
  const f = ((alpha: number) => {
    const a = alpha * heat.current;
    for (let i = 0; i < ls.length; i++) {
      const s = ls[i].source, t = ls[i].target;
      let x = (t.x ?? 0) + (t.vx ?? 0) - (s.x ?? 0) - (s.vx ?? 0) || (Math.random() - 0.5) * 1e-6;
      let y = (t.y ?? 0) + (t.vy ?? 0) - (s.y ?? 0) - (s.vy ?? 0) || (Math.random() - 0.5) * 1e-6;
      let l = Math.sqrt(x * x + y * y);
      l = ((l - dist[i]) / l) * a * str[i];
      x *= l; y *= l;
      const b = bias[i];
      t.vx = (t.vx ?? 0) - x * b; t.vy = (t.vy ?? 0) - y * b;
      s.vx = (s.vx ?? 0) + x * (1 - b); s.vy = (s.vy ?? 0) + y * (1 - b);
    }
  }) as Force & { id: () => unknown; links: () => unknown };
  f.initialize = (nodes) => {
    const ids = new Set(nodes);
    ls = links.current.filter((l) => ids.has(l.source) && ids.has(l.target));
    const count = new Map<GNode, number>();
    for (const l of ls) { count.set(l.source, (count.get(l.source) ?? 0) + 1); count.set(l.target, (count.get(l.target) ?? 0) + 1); }
    dist = new Float64Array(ls.length); str = new Float64Array(ls.length); bias = new Float64Array(ls.length);
    ls.forEach((l, i) => {
      const s = l.source, t = l.target, inside = s.file?.module === t.file?.module;
      dist[i] = inside ? nodeReach(s) + nodeReach(t) + 2 * AIR + 8 : 110;
      str[i] = inside ? 0.2 : 0.03;
      const cs = count.get(s) ?? 1, ct = count.get(t) ?? 1;
      bias[i] = cs / (cs + ct);
    });
  };
  // force-graph hands its own (empty) link list to the force named "link": ours keeps the map's.
  f.id = () => f; f.links = () => f;
  return f;
}

/**
 * Files never cover each other: each keeps a disc as wide as its theme draws it (themes.ts reachOf) plus AIR, like
 * d3's forceCollide but with radii read on every tick (an agent arriving makes a PS2 cube bigger). A grid finds the
 * neighbours (numeric cells and linked lists in typed arrays: nothing allocated per tick).
 */
function collideForce(strength = 0.8) {
  let nodes: GNode[] = [];
  let rs = new Float64Array(0), px = rs, py = rs, next = new Int32Array(0);
  const head = new Map<number, number>();
  const f = () => {
    const n = nodes.length;
    if (rs.length < n) { rs = new Float64Array(n); px = new Float64Array(n); py = new Float64Array(n); next = new Int32Array(n); }
    const st = mapStyle();
    let max = 1;
    for (let i = 0; i < n; i++) {
      const a = nodes[i], r = nodeReach(a, st) + AIR;
      rs[i] = r; if (r > max) max = r;
      px[i] = (a.x ?? 0) + (a.vx ?? 0); py[i] = (a.y ?? 0) + (a.vy ?? 0);
    }
    const cell = 2 * max;
    head.clear();
    for (let i = 0; i < n; i++) {
      const k = Math.floor(px[i] / cell) * 65536 + Math.floor(py[i] / cell), h = head.get(k);
      next[i] = h === undefined ? -1 : h; head.set(k, i);
    }
    for (let i = 0; i < n; i++) {
      const a = nodes[i], cx = Math.floor(px[i] / cell), cy = Math.floor(py[i] / cell);
      for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gy = cy - 1; gy <= cy + 1; gy++) {
        for (let j = head.get(gx * 65536 + gy) ?? -1; j !== -1; j = next[j]) {
          if (j <= i) continue;
          const b = nodes[j], r = rs[i] + rs[j];
          let dx = px[i] - px[j], dy = py[i] - py[j], d2 = dx * dx + dy * dy;
          if (d2 >= r * r) continue;
          if (d2 === 0) { dx = (Math.random() - 0.5) * 1e-3; dy = (Math.random() - 0.5) * 1e-3; d2 = dx * dx + dy * dy; }
          const d = Math.sqrt(d2), l = ((r - d) / d) * strength, ri = rs[i] ** 2, rj = rs[j] ** 2, w = rj / (ri + rj);
          a.vx = (a.vx ?? 0) + dx * l * w; a.vy = (a.vy ?? 0) + dy * l * w;          // the smaller file moves more
          b.vx = (b.vx ?? 0) - dx * l * (1 - w); b.vy = (b.vy ?? 0) - dy * l * (1 - w);
        }
      }
    }
  };
  f.initialize = (ns: GNode[]) => { nodes = ns; };
  return f;
}

/** Weak pull of each file toward its module's anchor. */
function moduleForce(strength: number, heat: HeatRef) {
  let nodes: GNode[] = [];
  const f = (alpha: number) => {
    const k = strength * alpha * heat.current;
    for (const n of nodes) {
      n.vx = (n.vx ?? 0) + (n.ax - (n.x ?? 0)) * k;
      n.vy = (n.vy ?? 0) + (n.ay - (n.y ?? 0)) * k;
    }
  };
  f.initialize = (ns: GNode[]) => { nodes = ns; };
  return f;
}

/**
 * The layout's forces on force-graph's simulation. Returns the heat ref (the current run's push: each new graph brings
 * its own, a dragged file sets it back to full) and whether the map is big.
 */
export function useForces(fg: RefObject<ForceGraphMethods<GNode, never> | undefined>, graph: Graph, theme: string) {
  const heat = useRef(graph.heat);
  const lastGraph = useRef(graph);
  if (lastGraph.current !== graph) { lastGraph.current = graph; heat.current = graph.heat; }
  const linksRef = useRef(graph.links); linksRef.current = graph.links;
  const big = graph.nodes.length > BIG;
  const hasNodes = graph.nodes.length > 0;
  // Set once per canvas and again when the theme changes (a theme's files take more or less room). They don't
  // reheat the layout: a new graph does that itself (force-graph), at the graph's heat (useGraph).
  useEffect(() => {
    const g = fg.current;
    if (!g) return;
    // The folders' anchors are packed with room for their files (useGraph), so the pull can hold each folder together while
    // the collision keeps its files apart; the charge only spaces near neighbours (capped), it no longer has to keep files
    // off each other, which used to blow the whole map apart while big files in one folder still overlapped.
    g.d3Force("module", moduleForce(0.12, heat) as never);
    g.d3Force("collide", collideForce(0.8) as never);
    g.d3Force("link", linkForce(linksRef, heat) as never);
    const charge = g.d3Force("charge") as (Force & { inner?: Force }) | undefined;
    const inner = (charge?.inner ?? charge) as unknown as { strength?: (f: (n: GNode) => number) => { distanceMax?: (d: number) => { theta?: (t: number) => unknown } } } | undefined;
    // A big map: a looser approximation of the far files' push (Barnes-Hut theta) is plenty with the collision doing the spacing.
    inner?.strength?.((n: GNode) => -20 - n.r * 2)?.distanceMax?.(140)?.theta?.(big ? 1.3 : 0.9);
    if (charge && !charge.inner) g.d3Force("charge", heated(charge, heat) as never);
    (g.d3Force("center") as unknown as { strength?: (k: number) => unknown } | undefined)?.strength?.(0.02);
  }, [hasNodes, theme, big]);

  return { heat, big };
}
