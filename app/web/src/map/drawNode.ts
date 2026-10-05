// Owner: D. Drawing one frame of the map's files and import lines (moved out of MapView.tsx): plain functions of the
// frame (Frame: what's asked once per frame) and of caches that live as long as the map. MapView calls them from
// force-graph's frame callbacks.
import type { Look } from "./replay/layer";
import type { QueuedLabel } from "./labels";
import { Motion } from "./redraw";
import {
  CUBE_STILL_PX, drawCube, drawPlate, drawStation, LAND_MS, landings, metroPath, metroSegment, moduleColor, reachOf,
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
// Outside Metro only the hovered or selected file's lines are drawn. Metro's lines are the theme itself: there,
const HIDE_LINKS_FROM = 4000;   // a map with more import lines than this...
const HIDE_LINKS_BELOW = 0.4;   // ...hides the idle ones below this zoom (a haze over the stations); the focused file's stay
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
export const FILE_LABELS_MAX = 500;    // file names placed per frame at most (the most important first)
/** What a frame needs to know once, not per file: where the camera looks, the time, the theme, what moves. */
export type Frame = {
  id: number; scale: number; x0: number; y0: number; x1: number; y1: number;
  now: number; t: number; st: MapStyle; sel: string | null; hover: string | null; coolCss: string;
  looks: boolean; anyLook: boolean; lookSum: number; motion: Motion; linksDone: boolean;
  labN: GNode[]; labP: number[];
  /** The theme's colours, the colour epoch (bumped every few seconds: recency fades), and what recencyRGB needs. */
  tokens: Tokens; epoch: number; recorded: boolean; since: number;
  /** The replay layer's look for a file; the hovered or selected file (its import lines show); a thread is being traced. */
  look: (id: string) => Look | null; linkFocus: string | null; tracing: boolean;
};
export type Dots = Map<string, { css: string; a: number; xyr: number[] }>;
/** What lives as long as the map: ripples under way, the batches and buffers reused from frame to frame. */
export type Caches = {
  ripples: Map<string, number>; dots: Dots;
  focusColours: Map<string, { rgb: RGB; css: string; ep: number }>;
  linkBatches: Map<string, { c: string; a: number; ls: GLink[] }>; metroVisible: GLink[]; metroAlpha: number[];
};
export const newCaches = (): Caches => ({ ripples: new Map(), dots: new Map(), focusColours: new Map(), linkBatches: new Map(), metroVisible: [], metroAlpha: [] });

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

/** Import lines, under the files: the hovered or selected file's; in Metro all of them, idle ones batched per colour and strength. */
export function drawLinks(ctx: CanvasRenderingContext2D, scale: number, links: GLink[], F: Frame, c: Caches) {
  const st = F.st;
  if (!links.length) return;
  const focus = F.linkFocus, tracing = F.tracing;
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
    const vis = c.metroVisible, va = c.metroAlpha;
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
      const batches = c.linkBatches;
      for (const b of batches.values()) b.ls.length = 0;
      for (let i = 0; i < vis.length; i++) {
        const l = vis[i], a = Math.round(va[i] * 100) / 100, col = moduleColor(l.source.file.module), k = col + "|" + a;
        let b = batches.get(k);
        if (!b) { if (batches.size > 3000) batches.clear(); batches.set(k, (b = { c: col, a, ls: [] })); }
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
    // Only the hovered or selected file's lines: the rest were a haze over the map that nobody read.
    ctx.globalAlpha = 1;
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
}

/** One file: its ripple and outline, its mark in the theme, its selection ring, and its name queued for the label pass. */
export function drawFile(ctx: CanvasRenderingContext2D, n: GNode, scale: number, F: Frame, c: Caches) {
  const x = n.x, y = n.y, r = n.r;
  if (x === undefined || y === undefined) return;
  // Off screen (with room for a glow, a ripple and a name): nothing to draw.
  const m = 3.7 * r + 34 / scale;
  if (x + m < F.x0 || x - m > F.x1 || y + m < F.y0 || y - m > F.y1) return;
  if (n.fold) { drawFolder(ctx, n, scale, F, c); return; }
  const tokens = F.tokens, st = F.st, t = F.t;
  const active = !!n.file.activeSessionId;
  const isSel = n.id === F.sel, isHover = n.id === F.hover;
  const look = lookOf(n, F);   // an open thread: its own footprint, the rest dimmed back
  if (look) { F.anyLook = true; F.lookSum += look.alpha * 3 + look.tone; }
  const alpha = look?.alpha ?? 1;
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

  // THE LABEL HOOK for the focus: the files in an open thread's recent window are named whatever their size (edits
  // first), every other file only when selected or pointed at; another thread's edit doesn't pull a dimmed file forward.
  const focusing = !!look && look.tone > 0.5, inFocus = focusing && !!look.named && look.alpha > 0.3;
  const forced = isSel || isHover || (active && !focusing);
  if (forced || inFocus || (alpha >= 1 && (r * scale > 9 || scale > 3.2))) {
    // Queued (the label is built in labelFor for the most important ones only), drawn after every file: a
    // neighbour's circle never covers a name. The one you point at wins, then the selected one, then where an
    // agent works, then the focus (its edits first), then the biggest.
    F.labN.push(n);
    F.labP.push((isHover ? 4e6 : 0) + (isSel ? 2e6 : 0) + (active && !focusing ? 1e6 : 0) + (inFocus ? (look!.edited ? 6e5 : 5e5) : 0) + r);
  }
}

/** Under this size on screen (radius, px) a folder's circle is named below it, like a file; above, inside it. */
const FOLDER_TEXT_PX = 15;

/**
 * A folded folder (fold.ts): a soft disc in its files' latest colour, ringed, with its name and how many files it
 * holds inside. Every theme draws it the same way: it reads as a group, not as one more file. A click opens it.
 */
function drawFolder(ctx: CanvasRenderingContext2D, n: GNode, scale: number, F: Frame, c: Caches) {
  const x = n.x!, y = n.y!, r = n.r, tokens = F.tokens, st = F.st;
  const active = !!n.file.activeSessionId, isSel = n.id === F.sel, isHover = n.id === F.hover;
  const look = lookOf(n, F);
  if (look) { F.anyLook = true; F.lookSum += look.alpha * 3 + look.tone; }
  const alpha = look?.alpha ?? 1;
  const own = ownColour(n, F);
  let rgbCss = own.css!;
  if (look && look.tone >= 1) rgbCss = focusColour(look.edited, F, c.focusColours).css;
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU);
  ctx.globalAlpha = alpha * (isHover ? 0.24 : 0.16); ctx.fillStyle = rgbCss; ctx.fill();
  ctx.globalAlpha = alpha * (isHover || isSel ? 0.9 : 0.5);
  ctx.lineWidth = (isHover || isSel ? 1.8 : 1.2) / scale;
  ctx.strokeStyle = active ? tokens.accent : isHover || isSel ? tokens.ink : rgbCss;
  ctx.stroke();
  if (active) { ctx.beginPath(); ctx.arc(x, y, r + 3.5 / scale, 0, TAU); ctx.globalAlpha = 0.9 * alpha; ctx.lineWidth = 1.6 / scale; ctx.strokeStyle = tokens.accent; ctx.stroke(); }
  ctx.globalAlpha = 1;
  const px = r * scale, count = n.fold!.files.length;
  if (px < FOLDER_TEXT_PX) {
    // Small on screen: named below, like a file (drawn in the label pass).
    if (isSel || isHover || px > 6 || active) { F.labN.push(n); F.labP.push((isHover ? 4e6 : 0) + (active ? 1e6 : 0) + 7e5 + r); }
    return;
  }
  const name = folderName(n), family = st.labelFont ?? tokens.body, size = Math.min(22, Math.max(11, px * 0.2));
  screenText(ctx, name, x, y, size, 650, family, st.fileInk, alpha * (isHover || active ? 1 : 0.85), -0.15 * size);
  if (px > 34) screenText(ctx, count === 1 ? "1 file" : `${count} files`, x, y, Math.max(11, size * 0.62), 500, family, st.fileInkQuiet, alpha * 0.9, 0.85 * size);
}
/** A folder's name: its last folder, or two when the last alone says little ("src", "lib"). */
const folderName = (n: GNode) => {
  const segs = n.fold!.rel.split("/"), last = segs[segs.length - 1];
  return segs.length > 1 && /^(src|lib|test|tests|app|components|utils|internal|pkg)$/.test(last) ? segs.slice(-2).join("/") : last;
};
/**
 * Text at a size on screen, at a graph point (its middle `dy` screen pixels down), set in device pixels: small text
 * drawn at a tiny size and scaled up comes out spaced wrong with system fonts.
 */
function screenText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, px: number, weight: number, family: string, color: string, alpha: number, dy = 0) {
  const m = ctx.getTransform(), dpr = (typeof devicePixelRatio === "number" && devicePixelRatio) || 1;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = `${weight} ${px * dpr}px ${family}`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.globalAlpha = alpha; ctx.fillStyle = color;
  ctx.fillText(text, Math.round(x * m.a + y * m.c + m.e), Math.round(x * m.b + y * m.d + m.f + dy * dpr));
  ctx.restore();
}

