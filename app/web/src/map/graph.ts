// Owner: map-layout. The map's files, placed once by folder: every folder is a circle, its files and subfolders packed
// inside it (d3-hierarchy's circle packing, the same answer every time). Nothing is simulated, so nothing shakes: a
// position depends only on which files exist, not on what's open or what an agent does. Folders open and close as
// you zoom (fold.ts), which only changes what's drawn. When files come or go, the circles that move glide to their
// new places (TWEEN_MS).
import { useMemo, useRef } from "react";
import { hierarchy, pack, type HierarchyNode } from "d3-hierarchy";
import type { NodeObject } from "react-force-graph-2d";
import type { FileNode, ProjectMap } from "@contract";
import type { Island } from "../lib/islands";
import type { Look } from "./replay/layer";
import type { StampMemo } from "./sprites";
import { mapStyle, reachOf, type MapStyle, type RGB } from "./themes";

/** A folder on the map: its path from the root ("app/web/src"), the name it shows, and what's inside it. */
export type Dir = { rel: string; name: string; depth: number; files: FileNode[]; kids: GNode[];
  /** An island: files outside the project (lib/islands.ts), in the project at this path. */
  island?: string };
export type GNode = NodeObject & {
  id: string; file: FileNode; r: number;
  /** A folder's circle (its id is the folder's path ending in "/"); files have none. */
  dir?: Dir;
  /** The folder it sits in (none at the root). */
  up?: GNode;
  /** The room it was given (graph units): a file's mark never grows past it until the files change. */
  slot: number;
  // Per frame (fold.ts): how much it shows (0 hidden … 1), and for a folder how far open it is (0 a closed circle … 1).
  shown?: number; open?: number;
  /** How much its names show (0…1): they wait until the folder it's in has let go of its own name (fold.ts). */
  said?: number;
  // Kept per file between frames (perf-canvas): its colour, its focus look this frame, its cube's turn.
  cAt?: string; cEp?: number; c?: RGB; css?: string;
  lf?: number; lk?: Look | null;
  sp?: number; bn?: string; stamp?: StampMemo;
};
export type GLink = { source: GNode; target: GNode };

export const radius = (lines: number) => Math.min(22, 3.5 + Math.sqrt(Math.max(0, lines)) * 0.55);
/** How far a node reaches on the canvas: a file as its theme draws it, a folder's circle as it is. */
export const nodeReach = (n: GNode, st?: MapStyle) => (n.dir ? n.r : reachOf(n.r, !!n.file.activeSessionId, st));

const GAP = 4;          // clear space around a file's mark (graph units)
const PAD = 9;          // between a folder's edge and what it holds, and between its folders
const TWEEN_MS = 650;   // circles gliding to new places when files come or go
const SEA = 70;         // between the project and its islands, and between islands
/** A file's room: its size when the map was laid out, rounded up a little, so a few more lines don't move anything. */
const slotOf = (lines: number) => Math.ceil(radius(lines) * 1.15);

export type Graph = {
  /** Folders before what they hold (drawing order: a folder's circle under its files), at every level. */
  nodes: GNode[]; links: GLink[]; folders: GNode[];
  /** What force-graph gets: every node, placed (fx, fy), and no links (the map draws its own). */
  data: { nodes: GNode[]; links: never[] };
  /** Bumped per layout: what the label caches key on. */
  id: number;
};
let graphIds = 0;
const NO_LINKS: never[] = [];
const EMPTY: Graph = { nodes: [], links: [], folders: [], data: { nodes: [], links: NO_LINKS }, id: 0 };
const NO_ISLANDS: Island[] = [];

type T = { name: string; rel: string; file?: FileNode; children?: T[] };
/** The folder tree. A folder that only leads to one other folder ("web" → "src") is one circle: "web/src". */
function tree(map: ProjectMap): T {
  const base = map.root.replace(/\/+$/, ""), top: T = { name: "", rel: "", children: [] };
  const dirs = new Map<string, T>([["", top]]);
  const dirOf = (rel: string): T => {
    let d = dirs.get(rel);
    if (d) return d;
    const cut = rel.lastIndexOf("/"), up = dirOf(cut < 0 ? "" : rel.slice(0, cut));
    d = { name: rel.slice(cut + 1), rel, children: [] };
    up.children!.push(d); dirs.set(rel, d);
    return d;
  };
  for (const f of map.files) {
    const rel = f.path.startsWith(base + "/") ? f.path.slice(base.length + 1) : f.path, cut = rel.lastIndexOf("/");
    dirOf(cut < 0 ? "" : rel.slice(0, cut)).children!.push({ name: rel.slice(cut + 1), rel, file: f });
  }
  const squash = (d: T) => {
    for (const c of d.children ?? []) squash(c);
    if (d === top || !d.children) return;
    for (let c: T | undefined = d.children[0]; d.children.length === 1 && c?.children; c = d.children[0]) { d.name += "/" + c.name; d.rel = c.rel; d.children = c.children; }
  };
  squash(top);
  return top;
}

