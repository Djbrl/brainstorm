// Owner: D. Drawing one frame of the map's files and import lines (moved out of MapView.tsx): plain functions of the
// frame (Frame: what's asked once per frame) and of caches that live as long as the map. MapView calls them from
// force-graph's frame callbacks.
import type { Look } from "./replay/layer";
import { drawName, textWidth, type LabelSpace, type QueuedLabel } from "./labels";
import { Motion } from "./redraw";
import {
  CUBE_STILL_PX, drawCube, drawPlate, drawStation, LAND_MS, landings, metroPoints, polyPath, reachOf, upTo, type Pt2,
  stampCube, stampPlate, stampStation, type MapStyle, type RGB,
} from "./themes";
import { css, mixRGB, recencyRGB, same, steps, type Tokens } from "./color";
import type { GLink, GNode } from "./graph";

export const RIPPLE_MS = 700; // one ripple per edit
const TAU = Math.PI * 2;

/** A stable starting angle per file, so cubes don't all turn in step. */
const STILL = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const spin = (id: string) => { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return (h % 628) / 100; };
const baseName = (p: string) => p.split("/").pop() || p;

// ---------- import links ----------
// Their colours (imports, used by) belong to the map theme: see themes.ts.
// Only the hovered or selected file's lines are drawn, in every theme (Metro draws them as transit lines).
const ARROW = 3.5, ARROW_AT = 0.92;
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
export const FILE_LABELS_MAX = 500;    // file names placed per frame at most (the most important first)
/** What a frame needs to know once, not per file: where the camera looks, the time, the theme, what moves. */
export type Frame = {
  id: number; scale: number; x0: number; y0: number; x1: number; y1: number;
  now: number; t: number; st: MapStyle; sel: string | null; hover: string | null; coolCss: string;
  looks: boolean; anyLook: boolean; lookSum: number; motion: Motion;
  labN: GNode[]; labP: number[];
  /** The theme's colours, the colour epoch (bumped every few seconds: recency fades), and what recencyRGB needs. */
  tokens: Tokens; epoch: number; recorded: boolean; since: number;
  /** The replay layer's look for a file; the hovered or selected file (its import lines show); a thread is being traced. */
  look: (id: string) => Look | null; linkFocus: string | null; tracing: boolean;
  /** The Git view's filter (gitFilter.ts): the files it shows, each with its ring colour, and the folders they're in; null: off. */
  only: Map<string, string> | null; onlyDirs: Map<string, string> | null;
};
export type Dots = Map<string, { css: string; a: number; xyr: number[] }>;
/** What lives as long as the map: ripples under way, the batches and buffers reused from frame to frame. */
export type Caches = {
  ripples: Map<string, number>; dots: Dots;
  focusColours: Map<string, { rgb: RGB; css: string; ep: number }>;
  /** The focused file's lines (drawFocusLinks): which file and since when, and the one before, fading out. */
  /** How far each file's lines are drawn (drawFocusLinks): the focused one's, and any still drawing back. */
  lines: Map<string, LineLevel>;
};
export const newCaches = (): Caches => ({ ripples: new Map(), dots: new Map(), focusColours: new Map(),
  lines: new Map() });

export const moreMotion = (F: Frame, m: Motion) => { if (m === Motion.Smooth || F.motion === Motion.None) F.motion = m; };

/** The focus look of a file this frame (eased by the replay layer), asked once per file per frame. */
export const lookOf = (n: GNode, F: Frame): Look | null => {
  if (n.lf === F.id) return n.lk ?? null;
  n.lf = F.id;
  n.lk = F.looks ? F.look(n.id) : null;
  return n.lk;
};

