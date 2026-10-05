// Owner: D. Force graph of files/modules, glow by recency, a ripple per agent edit + outline while active, side panel + AskBox.
import { LensSwitch } from "./LensSwitch";
import { MapStats } from "./MapStats";
import "../tasks/track.css";
import { clock, isReplay } from "../lib/live";
import { lastSeen, sinceMs } from "../lib/visit";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const RIPPLE_MS = 700; // one ripple per edit
import ForceGraph2D, { type ForceGraphMethods, type NodeObject } from "react-force-graph-2d";
import type { AgentPresence, Edge, FileNode, ProjectMap } from "@contract";
import { useLive } from "../lib/live";
import { attentionText, needsYou } from "../lib/attention";
import { mapPrefs, useNav } from "../lib/nav";
import { mockAgents, mockMap } from "./mock";
import { drawAgents, visibleAgents, type AgentAnim } from "./agents";
import { MapSidebar } from "./sidebar/MapSidebar";
import { Dock, LockToggle, ReadsToggle } from "./replay/ReplayBar";
import { getCameraLock, useStepWindow } from "./prefs";
import { TalkCard } from "./replay/TalkCard";
import { StepPanel } from "./StepPanel";
import { FilePanel, useSelectedFile } from "./FilePanel";
import { useReplayLayer, type Look, type ReplayLayerApi } from "./replay/layer";
import { makeFileResolver } from "../lib/paths";
import { aggregateFolders, clearTextWidths, drawModuleLabels, drawQueuedLabels, LabelSpace, type Folders, type QueuedLabel } from "./labels";
import { boxOf, isFitKey, useCamera, type Camera, type View } from "./camera";
import { FitButton } from "./FitButton";
import { replayCamera } from "./replay/store";
import { useTheme } from "../lib/theme";
import {
  CUBE_STILL_PX, drawCube, drawPlate, drawStation, LAND_MS, landings, mapStyle, metroPath, metroSegment, moduleColor, reachOf,
  settleLandings, stampCube, stampPlate, stampStation, tripMs, type MapStyle, type RGB,
} from "./themes";
import { clearSprites, spriteFrame, type StampMemo } from "./sprites";
import { createRedraw, Motion } from "./redraw";
import { savePositions, useSavedPositions, type Positions } from "./positions";
import "./map.css";

type GNode = NodeObject & {
  id: string; file: FileNode; r: number; ax: number; ay: number;
  // Kept per file between frames (perf-canvas): its colour, its focus look this frame, its cube's turn.
  cAt?: string; cEp?: number; c?: RGB; css?: string;
  lf?: number; lk?: Look | null;
  sp?: number; bn?: string; stamp?: StampMemo;
};
type GLink = { source: GNode; target: GNode };

const MIN = 60_000;
const HOUR = 60 * MIN;
const TAU = Math.PI * 2;