/** A folder's own FileNode: the path ("…/"), the module its files belong to, and their latest change and activity. */
function folderFile(base: string, d: Dir): FileNode {
  let lines = 0, last: string | undefined, active: string | undefined;
  for (const f of d.files) {
    lines += f.lines;
    if (f.lastChangedAt && (!last || f.lastChangedAt > last)) last = f.lastChangedAt;
    active ??= f.activeSessionId;
  }
  const segs = d.rel.split("/");
  return { path: base + "/" + d.rel + "/", module: segs.slice(0, 2).join("/"), lines, lastChangedAt: last, activeSessionId: active };
}

/**
 * The map laid out. Laid out again only when files come or go, or the theme changes (its marks take more or less
 * room); a file's lines or times changing (every edit) only updates it and its folders' colours in place.
 */
export function useGraph(map: ProjectMap | null, theme: string, structure?: number, islands: Island[] = NO_ISLANDS) {
  const last = useRef<{ key: string; graph: Graph; byId: Map<string, GNode> } | null>(null);
  const tween = useRef<Tween | null>(null);
  const graph = useMemo(() => {
    if (!map || !map.files.length) return EMPTY;
    const base = map.root.replace(/\/+$/, "");
    const isles = islands.map((i) => i.root + ":" + i.files.map((f) => f.path).join(",")).join("|");
    const key = `${base}|${theme}|${structure ?? ""}|${structure === undefined ? map.files.map((f) => f.path).join("\n") : ""}|${isles}`;
    const prev = last.current;
    if (prev && prev.key === key) { refresh(prev.graph, map, base, islands); return prev.graph; }

    const st = mapStyle();
    // Biggest first (by files held), so the big folders sit in the middle of their parent; ties by name, so the same
    // files always give the same map.
    const h = hierarchy<T>(tree(map))
      .sum((d) => (d.file ? 1 : 0))
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0) || (a.data.name < b.data.name ? -1 : 1));
    const leafR = (d: HierarchyNode<T>) => reachOf(slotOf(d.data.file!.lines), false, st) + GAP;
    const packed = pack<T>().radius((d) => leafR(d as HierarchyNode<T>)).padding((d) => (d.children ? PAD : 0))(h);

    const nodes: GNode[] = [], folders: GNode[] = [], byId = new Map<string, GNode>();
    const old = prev?.byId;
    const from: Tween["moves"] = [];
    const visit = (p: typeof packed, up: GNode | undefined) => {
      let n: GNode | undefined;
      if (p.depth > 0) {
        const f = p.data.file;
        const id = f ? f.path : base + "/" + p.data.rel + "/";
        const was = old?.get(id);
        n = (was ?? { id }) as GNode;
        n.up = up;
        if (f) { n.file = f; n.slot = slotOf(f.lines); n.r = Math.min(radius(f.lines), n.slot); n.dir = undefined; }
        else {
          n.dir = { rel: p.data.rel, name: p.data.name, depth: p.depth, files: [], kids: [] };
          n.r = p.r;
          n.slot = p.r;
          folders.push(n);
        }
        if (up) up.dir!.kids.push(n);
        if (was && was.x !== undefined && (was.x !== p.x || was.y !== p.y)) from.push([n, was.x, was.y!, p.x, p.y]);
        else { n.x = n.fx = p.x; n.y = n.fy = p.y; }
        nodes.push(n); byId.set(id, n);
      }
      for (const c of p.children ?? []) visit(c, n);
    };
    visit(packed, undefined);
    // The islands: each packed on its own, then set in a column off the project's right side, never moving the project.
    let y = 0;
    const placed = islands.map((isle) => {
      const t: T = { name: isle.name, rel: isle.root, children: isle.files.map((f) => ({ name: f.path.slice(f.path.lastIndexOf("/") + 1), rel: f.path, file: f })) };
      const p = pack<T>().radius((d) => leafR(d as HierarchyNode<T>)).padding((d) => (d.children ? PAD : 0))(
        hierarchy<T>({ name: "", rel: "", children: [t] }).sum((d) => (d.file ? 1 : 0)).sort((a, b) => (a.data.name < b.data.name ? -1 : 1)));
      const top = p.children![0], at = y + top.r;
      y += top.r * 2 + SEA;
      return { isle, p, top, at };
    });
    for (const { isle, p, top, at } of placed) {
      const dx = packed.x + packed.r + SEA + top.r - top.x, dy = packed.y - (y - SEA) / 2 + at - top.y;
      const place = (q: HierarchyNode<T> & { x: number; y: number; r: number }, up: GNode | undefined) => {
        const f = q.data.file, id = f ? f.path : isle.root + "/";
        const was = old?.get(id);
        const n = (was ?? { id }) as GNode;
        n.up = up;
        if (f) { n.file = f; n.slot = slotOf(f.lines); n.r = Math.min(radius(f.lines), n.slot); n.dir = undefined; }
        else { n.dir = { rel: isle.root, name: `${isle.name} · outside`, depth: 1, files: [], kids: [], island: isle.root }; n.r = q.r; n.slot = q.r; folders.push(n); }
        if (up) up.dir!.kids.push(n);
        const x = q.x + dx, yy = q.y + dy;
        if (was && was.x !== undefined && (was.x !== x || was.y !== yy)) from.push([n, was.x, was.y!, x, yy]);
        else { n.x = n.fx = x; n.y = n.fy = yy; }
        nodes.push(n); byId.set(id, n);
        for (const c of q.children ?? []) place(c as typeof q, n);
      };
      place(top as typeof top & { x: number; y: number; r: number }, undefined);
    }
    // Each folder's files, all levels down (deepest first, so a folder adds up its subfolders' lists).
    for (let i = folders.length - 1; i >= 0; i--) {
      const d = folders[i].dir!;
      for (const k of d.kids) if (k.dir) d.files.push(...k.dir.files); else d.files.push(k.file);
      folders[i].file = d.island ? { ...folderFile(base, d), path: d.island + "/", module: "outside" } : folderFile(base, d);
    }
    const links: GLink[] = [];
    for (const e of map.edges) { const s = byId.get(e.from), t = byId.get(e.to); if (s && t && s !== t) links.push({ source: s, target: t }); }
    tween.current = from.length ? { t0: performance.now(), moves: from } : null;
    const graph: Graph = { nodes, links, folders, data: { nodes, links: NO_LINKS }, id: ++graphIds };
    last.current = { key, graph, byId };
    return graph;
  }, [map, theme, structure, islands]);
  return { graph, tween };
}