/** A file's own colour (when anyone last changed it), cached on the node. */
const ownColour = (n: GNode, F: Frame) => {
  if (n.cAt !== n.file.lastChangedAt || n.cEp !== F.epoch || !n.c) {
    n.c = recencyRGB(F.tokens, n.file.lastChangedAt, F.now, F.recorded, F.since); n.css = css(n.c);
    n.cAt = n.file.lastChangedAt; n.cEp = F.epoch;
  }
  return n;
};
/** The focus's colour for a time the thread changed a file (or the quiet colour: undefined). */
const focusColour = (edited: string | undefined, F: Frame, m: Caches["focusColours"]) => {
  const k = edited ?? "";
  let c = m.get(k);
  if (!c || c.ep !== F.epoch) {
    const rgb = recencyRGB(F.tokens, edited, F.now, F.recorded, F.since);
    c = { rgb, css: css(rgb), ep: F.epoch };
    if (m.size > 2000) m.clear();
    m.set(k, c);
  }
  return c;
};

// ---------- the hovered or selected file's import lines ----------
const LINES_GROW_MS = 320;   // lines growing out of the file, or a stub running out to the whole line
const LINES_BACK_MS = 260;   // lines drawing back: a whole line to its stub, a stub into the file
const STUB_PX = 26;          // pointed at: each line shows this far past the file's edge, enough to count them
const easeOut = (k: number) => 1 - (1 - k) ** 3;
/** How far a file's lines are drawn: 0 not at all, 1 stubs, 2 whole lines, easing from `from` to `to` since `at`. */
export type LineLevel = { from: number; to: number; at: number };
const levelNow = (l: LineLevel, t: number) => {
  const k = Math.min(1, (t - l.at) / (l.to > l.from ? LINES_GROW_MS : LINES_BACK_MS));
  return l.from + (l.to - l.from) * easeOut(k);
};
/**
 * The lines of the file you point at or picked (what it imports, what uses it), drawn over the files at full strength in
 * every theme, so a station or a folder's disc never washes them out. Pointed at, each is a short stub out of the file
 * (how many, and which way); picked, they run the whole way. Every change is drawn out, never cut: they grow out of the
 * file, a stub runs out to the whole line on a click, and letting go draws them back the way they came (to stubs while
 * you still point at the file, into the file once you don't). Another file's lines draw back while the new ones grow.
 */
export function drawFocusLinks(ctx: CanvasRenderingContext2D, scale: number, links: GLink[], F: Frame, c: Caches) {
  const t = F.t, focus = F.linkFocus, levels = c.lines;
  const aim = (id: string) => (id !== focus ? 0 : focus === F.sel ? 2 : 1);
  if (focus && !levels.has(focus)) levels.set(focus, { from: 0, to: 0, at: t });
  let moving = false;
  ctx.save();
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (const [id, l] of levels) {
    const want = aim(id);
    if (want !== l.to) { l.from = levelNow(l, t); l.to = want; l.at = t; }
    const now = levelNow(l, t);
    if (now !== l.to) moving = true;
    if (now <= 0.001 && l.to === 0) { levels.delete(id); continue; }
    roleLines(ctx, scale, links, id, Math.min(1, now * 4), (stub) => (now <= 1 ? stub * now : stub + (1 - stub) * (now - 1)), F);
  }
  ctx.restore();
  if (moving) moreMotion(F, Motion.Smooth);
}
/** One file's lines at a strength, each drawn from the file out to its `reach` and ended with a dot (arrowheads once a line arrives). */
function roleLines(ctx: CanvasRenderingContext2D, scale: number, links: GLink[], focus: string, alpha: number, reach: (stub: number) => number, F: Frame) {
  const st = F.st, metro = st.link === "metro";
  ctx.globalAlpha = alpha;
  // Metro lines are thick like a transit map's, in screen pixels: 3 at a distance, at most 4.5 zoomed in (as map units
  // they grew with the zoom, to a dozen pixels and more up close).
  ctx.lineWidth = metro ? Math.min(Math.max(3 / scale, 3.2), 4.5 / scale) : 1.6 / scale;
  for (const role of ["imports", "usedBy"] as const) {
    ctx.strokeStyle = ctx.fillStyle = st[role];
    for (const l of links) {
      if (linkRole(l, focus) !== role) continue;
      const s = l.source, tg = l.target;
      if (s.x === undefined || s.y === undefined || tg.x === undefined || tg.y === undefined) continue;
      const pts: Pt2[] = metro ? metroPoints(s.x, s.y, tg.x, tg.y) : [[s.x, s.y], [tg.x, tg.y]];
      if (role === "usedBy") pts.reverse();   // out of the focused file, toward what uses it
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      const from = role === "imports" ? s : tg, k = reach(len ? Math.min(1, (from.r + STUB_PX / scale) / len) : 1);
      if (k <= 0) continue;
      const part = upTo(pts, k), end = part[part.length - 1];
      polyPath(ctx, part);
      ctx.stroke();
      if (!metro && k >= 1) arrowHead(ctx, s, tg);
      // A dot at its end: where a stub stops, or the file it reaches.
      ctx.beginPath(); ctx.arc(end[0], end[1], (metro ? Math.min(Math.max(3.2 / scale, 3.6), 5 / scale) : 2.6 / scale), 0, TAU); ctx.fill();
    }
  }
}