// ---------- helpers ----------
function hex(c: string): [number, number, number] {
  const h = c.trim().replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((x) => x + x).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const mixRGB = (a: RGB, b: RGB, t: number): RGB => {
  const k = Math.max(0, Math.min(1, t));
  return a.map((v, i) => Math.round(v + (b[i] - v) * k)) as RGB;
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

/** A recording (the hosted demo) or a shared replay: fixed for the page's life, read once (it parses the URL). */
let replayed: boolean | undefined;
const recorded = () => (replayed ??= isReplay());

/**
 * A file's color: hot for a few minutes after an edit, warm if it changed since you last looked (see lib/visit.ts),
 * quiet otherwise. A recording (the hosted demo) has no "last visit": there, warm fades out over an hour as before.
 */
function recencyRGB(t: Tokens, iso: string | undefined, now: number): RGB {
  if (!iso) return t.cool;
  const at = Date.parse(iso), age = now - at;
  if (!(age >= 0)) return t.hot;
  // In 1/32 steps (a few seconds each): the same few colours for every file, so their drawings can be reused (sprites.ts).
  if (age < 5 * MIN) return mixRGB(t.hot, t.warm, steps((age / (5 * MIN)) ** 1.5));
  if (recorded()) return age < HOUR ? mixRGB(t.warm, t.cool, steps((age - 5 * MIN) / (HOUR - 5 * MIN))) : t.cool;
  return at > sinceMs ? t.warm : t.cool;
}
const steps = (k: number, n = 32) => Math.round(k * n) / n;
const css = (c: RGB) => `rgb(${c.join(",")})`;
const same = (a: RGB, b: RGB) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
/** A stable starting angle per file, so cubes don't all turn in step. */
const STILL = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const spin = (id: string) => { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return (h % 628) / 100; };

export function relTime(iso: string | undefined, now = clock()): string {
  if (!iso) return "not changed recently";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 45) return "changed just now";
  if (s < 3600) return `changed ${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `changed ${Math.round(s / 3600)} h ago`;
  return `changed ${Math.round(s / 86400)} days ago`;
}
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

// ---------- layout: room for every file ----------
const AIR = 8;          // clear space around each file's mark, past its reach (graph units): neighbours sit 2×AIR apart
const PACKED = 0.65;    // how much of a folder's disc its files fill once settled (the rest is air and link slack)
const GAP_IN = 18;      // between subfolders of one folder
const GAP_OUT = 36;     // between top-level folders: room for a folder name above each group
/** A big map: the layout settles in fewer, looser steps, and idle import lines step out when zoomed out. */
const BIG = 5000;
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
type Graph = {
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
function useGraph(map: ProjectMap | null, theme: string, saved: { pos: Positions; sameTheme: boolean } | null | undefined, structureVersion?: number) {
  const nodesRef = useRef(new Map<string, GNode>());
  const lastRef = useRef<{ root: string; files: FileNode[]; edges: Edge[]; theme: string; sv?: number; graph: Graph; discs: Map<string, number> } | null>(null);
  return useMemo(() => {
    if (!map || saved === undefined) return EMPTY;   // saved positions still loading (a moment at most)
    const last = lastRef.current;
    const sameRoot = last?.root === map.root;
    if (last && sameRoot && last.theme === theme && ((structureVersion !== undefined && structureVersion === last.sv) || (sameFiles(last.files, map.files) && sameEdges(last.edges, map.edges)))) {
      for (const f of map.files) { const n = nodesRef.current.get(f.path); if (n) { n.file = f; n.r = radius(f.lines); } }
      last.files = map.files; last.edges = map.edges; last.sv = structureVersion;
      return last.graph;
    }
    // Module anchors, sized by the room each folder's files take once none covers another: the subfolders of one folder
    // packed around the biggest (so "app/server" sits next to "app/web"), then the top-level folders packed the same way.
    const st = mapStyle(), room = new Map<string, number>();
    for (const f of map.files) room.set(f.module, (room.get(f.module) ?? 0) + (reachOf(radius(f.lines), false, st) + AIR) ** 2);
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
    let fresh = 0, restored = 0;
    const placeLater: GNode[] = [];
    const nodes = map.files.map((f) => {
      const an = anchors.get(f.module) ?? { x: 0, y: 0 };
      let n = prev.get(f.path);
      if (!n) {
        const at = restore?.pos.get(f.path);
        n = { id: f.path } as GNode;
        if (at) { n.x = at.x; n.y = at.y; restored++; }
        else { fresh++; placeLater.push(n); }
      }
      n.file = f; n.r = radius(f.lines); n.ax = an.x; n.ay = an.y;
      next.set(f.path, n);
      return n;
    });
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
        const jit = reachOf(n.r, false, st) + AIR;
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
    else heat = fresh / total > 0.3 ? 1 : fresh || prev.size !== next.size ? 0.1 : 0.05;
    const graph: Graph = { nodes, links, anchors, heat, data: { nodes, links: NO_LINKS }, id: ++graphIds };
    lastRef.current = { root: map.root, files: map.files, edges: map.edges, theme, sv: structureVersion, graph, discs };
    return graph;
  }, [map?.files, map?.edges, map?.root, theme, saved, structureVersion]);
}

// ---------- forces ----------
type HeatRef = { current: number };
type Force = ((alpha: number) => void) & { initialize?: (nodes: GNode[], ...rest: unknown[]) => void };
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
      dist[i] = inside ? reachOf(s.r) + reachOf(t.r) + 2 * AIR + 8 : 110;
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
      const a = nodes[i], r = reachOf(a.r, !!a.file.activeSessionId, st) + AIR;
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

// ---------- import links ----------
// Their colours (imports, used by) belong to the map theme: see themes.ts.
const HIDE_LINKS_FROM = 4000;   // a map with more import lines than this...
const HIDE_LINKS_BELOW = 0.4;   // ...hides the idle ones below this zoom (a grey haze over the files); the selected file's stay
const ARROW = 3.5, ARROW_AT = 0.92;
const METRO_ONE_BY_ONE = 2500;  // Metro lines on screen up to which each is its own stroke (crossings darken); beyond, batched
function linkRole(l: GLink, focus: string | null): "imports" | "usedBy" | null {
  if (!focus) return null;
  if (l.source.id === focus) return "imports";
  if (l.target.id === focus) return "usedBy";
  return null;
}
/** force-graph's arrowhead on a straight line, `ARROW_AT` of the way from the source's edge to the target's. */
function arrowHead(ctx: CanvasRenderingContext2D, s: GNode, t: GNode) {
  const sx = s.x ?? 0, sy = s.y ?? 0, dx = (t.x ?? 0) - sx, dy = (t.y ?? 0) - sy, len = Math.sqrt(dx * dx + dy * dy);
  if (!len) return;
  const at = (k: number) => ({ x: sx + dx * k || 0, y: sy + dy * k || 0 });
  const pos = s.r + ARROW + (len - s.r - t.r - ARROW) * ARROW_AT;
  const head = at(pos / len), tail = at((pos - ARROW) / len), vert = at((pos - ARROW * 0.8) / len);
  const ang = Math.atan2(head.y - tail.y, head.x - tail.x) - Math.PI / 2, hw = ARROW / 1.6 / 2;
  ctx.beginPath();
  ctx.moveTo(head.x, head.y);
  ctx.lineTo(tail.x + hw * Math.cos(ang), tail.y + hw * Math.sin(ang));
  ctx.lineTo(vert.x, vert.y);
  ctx.lineTo(tail.x - hw * Math.cos(ang), tail.y - hw * Math.sin(ang));
  ctx.fill();
}

// ---------- one frame ----------
const FILE_LABELS_MAX = 500;    // file names placed per frame at most (the most important first)
/** What a frame needs to know once, not per file: where the camera looks, the time, the theme, what moves. */
type Frame = {
  id: number; scale: number; x0: number; y0: number; x1: number; y1: number;
  now: number; t: number; st: MapStyle; sel: string | null; hover: string | null; coolCss: string;
  looks: boolean; anyLook: boolean; lookSum: number; motion: Motion; linksDone: boolean;
  labN: GNode[]; labP: number[];
};
type Dots = Map<string, { css: string; a: number; xyr: number[] }>;

// ---------- view ----------
export function MapView() {
  const { state } = useLive();
  const { focusFile, setFocusFile, hiddenAgents, replay, step, showReads } = useNav();
  const mock = useMemo(() => new URLSearchParams(location.search).has("mockmap"), []);
  const map = useMemo(() => (mock ? mockMap() : state.map), [mock, state.map]);
  const theme = useTheme();
  const saved = useSavedPositions(map?.root ?? null, theme);
  // perf/web-store's structure counter when the store has it (files or imports added, removed or moved), else content.
  const graph = useGraph(map, theme, saved, (state as unknown as { structureVersion?: number }).structureVersion);
  const graphRef = useRef(graph); graphRef.current = graph;
  const heat = useRef(graph.heat);
  const lastGraph = useRef(graph);
  if (lastGraph.current !== graph) { lastGraph.current = graph; heat.current = graph.heat; }
  const linksRef = useRef(graph.links); linksRef.current = graph.links;
  const big = graph.nodes.length > BIG;
  const [wrapRef, size] = useSize<HTMLDivElement>();
  const sizeRef = useRef(size); sizeRef.current = size;
  const fg = useRef<ForceGraphMethods<GNode, never> | undefined>(undefined);
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
  const [mockTick, setMockTick] = useState(0);
  useEffect(() => { if (!mock) return; const t = setInterval(() => setMockTick((x) => x + 1), 2600); return () => clearInterval(t); }, [mock]);
  // An agent waiting on you stays on the map however long it waits.
  const waitingIds = useMemo(() => new Set(Object.values(state.attention).filter(needsYou).map((a) => a.agentId ?? a.sessionId)), [state.attention]);
  const agents: AgentPresence[] = useMemo(() => {
    const all = mock && map ? mockAgents(map, mockTick) : Object.values(state.agents ?? {});
    const shown = new Set(visibleAgents(all));
    return all.filter((a) => shown.has(a) || waitingIds.has(a.id));
  }, [mock, map, mockTick, state.agents, waitingIds]);
  // Hidden agents (sidebar toggles) are not drawn. With a thread open: its own agents (main and subagents, each in its
  // colour) while it's followed live; none while you move through its past (the replay's cursor is the marker then).
  const threadId = replay?.sessionId ?? null, liveThread = !!replay?.live;
  const drawnAgents = useMemo(() => agents.filter((a) => !hiddenAgents.has(a.id) && (!threadId || (liveThread && a.sessionId === threadId))),
    [agents, hiddenAgents, threadId, liveThread]);
  // Agents waiting on you (attention): agent id → label. A subagent waits under its own id, a main thread under the session's.
  const waiting = useMemo(() => new Map(Object.values(state.attention).filter(needsYou).map((a) => [a.agentId ?? a.sessionId, attentionText(a).badge === "Stuck" ? "Stuck" : `Needs you · ${attentionText(a).title.toLowerCase()}`])), [state.attention]);
  const waitingRef = useRef(waiting); waitingRef.current = waiting;
  const agentsRef = useRef(drawnAgents); agentsRef.current = drawnAgents;
  const anim = useRef(new Map<string, AgentAnim>());
  const [followId, setFollowId] = useState<string | null>(null);
  // A thread replay takes over the camera: stop following a live agent when one starts.
  useEffect(() => { if (replay) setFollowId(null); }, [replay?.sessionId]);
  const followRef = useRef(followId); followRef.current = followId;
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

  // ---- camera intent: what the camera is framing, so it can frame it again when a panel opens or the window resizes ----
  // "fit": the whole project (or the open thread's footprint); "file": the open file; "free": the user's own view.
  type Intent = { kind: "fit" } | { kind: "file"; id: string; zoom: boolean } | { kind: "free" };
  const intent = useRef<Intent>({ kind: "fit" });
  const intentAt = useRef(0);
  const setIntent = useCallback((i: Intent) => { intent.current = i; intentAt.current = performance.now(); }, []);
  const framed = useRef(false);   // the camera has framed the map at least once
  /** Locked onto something that moves (the tracer, a followed agent): the follow owns the centre, so no automatic re-frame. */
  const lockedOn = useCallback(() => getCameraLock() && (replayRef.current.tracing || !!followRef.current), []);
  /** Frame the open thread's focus (its recent window, or all its files), or the whole project. */
  const fitAll = useCallback((ms = 800) => {
    const idx = nodeIndexRef.current;
    const fp = replayRef.current.footprint();
    const touched = fp?.map((id) => idx.get(id)).filter((n): n is GNode => !!n && n.x !== undefined) ?? [];
    const box = boxOf(touched.length ? touched : idx.values());
    if (!box) return;
    // Folder names sit above each group: leave them room at the top. A footprint of one or two files doesn't fill the screen.
    box.y0 -= 24;
    camRef.current.frame(box, { pad: 44, maxZoom: touched.length ? 2.4 : 4 }, ms);
    framed.current = true;
  }, []);
  /** Frame what the intent says, unless the user has moved the camera since. */
  const applyIntent = useCallback((ms = 600) => {
    const i = intent.current, c = camRef.current;
    if (i.kind === "free" || c.userAt() > intentAt.current) return;
    if (i.kind === "fit") { if (!lockedOn()) fitAll(ms); return; }
    const n = nodeIndexRef.current.get(i.id);
    if (!n || n.x === undefined || n.y === undefined) return;
    if (i.zoom) c.lookAt(n.x, n.y, 3, ms);
    else c.reveal(n.x, n.y, n.r + 14, ms);   // room for its name under it
    framed.current = true;
  }, [fitAll, lockedOn]);
  // Unlocked, the tracer left the view: frame the recent window again (applyIntent: unless you moved the camera since).
  useEffect(() => { replayCamera.lost = () => applyIntent(700); return () => { replayCamera.lost = null; }; }, [applyIntent]);
  // The safe area changed (a panel opened, the sidebar collapsed, the window resized): frame the same thing in it.
  useEffect(() => {
    const t = setTimeout(() => applyIntent(450), 60);
    return () => clearTimeout(t);
  }, [cam.version, applyIntent]);
  /** The fit button and F / 0: the open thread's recent window, or the whole project (and stop following an agent). */
  const fitNow = useCallback(() => {
    setFollowId(null);
    setIntent({ kind: "fit" });
    fitAll(700);
  }, [fitAll, setIntent]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (isFitKey(e)) { e.preventDefault(); fitNow(); } };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [fitNow]);

  // Follow an agent (from the sidebar), like the tracer: the camera frames it once; locked, it keeps it centred (easing,
  // every frame, no stacked tweens) at whatever zoom you pick; unlocked, it stays where you put it, and frames the agent
  // again when it leaves the view only if you haven't moved the camera since following began.
  useEffect(() => {
    if (!followId) return;
    setIntent({ kind: "free" });
    const t0 = performance.now();
    let raf = 0, framedAt = 0;
    const tick = () => {
      const st = anim.current.get(followId), c = camRef.current, now = performance.now();
      if (st) {
        if (!framedAt) { framedAt = now; c.lookAt(st.x, st.y, Math.max(2.2, c.view()?.k ?? 0), 700); }
        else if (getCameraLock()) { if (now - framedAt > 700) c.easeToward(st.x, st.y, 0.09); }
        else if (c.userAt() < t0 && now - framedAt > 1200 && !c.sees(st.x, st.y)) { framedAt = now; c.lookAt(st.x, st.y, undefined, 700); }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [followId, setIntent]);
  /** A file to zoom to once its panel is open (the panel's own effect below does the move). */
  const zoomTo = useRef<string | null>(null);
  const focusOnFile = useCallback((file: string) => {
    setFollowId(null);
    const id = resolveId(file);
    const n = id ? nodeIndexRef.current.get(id) : undefined;
    if (!n) return;
    zoomTo.current = n.id;
    if (selectedRef.current === n.id) { setIntent({ kind: "file", id: n.id, zoom: true }); applyIntent(800); }
    setSelected(n.id);
  }, [resolveId, setIntent, applyIntent]);

  // Forces: set once per canvas and again when the theme changes (a theme's files take more or less room). They don't
  // reheat the layout: a new graph does that itself (force-graph), at the graph's heat (useGraph).
  const hasNodes = graph.nodes.length > 0;
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

  // Frame the map once, after the first layout settles a bit (and again when it stops: see onEngineStop).
  useEffect(() => {
    if (!hasNodes) return;
    const t = setTimeout(() => applyIntent(900), 1600);
    return () => clearTimeout(t);
  }, [hasNodes, applyIntent]);

  // Opening a thread or starting its replay frames its recent window once, locked or not (and again as the layout settles,
  // unlocked and untouched: a link opened straight onto a thread loads the map at the same time). Closing the thread
  // frames the whole project again.
  const openThread = replayLayer.active ? replay?.sessionId : undefined;
  const playing = replay?.mode === "play";
  const hadThread = useRef(false);
  useEffect(() => {
    if (openThread) hadThread.current = true;
    else if (!hadThread.current) return;
    if (!openThread) hadThread.current = false;
    setIntent({ kind: "fit" });
    if (replayCamera.pinned) return; // a file's panel is open: the camera stays on the file
    fitAll(700);
    const ts = openThread ? [600, 1800].map((ms) => setTimeout(() => applyIntent(700), ms)) : [];
    return () => ts.forEach(clearTimeout);
  }, [openThread, playing, setIntent, applyIntent, fitAll]);

  // Focus from Follow (and file links)
  useEffect(() => {
    if (!focusFile) return;
    const n = nodeIndex.get(focusFile);
    if (!n) return;
    zoomTo.current = n.id;
    setSelected(n.id);
    setFocusFile(null);
    if (selectedRef.current === n.id) { setIntent({ kind: "file", id: n.id, zoom: true }); applyIntent(900); }
  }, [focusFile, nodeIndex, setFocusFile, setIntent, applyIntent]);

  // The file panel: opening it brings the file into the uncovered map (zoomed in when it came from a list or a link);
  // closing it puts the camera back where it was before (or frames the map, if it had never been framed).
  const panelFile = step ? null : selected;
  const before = useRef<{ view: View | null; intent: Intent } | null>(null);
  useEffect(() => () => { replayCamera.pinned = false; }, []);
  useEffect(() => {
    const c = camRef.current;
    replayCamera.pinned = !!panelFile; // the tracer's camera leaves the open file alone (it picks up again on close)
    if (panelFile) {
      if (!before.current) {
        const auto = c.userAt() <= intentAt.current ? intent.current : { kind: "free" as const };
        before.current = { view: framed.current ? c.view() : null, intent: auto.kind === "file" ? { kind: "fit" } : auto };
      }
      setIntent({ kind: "file", id: panelFile, zoom: zoomTo.current === panelFile });
      zoomTo.current = null;
      // A file with no position yet (a link that opened with the map): the intent frames it once the layout runs.
      const n = nodeIndexRef.current.get(panelFile);
      if (n?.x === undefined) { const t = setTimeout(() => applyIntent(900), 800); return () => clearTimeout(t); }
      applyIntent(800);
      return;
    }
    const b = before.current;
    before.current = null;
    if (!b) return;
    if (b.view && b.intent.kind !== "fit") { setIntent(b.intent); c.moveTo(b.view, 700); }
    else { setIntent({ kind: "fit" }); applyIntent(700); }
  }, [panelFile, setIntent, applyIntent]);

  // Import links show only around the selected file.
  const linkFocus = selected; // on click, not hover: moving the mouse across the map shouldn't flash lines everywhere
  const linkFocusRef = useRef(linkFocus); linkFocusRef.current = linkFocus;

  // One-shot ripples: start one when a file receives a new agent edit (not on first load).
  const ripples = useRef(new Map<string, number>());
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
        && f.activeSessionId && f.lastChangedAt !== prev.lastChangedAt) { ripples.current.set(f.path, performance.now()); started = true; }
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
  const focusColours = useRef(new Map<string, { rgb: RGB; css: string; ep: number }>());
  /** A file's own colour (when anyone last changed it), cached on the node. */
  const ownColour = (n: GNode, now: number) => {
    if (n.cAt !== n.file.lastChangedAt || n.cEp !== epoch.current || !n.c) {
      n.c = recencyRGB(tokensRef.current, n.file.lastChangedAt, now); n.css = css(n.c);
      n.cAt = n.file.lastChangedAt; n.cEp = epoch.current;
    }
    return n;
  };
  /** The focus's colour for a time the thread changed a file (or the quiet colour: undefined). */
  const focusColour = (edited: string | undefined, now: number) => {
    const k = edited ?? "", m = focusColours.current;
    let c = m.get(k);
    if (!c || c.ep !== epoch.current) {
      const rgb = recencyRGB(tokensRef.current, edited, now);
      c = { rgb, css: css(rgb), ep: epoch.current };
      if (m.size > 2000) m.clear();
      m.set(k, c);
    }
    return c;
  };

  // ---- the frame ----
  const frame = useRef<Frame>({ id: 0, scale: 1, x0: -Infinity, y0: -Infinity, x1: Infinity, y1: Infinity, now: 0, t: 0, st: style,
    sel: null, hover: null, coolCss: "", looks: true, anyLook: false, lookSum: 0, motion: Motion.None, linksDone: false, labN: [], labP: [] });
  const lastLookSum = useRef(0);
  const dots = useRef<Dots>(new Map());
  const ticks = useRef(0);
  /** The focus look of a file this frame (eased by the replay layer), asked once per file per frame. */
  const lookOf = (n: GNode, F: Frame): Look | null => {
    if (n.lf === F.id) return n.lk ?? null;
    n.lf = F.id;
    n.lk = F.looks ? replayRef.current.look(n.id) : null;
    return n.lk;
  };

  const startFrame = useCallback((_: CanvasRenderingContext2D, scale: number) => {
    const F = frame.current, g = fg.current, { w, h } = sizeRef.current;
    F.id++; F.scale = scale; F.now = clock(); F.t = performance.now(); F.st = mapStyle();
    F.sel = selectedRef.current; F.hover = hoverRef.current; F.coolCss = css(tokensRef.current.cool);
    spriteFrame();
    // Off-screen files aren't drawn: the part of the map the camera shows, in graph units.
    const a = g?.screen2GraphCoords(0, 0), b = g?.screen2GraphCoords(w, h);
    if (a && b) { F.x0 = Math.min(a.x, b.x); F.x1 = Math.max(a.x, b.x); F.y0 = Math.min(a.y, b.y); F.y1 = Math.max(a.y, b.y); }
    // The focus is asked about every file only while a thread is open, or its fade back hasn't finished.
    F.looks = replayRef.current.active || F.anyLook;
    F.anyLook = false; F.lookSum = 0; F.motion = Motion.None; F.linksDone = false;
    F.labN.length = 0; F.labP.length = 0;
    for (const d of dots.current.values()) d.xyr.length = 0;
    settleLandings(F.t);
  }, []);
  const moreMotion = (m: Motion) => { const F = frame.current; if (m === Motion.Smooth || F.motion === Motion.None) F.motion = m; };

  /** Import lines, under the files: idle ones batched in one path per colour (and per strength in Metro). */
  const linkBatches = useRef(new Map<string, { c: string; a: number; ls: GLink[] }>());
  const metroVisible = useRef<GLink[]>([]), metroAlpha = useRef<number[]>([]);
  const drawLinks = (ctx: CanvasRenderingContext2D, scale: number) => {
    const links = graphRef.current.links, F = frame.current, st = F.st;
    if (!links.length) return;
    const focus = linkFocusRef.current, tracing = replayRef.current.tracing;
    const hideIdle = links.length > HIDE_LINKS_FROM && scale < HIDE_LINKS_BELOW;
    const { x0, x1, y0, y1 } = F;
    const off = (s: GNode, t: GNode) => {
      const sx = s.x!, sy = s.y!, tx = t.x!, ty = t.y!;
      return (sx < x0 && tx < x0) || (sx > x1 && tx > x1) || (sy < y0 && ty < y0) || (sy > y1 && ty > y1);
    };
    const roles: GLink[] = [];
    if (st.link === "metro") {
      // Metro: imports as transit lines (horizontal, vertical and 45°), coloured by the importing file's folder.
      // While a thread plays, the import lines step back so the thread's own line reads over them.
      const base = focus ? 0.12 : tracing ? 0.18 : 0.55;
      const vis = metroVisible.current, va = metroAlpha.current;
      vis.length = 0; va.length = 0;
      for (const l of links) {
        const s = l.source, t = l.target;
        if (s.x === undefined || t.x === undefined || off(s, t)) continue;
        if (focus && (s.id === focus || t.id === focus)) { roles.push(l); continue; }
        if (hideIdle) continue;
        vis.push(l); va.push(base * Math.min(lookOf(s, F)?.alpha ?? 1, lookOf(t, F)?.alpha ?? 1));
      }
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.lineWidth = Math.max(1.6 / scale, 2.2);
      if (vis.length <= METRO_ONE_BY_ONE) {
        // As many lines as a project usually shows: one stroke each, so where two cross they darken as they always did.
        for (let i = 0; i < vis.length; i++) {
          const l = vis[i];
          ctx.globalAlpha = va[i]; ctx.strokeStyle = moduleColor(l.source.file.module);
          metroPath(ctx, l.source.x!, l.source.y!, l.target.x!, l.target.y!);
          ctx.stroke();
        }
      } else {
        // Thousands on screen: one stroke per folder colour and strength.
        const batches = linkBatches.current;
        for (const b of batches.values()) b.ls.length = 0;
        for (let i = 0; i < vis.length; i++) {
          const l = vis[i], a = Math.round(va[i] * 100) / 100, c = moduleColor(l.source.file.module), k = c + "|" + a;
          let b = batches.get(k);
          if (!b) { if (batches.size > 3000) batches.clear(); batches.set(k, (b = { c, a, ls: [] })); }
          b.ls.push(l);
        }
        for (const b of batches.values()) {
          if (!b.ls.length) continue;
          ctx.globalAlpha = b.a; ctx.strokeStyle = b.c;
          ctx.beginPath();
          for (const l of b.ls) metroSegment(ctx, l.source.x!, l.source.y!, l.target.x!, l.target.y!);
          ctx.stroke();
        }
      }
      ctx.lineWidth = Math.max(3 / scale, 3.2);
      for (const l of roles) {
        const s = l.source, t = l.target;
        ctx.globalAlpha = Math.min(lookOf(s, F)?.alpha ?? 1, lookOf(t, F)?.alpha ?? 1);
        ctx.strokeStyle = s.id === focus ? st.imports : st.usedBy;
        metroPath(ctx, s.x!, s.y!, t.x!, t.y!);
        ctx.stroke();
      }
      ctx.lineCap = "butt"; ctx.lineJoin = "miter";
    } else {
      ctx.globalAlpha = 1;
      if (!hideIdle) {
        ctx.beginPath();
        for (const l of links) {
          const s = l.source, t = l.target;
          if (s.x === undefined || t.x === undefined || off(s, t)) continue;
          if (focus && (s.id === focus || t.id === focus)) continue;
          ctx.moveTo(s.x, s.y!); ctx.lineTo(t.x, t.y!);
        }
        ctx.strokeStyle = focus || tracing ? st.linkDim : st.linkIdle;
        ctx.lineWidth = 0.6 / scale;
        ctx.stroke();
      }
      if (focus) for (const l of links) if (l.source.id === focus || l.target.id === focus) roles.push(l);
      for (const role of ["imports", "usedBy"] as const) {
        const ls = roles.filter((l) => linkRole(l, focus) === role && l.source.x !== undefined && l.target.x !== undefined);
        if (!ls.length) continue;
        ctx.strokeStyle = ctx.fillStyle = st[role];
        ctx.lineWidth = 1.6 / scale;
        ctx.beginPath();
        for (const l of ls) { ctx.moveTo(l.source.x!, l.source.y!); ctx.lineTo(l.target.x!, l.target.y!); }
        ctx.stroke();
        for (const l of ls) arrowHead(ctx, l.source, l.target);
      }
    }
  };

  const drawNode = useCallback((node: NodeObject, ctx: CanvasRenderingContext2D, scale: number) => {
    const F = frame.current;
    if (!F.linksDone) { F.linksDone = true; drawLinks(ctx, scale); }   // after the layout's tick, before the first file
    const n = node as GNode;
    const x = n.x, y = n.y, r = n.r;
    if (x === undefined || y === undefined) return;
    // Off screen (with room for a glow, a ripple and a name): nothing to draw.
    const m = 3.7 * r + 34 / scale;
    if (x + m < F.x0 || x - m > F.x1 || y + m < F.y0 || y - m > F.y1) return;
    const tokens = tokensRef.current, st = F.st, t = F.t;
    const active = !!n.file.activeSessionId;
    const isSel = n.id === F.sel, isHover = n.id === F.hover;
    const look = lookOf(n, F);   // an open thread: its own footprint, the rest dimmed back
    if (look) { F.anyLook = true; F.lookSum += look.alpha * 3 + look.tone; }
    const alpha = look?.alpha ?? 1;
    ctx.globalAlpha = alpha;
    const plain = st.node !== "dot"; // themed files stay plain: no ripple or outlines, one mark where an agent is

    // An edit lands: one ripple, once. While the file stays active: a steady outline, no motion.
    const rippleStart = ripples.current.get(n.id);
    let rippling = false;
    if (rippleStart !== undefined) {
      if (plain) ripples.current.delete(n.id);
      else {
        const k = (t - rippleStart) / RIPPLE_MS;
        if (k >= 1) ripples.current.delete(n.id);
        else {
          rippling = true; moreMotion(Motion.Smooth);
          const e = 1 - Math.pow(1 - k, 3); // ease-out
          ctx.beginPath();
          ctx.arc(x, y, r + (3 + e * 26) / scale, 0, TAU); // screen-constant size, readable at any zoom
          ctx.strokeStyle = tokens.accent;
          ctx.globalAlpha = (1 - k) * 0.75 * alpha;
          ctx.lineWidth = 2 / scale;
          ctx.stroke();
          ctx.globalAlpha = alpha;
        }
      }
    }
    if (active && !plain) {
      ctx.beginPath();
      ctx.arc(x, y, r + 3.5 / scale, 0, TAU);
      ctx.strokeStyle = tokens.accent;
      ctx.globalAlpha = 0.9 * alpha;
      ctx.lineWidth = 1.6 / scale;
      ctx.stroke();
      ctx.globalAlpha = alpha;
    }

    // In a focus, a file takes the focus's colour (when the thread changed it, or the quiet one), not the project's.
    const own = ownColour(n, F.now);
    let rgb = own.c!, rgbCss = own.css!;
    if (look && look.tone > 0) {
      const fc = focusColour(look.edited, F.now);
      if (look.tone >= 1) { rgb = fc.rgb; rgbCss = fc.css; }
      else { rgb = mixRGB(rgb, fc.rgb, steps(look.tone, 8)); rgbCss = css(rgb); }   // easing in 8 steps: few colours to draw
    }
    const lit = active || !same(rgb, tokens.cool);
    if (st.node === "cube") {
      // An agent lands: the cube spins up and flashes gold for a moment.
      const landed = landings.get(n.id), k = landed === undefined ? 1 : (t - landed) / LAND_MS;
      if (k >= 1 && landed !== undefined) landings.delete(n.id);
      const kick = k < 1 ? 1 - (1 - k) ** 3 : 0, flash = k < 1 ? 1 - k : 0; // a half turn: the cube looks the same after it, so it never snaps back
      const s = r * 0.78 * (active ? 1.3 : 1) * (1 + flash * 0.25);
      // A cube a few pixels wide stands still: its turn wouldn't show, and the map can rest.
      const still = STILL || (s * scale < CUBE_STILL_PX && !active && !flash);
      const angle = (still ? 0 : t / (active ? 700 : 2600) + kick * Math.PI) + (n.sp ??= spin(n.id));
      if (flash) moreMotion(Motion.Smooth); else if (!still) moreMotion(Motion.Slow);
      const c = flash ? mixRGB(rgb, tokens.warm, flash) : rgb;
      if (active || flash || !stampCube(ctx, x, y, s, angle, c, rgbCss, lit, scale, (n.stamp ??= {})))
        drawCube(ctx, x, y, s, angle, c, lit || flash > 0, scale, active ? tokens.accent : null);
    }
    else if (st.node === "plate") { if (active || !stampPlate(ctx, x, y, r * 0.9, rgb, rgbCss, lit, scale, (n.stamp ??= {}))) drawPlate(ctx, x, y, r * 0.9, rgb, lit, scale, active ? tokens.accent : null); }
    else if (st.node === "station") {
      const fill = same(rgb, tokens.cool) ? "#fff" : rgbCss, ring = F.coolCss;
      if (active || !stampStation(ctx, x, y, r, fill, ring, isSel, scale, (n.stamp ??= {}))) drawStation(ctx, x, y, r, fill, ring, active ? css(tokens.hot) : null, isSel, scale);
    }
    else if (isSel || isHover || active || rippling) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = rgbCss; ctx.fill(); }
    else {
      // A plain dot: batched with every dot of its colour and strength, filled once after the files (endFrame).
      const a = alpha === 1 ? 1 : Math.round(alpha * 64) / 64, key = a === 1 ? rgbCss : rgbCss + "|" + a;
      let d = dots.current.get(key);
      if (!d) { if (dots.current.size > 512) dots.current.clear(); dots.current.set(key, (d = { css: rgbCss, a, xyr: [] })); }
      d.xyr.push(x, y, r);
    }
    if (isSel || isHover || (active && !plain)) {
      ctx.beginPath();
      ctx.arc(x, y, st.node === "dot" ? r : r * 1.35 + 2 / scale, 0, TAU);
      ctx.lineWidth = (isSel ? 2.4 : 1.4) / scale;
      ctx.strokeStyle = active ? tokens.accent : tokens.ink;
      ctx.stroke();
    }

    // THE LABEL HOOK for the focus: the files in an open thread's recent window are named whatever their size (edits
    // first), every other file only when selected or pointed at; another thread's edit doesn't pull a dimmed file forward.
    const focusing = !!look && look.tone > 0.5, inFocus = focusing && !!look.named && look.alpha > 0.3;
    const forced = isSel || isHover || (active && !focusing);
    if (forced || inFocus || (alpha >= 1 && (r * scale > 9 || scale > 3.2))) {
      // Queued (the label is built in endFrame for the most important ones only), drawn after every file: a
      // neighbour's circle never covers a name. The one you point at wins, then the selected one, then where an
      // agent works, then the focus (its edits first), then the biggest.
      F.labN.push(n);
      F.labP.push((isHover ? 4e6 : 0) + (isSel ? 2e6 : 0) + (active && !focusing ? 1e6 : 0) + (inFocus ? (look!.edited ? 6e5 : 5e5) : 0) + r);
    }
  }, []);

  /** A queued file's label, built in full (only for the ones that may be drawn this frame). */
  const labelFor = (n: GNode, prio: number, F: Frame): QueuedLabel => {
    const st = F.st, tokens = tokensRef.current, scale = F.scale, r = n.r, x = n.x!, y = n.y!;
    const active = !!n.file.activeSessionId, isSel = n.id === F.sel, isHover = n.id === F.hover;
    const look = n.lf === F.id ? n.lk ?? null : null, alpha = look?.alpha ?? 1;
    const focusing = !!look && look.tone > 0.5, inFocus = focusing && !!look.named && look.alpha > 0.3;
    const forced = isSel || isHover || (active && !focusing);
    const fs = Math.max(11, Math.min(14, 11 + r * scale * 0.08)) / scale;
    // Clear of what the theme draws (a cube's corners, a plate's rim) and of the selection ring.
    const ringR = Math.max(reachOf(r, active, st), isSel || isHover ? (st.node === "dot" ? r : r * 1.35 + 2 / scale) : 0);
    return {
      text: (n.bn ??= baseName(n.id)), x, y: y + ringR + 3 / scale, size: fs, scale, alpha: isSel || isHover ? 1 : inFocus ? Math.max(alpha, 0.8) : alpha,
      at: { id: n.id, x, y, r: ringR }, must: isSel || isHover,
      weight: isSel || (active && !focusing) ? 600 : 500, family: st.labelFont ?? tokens.body,
      ink: isSel || (active && !focusing) || isHover || (inFocus && look!.edited) ? st.fileInk : st.fileInkQuiet, halo: st.halo,
      prio, forced,
    };
  };

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

  /** Whether the live agents are still moving: a glide, a fade, a read's line, a pulse, a red flash, a wait's breath. */
  const agentsMoving = (t: number) => {
    const now = clock(), route = mapStyle().route;
    for (const a of agentsRef.current) {
      const st = anim.current.get(a.id);
      if (!st) continue;   // not on the map (its file isn't a node)
      if (t - st.t0 < tripMs(route, 650) + 50 || st.flashes.length || t - st.pulseT0 < 700 || t - st.errT0 < 2600 || waitingRef.current.has(a.id)) return true;
      const target = a.active || waitingRef.current.has(a.id) ? 1 : Math.max(0, 0.35 * (1 - (now - Date.parse(a.ts) - 2 * MIN) / (8 * MIN)));
      if (Math.abs(target - st.alpha) > 0.01) return true;
    }
    return false;
  };

  const endFrame = useCallback((ctx: CanvasRenderingContext2D, scale: number) => {
    const F = frame.current;
    // The batched dots (drawNode), each colour in one fill: a circle, or a square as big when it's under a pixel.
    for (const d of dots.current.values()) {
      if (!d.xyr.length) continue;
      ctx.globalAlpha = d.a; ctx.fillStyle = d.css;
      ctx.beginPath();
      const p = d.xyr;
      for (let i = 0; i < p.length; i += 3) {
        const x = p[i], y = p[i + 1], r = p[i + 2];
        if (r * scale < 0.8) { const h = r * 0.886; ctx.rect(x - h, y - h, 2 * h, 2 * h); }
        else { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU); }
      }
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    drawModules(ctx, scale);
    drawAgentLayer(ctx, scale);
    ctx.globalAlpha = 1;
    // What still moves decides whether the next frame comes (redraw.ts).
    if (Math.abs(F.lookSum - lastLookSum.current) > 1e-6) moreMotion(Motion.Smooth);   // files easing into or out of a focus
    lastLookSum.current = F.lookSum;
    if (agentsMoving(F.t) || (replayRef.current.tracing && replayRef.current.active && playingRef.current)) moreMotion(Motion.Smooth);
    redraw.drew(F.motion);
  }, [drawModules, drawAgentLayer, redraw]);

  /** The hit canvas (what's under the pointer): off-screen files skipped, tiny ones as squares. */
  const paintHit = useCallback((node: NodeObject, color: string, ctx: CanvasRenderingContext2D, scale: number) => {
    const n = node as GNode, x = n.x, y = n.y;
    if (x === undefined || y === undefined) return;
    const F = frame.current, m = n.r + 3;
    if (x + m < F.x0 || x - m > F.x1 || y + m < F.y0 || y - m > F.y1) return;
    ctx.fillStyle = color;
    if (m * scale < 2) { ctx.fillRect(x - m, y - m, 2 * m, 2 * m); return; }
    ctx.beginPath(); ctx.arc(x, y, m, 0, TAU); ctx.fill();
  }, []);

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
  const onNodeDrag = useCallback(() => { heat.current = 1; }, []);   // a file dragged by hand: its neighbours answer in full

  const sel = selected ? nodeIndex.get(selected)?.file : undefined;
  // A layout run stops once its push is spent (d3AlphaMin, in force-graph's alpha): a gentle reheat stops sooner. A big
  // map also cools faster: fewer, bigger steps. A small map's full layout runs as it always did (cooldownTicks).
  const alphaMin = big ? 0.002 / graph.heat : graph.heat < 1 ? 0.001 / graph.heat : 0;

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
          nodePointerAreaPaint={paintHit}
          onRenderFramePre={startFrame}
          onRenderFramePost={endFrame}
          cooldownTicks={400}
          d3AlphaMin={alphaMin}
          d3AlphaDecay={big ? 0.05 : 0.0228}
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