/** The same files with new lines, times or activity: update the files and their folders' colours, nothing moves. */
function refresh(g: Graph, map: ProjectMap, base: string, islands: Island[]) {
  const byPath = new Map(map.files.map((f) => [f.path, f]));
  for (const i of islands) for (const f of i.files) byPath.set(f.path, f);
  for (const n of g.nodes) if (!n.dir) { const f = byPath.get(n.id); if (f && f !== n.file) { n.file = f; n.r = Math.min(radius(f.lines), n.slot); } }
  for (let i = g.folders.length - 1; i >= 0; i--) {
    const d = g.folders[i].dir!;
    d.files.length = 0;
    for (const k of d.kids) if (k.dir) d.files.push(...k.dir.files); else d.files.push(k.file);
    g.folders[i].file = d.island ? { ...folderFile(base, d), path: d.island + "/", module: "outside" } : folderFile(base, d);
  }
}

/** Circles gliding from where they were to where the new layout puts them. */
export type Tween = { t0: number; moves: [GNode, number, number, number, number][] };
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
/** Moves the gliding circles for this frame; true while some are still on their way. */
export function stepTween(tw: { current: Tween | null }, now: number) {
  const t = tw.current;
  if (!t) return false;
  const k = Math.min(1, (now - t.t0) / TWEEN_MS), e = ease(k);
  for (const [n, x0, y0, x1, y1] of t.moves) { n.x = n.fx = x0 + (x1 - x0) * e; n.y = n.fy = y0 + (y1 - y0) * e; }
  if (k >= 1) tw.current = null;
  return true;
}

/** The import lines between what shows: a line to a file inside a closed folder goes to the folder's circle. */
export function shownLinks(g: Graph, cache: { key: string; links: GLink[]; g: Graph | null }, sig: string): GLink[] {
  if (cache.g === g && cache.key === sig) return cache.links;
  const rep = (n: GNode): GNode => { let r = n; for (let u = n.up; u; u = u.up) if ((u.open ?? 1) < 0.5) r = u; return r; };
  const seen = new Set<string>(), out: GLink[] = [];
  for (const l of g.links) {
    const s = rep(l.source), t = rep(l.target);
    if (s === t) continue;
    const k = s.id + "\n" + t.id;
    if (!seen.has(k)) { seen.add(k); out.push(s === l.source && t === l.target ? l : { source: s, target: t }); }
  }
  cache.g = g; cache.key = sig; cache.links = out;
  return out;
}

/**
 * What's under a point (graph units) at this zoom: a file that shows (its folder open), nearest first, a tiny one
 * taking at least 6 px; else the smallest closed folder around the point; else nothing. Asked on every pointer move
 * and click, against where the circles are this frame (force-graph's own hit map is repainted at most every 0.8 s, so
 * a click just after the camera moved could land on empty map).
 */
export function hitAt(g: Graph, x: number, y: number, scale: number): GNode | null {
  let file: GNode | null = null, gap = Infinity, folder: GNode | null = null;
  const slack = 3 / scale, least = 6 / scale;
  for (const n of g.nodes) {
    if (n.x === undefined || n.y === undefined || (n.shown ?? 1) < 0.5) continue;
    const d = Math.hypot(x - n.x, y - n.y);
    // A closed folder, or an island (open or not: anywhere on it takes you to its project).
    if (n.dir) { if (((n.open ?? 0) < 0.5 || n.dir.island) && d <= n.r && (!folder || n.r < folder.r)) folder = n; continue; }
    if (d <= Math.max(n.r, least) + slack && d - n.r < gap) { file = n; gap = d - n.r; }
  }
  return file ?? folder;
}