/** A queued file's label, built in full (only for the ones that may be drawn this frame). */
export function labelFor(n: GNode, prio: number, F: Frame): QueuedLabel {
  const st = F.st, tokens = F.tokens, scale = F.scale, r = n.r, x = n.x!, y = n.y!;
  const active = !!n.file.activeSessionId, isSel = n.id === F.sel, isHover = n.id === F.hover;
  const look = n.lf === F.id ? n.lk ?? null : null, alpha = look?.alpha ?? 1;
  const focusing = !!look && look.tone > 0.5, inFocus = focusing && !!look.named && look.alpha > 0.3;
  const forced = isSel || isHover || (active && !focusing);
  const fs = Math.max(11, Math.min(14, 11 + r * scale * 0.08)) / scale;
  // Clear of what the theme draws (a cube's corners, a plate's rim) and of the selection ring.
  const ringR = n.fold ? r : Math.max(reachOf(r, active, st), isSel || isHover ? (st.node === "dot" ? r : r * 1.35 + 2 / scale) : 0);
  return {
    text: (n.bn ??= n.fold ? folderName(n) : baseName(n.id)), x, y: y + ringR + 3 / scale, size: fs, scale, alpha: isSel || isHover ? 1 : inFocus ? Math.max(alpha, 0.8) : alpha,
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

/** The hit canvas (what's under the pointer): off-screen files skipped, tiny ones as squares. */
export function paintHit(n: GNode, color: string, ctx: CanvasRenderingContext2D, scale: number, F: Frame) {
  const x = n.x, y = n.y;
  if (x === undefined || y === undefined) return;
  const m = n.r + 3;
  if (x + m < F.x0 || x - m > F.x1 || y + m < F.y0 || y - m > F.y1) return;
  ctx.fillStyle = color;
  if (m * scale < 2) { ctx.fillRect(x - m, y - m, 2 * m, 2 * m); return; }
  ctx.beginPath(); ctx.arc(x, y, m, 0, TAU); ctx.fill();
}