/** One file: its ripple and outline, its mark in the theme, its selection ring, and its name queued for the label pass. */
export function drawFile(ctx: CanvasRenderingContext2D, n: GNode, scale: number, F: Frame, c: Caches) {
  const x = n.x, y = n.y, r = n.r;
  if (x === undefined || y === undefined) return;
  // Off screen (with room for a glow, a ripple and a name): nothing to draw.
  const m = 3.7 * r + 34 / scale;
  if (x + m < F.x0 || x - m > F.x1 || y + m < F.y0 || y - m > F.y1) return;
  const shown = n.shown ?? 1;
  if (shown < 0.02) return;   // inside a folder closed at this zoom (fold.ts)
  if (n.dir) { drawFolder(ctx, n, scale, F, c, shown); return; }
  const tokens = F.tokens, st = F.st, t = F.t;
  const active = !!n.file.activeSessionId;
  const isSel = n.id === F.sel, isHover = n.id === F.hover;
  const look = lookOf(n, F);   // an open thread: its own footprint, the rest dimmed back
  if (look) { F.anyLook = true; F.lookSum += look.alpha * 3 + look.tone; }
  // Fading in as its folder opens, dimmed back by an open thread; the one you point at or picked shows in full.
  // Show git on: its files stay bright with a ring in its colour, the rest steps back a little (the map stays readable).
  const ring = F.only?.get(n.id);
  const alpha = isHover || isSel ? 1 : ring ? shown : (look?.alpha ?? 1) * shown * (F.only ? 0.45 : 1);
  ctx.globalAlpha = alpha;
  const plain = st.node !== "dot"; // themed files stay plain: no ripple or outlines, one mark where an agent is

  // An edit lands: one ripple, once. While the file stays active: a steady outline, no motion.
  const rippleStart = c.ripples.get(n.id);
  let rippling = false;
  if (rippleStart !== undefined) {
    if (plain) c.ripples.delete(n.id);
    else {
      const k = (t - rippleStart) / RIPPLE_MS;
      if (k >= 1) c.ripples.delete(n.id);
      else {
        rippling = true; moreMotion(F, Motion.Smooth);
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
  const own = ownColour(n, F);
  let rgb = own.c!, rgbCss = own.css!;
  if (look && look.tone > 0) {
    const fc = focusColour(look.edited, F, c.focusColours);
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
    if (flash) moreMotion(F, Motion.Smooth); else if (!still) moreMotion(F, Motion.Slow);
    const col = flash ? mixRGB(rgb, tokens.warm, flash) : rgb;
    if (active || flash || !stampCube(ctx, x, y, s, angle, col, rgbCss, lit, scale, (n.stamp ??= {}), alpha))
      drawCube(ctx, x, y, s, angle, col, lit || flash > 0, scale, active ? tokens.accent : null);
  }
  else if (st.node === "plate") { if (active || !stampPlate(ctx, x, y, r * 0.9, rgb, rgbCss, lit, scale, (n.stamp ??= {}), alpha)) drawPlate(ctx, x, y, r * 0.9, rgb, lit, scale, active ? tokens.accent : null); }
  else if (st.node === "station") {
    const fill = same(rgb, tokens.cool) ? "#fff" : rgbCss, ring = F.coolCss;
    if (active || !stampStation(ctx, x, y, r, fill, ring, isSel, scale, (n.stamp ??= {}), alpha)) drawStation(ctx, x, y, r, fill, ring, active ? css(tokens.hot) : null, isSel, scale);
  }
  else if (isSel || isHover || active || rippling) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = rgbCss; ctx.fill(); }
  else {
    // A plain dot: batched with every dot of its colour and strength, filled once after the files (flushDots).
    const a = alpha === 1 ? 1 : Math.round(alpha * 64) / 64, key = a === 1 ? rgbCss : rgbCss + "|" + a;
    let d = c.dots.get(key);
    if (!d) { if (c.dots.size > 512) c.dots.clear(); c.dots.set(key, (d = { css: rgbCss, a, xyr: [] })); }
    d.xyr.push(x, y, r);
  }
  if (isSel || isHover || (active && !plain)) {
    ctx.beginPath();
    ctx.arc(x, y, st.node === "dot" ? r : r * 1.35 + 2 / scale, 0, TAU);
    ctx.lineWidth = (isSel ? 2.4 : 1.4) / scale;
    ctx.strokeStyle = active ? tokens.accent : tokens.ink;
    ctx.stroke();
  }
  if (ring) {
    ctx.beginPath();
    ctx.arc(x, y, (st.node === "dot" ? r : r * 1.35) + 3.5 / scale, 0, TAU);
    ctx.globalAlpha = shown; ctx.lineWidth = 2 / scale; ctx.strokeStyle = ring; ctx.stroke();
    ctx.globalAlpha = alpha;
  }

  // THE LABEL HOOK for the focus: the files in an open thread's recent window are named whatever their size (edits
  // first), every other file only when selected or pointed at; another thread's edit doesn't pull a dimmed file forward.
  const focusing = !!look && look.tone > 0.5, inFocus = focusing && !!look.named && look.alpha > 0.3;
  const named = !!ring && F.only!.size <= 80;   // a short git list: every file of it named
  const forced = isSel || isHover || (active && !focusing) || named;
  if (forced || inFocus || (alpha >= 1 && (r * scale > 9 || scale > 3.2))) {
    // Queued (the label is built in labelFor for the most important ones only), drawn after every file: a
    // neighbour's circle never covers a name. The one you point at wins, then the selected one, then where an
    // agent works, then the focus (its edits first), then the biggest.
    F.labN.push(n);
    F.labP.push((isHover ? 4e6 : 0) + (isSel ? 2e6 : 0) + (active && !focusing ? 1e6 : 0) + (named ? 8e5 : 0) + (inFocus ? (look!.edited ? 6e5 : 5e5) : 0) + r);
  }
}

/** Under this size on screen (radius, px) a closed folder is named below its circle, like a file; above, inside it. */
const FOLDER_TEXT_PX = 15;

/**
 * A folder (graph.ts, fold.ts). Closed (small on screen): a soft disc in its files' latest colour, ringed, with its
 * name and how many files it holds inside: it reads as a group, not as one more file. Open: a faint outline around its
 * files (its name sits on the outline: drawFolderNames). In between, as you zoom, one fades into the other. Every
 * theme draws folders the same way. A click on a closed folder zooms into it.
 */
function drawFolder(ctx: CanvasRenderingContext2D, n: GNode, scale: number, F: Frame, c: Caches, shown: number) {
  const x = n.x!, y = n.y!, r = n.r, tokens = F.tokens, st = F.st, open = n.open ?? 1;
  // A closed folder stands in for files too small to see: it keeps their blue ring (only the outermost closed one is drawn).
  const active = !!n.file.activeSessionId, isSel = n.id === F.sel, isHover = n.id === F.hover;
  const look = lookOf(n, F);
  if (look) { F.anyLook = true; F.lookSum += look.alpha * 3 + look.tone; }
  // A thread's focus dims folders less than files: they're the lay of the land around what it did.
  const dim = (look ? 0.5 + 0.5 * look.alpha : 1) * (F.only && !F.onlyDirs?.has(n.id) ? 0.55 : 1), alpha = dim * shown;
  // Open: the outline, and a breath of fill so folders inside folders read as levels.
  if (open > 0) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU);
    if (n.dir!.depth <= 3) { ctx.globalAlpha = alpha * open * 0.02; ctx.fillStyle = tokens.ink; ctx.fill(); }   // deeper, the levels would add up to grey
    // No blue on an open folder: its files show their own rings, and every folder around an edit turning blue was too much.
    ctx.globalAlpha = alpha * open * 0.16; ctx.lineWidth = 1 / scale;
    ctx.strokeStyle = tokens.ink; ctx.stroke();
  }
  const closed = alpha * (1 - open);
  if (closed <= 0.01) { ctx.globalAlpha = 1; return; }
  const own = ownColour(n, F);
  let rgbCss = own.css!;
  if (look && look.tone >= 1) rgbCss = focusColour(look.edited, F, c.focusColours).css;
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU);
  // Metro: a white disc like its stations, its lines passing under it; elsewhere a tint of the folder's colour.
  const metro = st.node === "station";
  if (metro) { ctx.globalAlpha = closed * 0.92; ctx.fillStyle = "#fff"; ctx.fill(); if (!same(own.c!, tokens.cool)) { ctx.globalAlpha = closed * 0.22; ctx.fillStyle = rgbCss; ctx.fill(); } }
  else { ctx.globalAlpha = closed * (isHover ? 0.24 : 0.16); ctx.fillStyle = rgbCss; ctx.fill(); }
  ctx.globalAlpha = closed * (isHover || isSel ? 0.9 : 0.5);
  ctx.lineWidth = (isHover || isSel ? 1.8 : 1.2) / scale;
  ctx.strokeStyle = active ? tokens.accent : isHover || isSel ? tokens.ink : rgbCss;
  ctx.stroke();
  const gitRing = F.onlyDirs?.get(n.id);   // Show git: something inside it
  if (gitRing && !active) { ctx.beginPath(); ctx.arc(x, y, r + 3.5 / scale, 0, TAU); ctx.globalAlpha = closed; ctx.lineWidth = 2 / scale; ctx.strokeStyle = gitRing; ctx.stroke(); }
  if (active) { ctx.beginPath(); ctx.arc(x, y, r + 3.5 / scale, 0, TAU); ctx.globalAlpha = 0.9 * closed; ctx.lineWidth = 1.6 / scale; ctx.strokeStyle = tokens.accent; ctx.stroke(); }
  ctx.globalAlpha = 1;
  const px = r * scale, count = n.dir!.files.length;
  if (px < FOLDER_TEXT_PX) {
    // Small on screen: named below, like a file (drawn in the label pass).
    if (isSel || isHover || px > 6 || active) { F.labN.push(n); F.labP.push((isHover ? 4e6 : 0) + (active ? 1e6 : 0) + 7e5 + r); }
    return;
  }
  // Its name goes first as it opens: by the time its files show, it's gone (its name is on the outline then).
  const said = dim * (n.said ?? 1) * Math.max(0, 1 - open * 3);
  if (said <= 0.01) return;
  // A few sizes only, stamped from cached pictures (labels.ts drawName): zooming doesn't draw new text every frame.
  const name = folderName(n), family = st.labelFont ?? tokens.body, size = px > 110 ? 20 : px > 70 ? 16 : px > 40 ? 13 : 11;
  const clear = "rgba(0,0,0,0)", k = 1 / scale;
  drawName(ctx, name, x, y - 0.75 * size * k, size, 650, family, st.fileInk, clear, said * (isHover || active ? 1 : 0.85));
  if (px > 34) drawName(ctx, count === 1 ? "1 file" : `${count} files`, x, y + 0.35 * size * k, 11, 500, family, st.fileInkQuiet, clear, said * 0.9);
}

/**
 * Open folders' names, on the top of their outline (after the files, before the file names: those keep off them). The
 * outer folders first; a name with no room waits for the zoom.
 */
export function drawFolderNames(ctx: CanvasRenderingContext2D, scale: number, folders: GNode[], F: Frame, space: LabelSpace) {
  const st = F.st, family = st.labelFont ?? F.tokens.body;
  for (const n of folders) {
    const shown = n.shown ?? 1, open = n.open ?? 1, x = n.x!, y = n.y!, r = n.r;
    if (shown * open < 0.3 || (n.said ?? 1) < 0.05 || r * scale < 40) continue;
    const top = y - r;
    if (x + r < F.x0 || x - r > F.x1 || top > F.y1 || top < F.y0 - 30 / scale) continue;
    const name = folderName(n), px = n.dir!.depth <= 1 ? 15 : 13, w = textWidth(ctx, name, 650, family, px, px) / scale, h = px * 1.3 / scale, pad = 6 / scale;
    const box = { x0: x - w / 2 - pad, x1: x + w / 2 + pad, y0: top - h / 2 - pad / 2, y1: top + h / 2 + pad / 2 };
    if (!space.claim(box)) continue;
    const look = n.lf === F.id ? n.lk ?? null : null;
    drawName(ctx, name, x, top - h / 2, px, 650, family, n.file.activeSessionId ? st.fileInk : st.fileInkQuiet, st.halo, shown * open * Math.max(0.55, look?.alpha ?? 1));
  }
}
/** A folder's name: its last folder, or two when the last alone says little ("src", "lib"). */
const folderName = (n: GNode) => {
  const segs = n.dir!.name.split("/"), last = segs[segs.length - 1];
  return segs.length > 1 && /^(src|lib|test|tests|app|components|utils|internal|pkg)$/.test(last) ? segs.slice(-2).join("/") : last;
};
/** A queued file's label, built in full (only for the ones that may be drawn this frame). */
export function labelFor(n: GNode, prio: number, F: Frame): QueuedLabel {
  const st = F.st, tokens = F.tokens, scale = F.scale, r = n.r, x = n.x!, y = n.y!;
  const active = !!n.file.activeSessionId, isSel = n.id === F.sel, isHover = n.id === F.hover;
  const look = n.lf === F.id ? n.lk ?? null : null, alpha = look?.alpha ?? 1;
  const focusing = !!look && look.tone > 0.5, inFocus = focusing && !!look.named && look.alpha > 0.3;
  const forced = isSel || isHover || (active && !focusing);
  const fs = Math.max(11, Math.min(14, 11 + r * scale * 0.08)) / scale;
  // Clear of what the theme draws (a cube's corners, a plate's rim) and of the selection ring.
  const ringR = n.dir ? r : Math.max(reachOf(r, active, st), isSel || isHover ? (st.node === "dot" ? r : r * 1.35 + 2 / scale) : 0);
  return {
    text: (n.bn ??= n.dir ? folderName(n) : baseName(n.id)), x, y: y + ringR + 3 / scale, size: fs, scale,
    alpha: isSel || isHover || F.only?.has(n.id) ? 1 : (inFocus ? Math.max(alpha, 0.8) : alpha) * (n.said ?? 1) * (n.dir ? Math.max(0, 1 - (n.open ?? 0) * 3) : 1),
    at: { id: n.id, x, y, r: ringR }, must: isSel || isHover,
    weight: isSel || (active && !focusing) ? 600 : 500, family: st.labelFont ?? tokens.body,
    ink: isSel || (active && !focusing) || isHover || (inFocus && look!.edited) ? st.fileInk : st.fileInkQuiet, halo: st.halo,
    prio, forced,
  };
}

/** The batched dots (drawFile), each colour in one fill: a circle, or a square as big when it's under a pixel. */
export function flushDots(ctx: CanvasRenderingContext2D, dots: Dots, scale: number) {
  for (const d of dots.values()) {
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
}
