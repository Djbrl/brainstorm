// Owned by the lead. How each map theme draws on the canvas: files, imports, labels and agent markers.
// Colours that also style the chrome (recency, accent) come from CSS variables set per theme in themes.css;
// this file holds what CSS can't reach. The current theme is read on every frame (getTheme()).
import { getTheme, type ThemeId } from "../lib/theme";
import { bucket, faded, sprite, stamp, type Sprite, type StampMemo } from "./sprites";

export type RGB = [number, number, number];

export type MapStyle = {
  /** How a file is drawn: a dot, a turning glass cube, a hologram floor tile or a metro station. */
  node: "dot" | "cube" | "plate" | "station";
  /** Imports (the hovered or selected file's): plain lines, or metro lines (horizontal, vertical and 45°). */
  link: "line" | "metro";
  halo: string; fileInk: string; fileInkQuiet: string;
  moduleInk: string; moduleInkLively: string; moduleFont?: string; labelFont?: string;
  linkIdle: string; imports: string; usedBy: string;
  markerStroke: string; markerText: string; glow: boolean;
  /** How an agent travels between files, and the shape of the trail it leaves (see routePoints):
   *  a straight glide (trails curve softly), metro track, a locator line with one right angle, or a hop in an arc. */
  route: "glide" | "metro" | "elbow" | "hop";
  /** Metro: the agent's own line (the main thread and a replay), in a colour no folder line can take. Others use the accent. */
  track?: string;
  /** Subagent colours (main threads take the theme's accent). */
  palette: string[];
  /** An agent's mark: a filled disc, Metro's line badge (white, ringed in its colour), Prism's glowing orb, or
   *  Hologram's waypoint (a dark disc ringed in its colour, a locator triangle above). See drawMarker. */
  marker: "disc" | "badge" | "orb" | "waypoint";
  /** Metro: the line colours folders take (a station is ringed in its folder's line, like a stop on it). */
  lines?: string[];
  /** Metro: open folders drawn as fare zones (octagons, peach and cream by turns), named in this ink. */
  zoneInk?: string;
  /** A closed folder's name (the file names' strong ink otherwise). */
  folderInk?: string;
  /** How far a file's mark reaches from its centre, in radii: idle, and with an agent on it (its ring, its bigger cube).
   *  The layout keeps this clear between files and labels stay out of it (see reachOf). */
  reach: [number, number];
};

const BASE: MapStyle = {
  node: "dot", link: "line",
  halo: "rgba(249,249,247,0.9)", fileInk: "#121214", fileInkQuiet: "rgba(18,18,20,0.62)",
  moduleInk: "rgba(29,29,31,0.2)", moduleInkLively: "rgba(29,29,31,0.34)",
  linkIdle: "rgba(29,29,31,0.08)",
  imports: "rgba(37,99,235,0.7)", usedBy: "rgba(15,157,138,0.7)",
  markerStroke: "#fff", markerText: "#fff", glow: false, route: "glide",
  palette: ["#2f7ae5", "#0f9d8a", "#c2409a", "#7c4dde", "#2e9e4f", "#0b8fb3", "#b5487a", "#4a6fa5"],
  marker: "disc",
  reach: [1, 1.2],                       // a dot; the active outline sits 3.5px out
};

/** The RER's line colours (A red, B blue, C yellow, D green, E pink) and two more for big projects. */
const RER = ["#e3051c", "#4f8fcf", "#f2bb00", "#00a07e", "#c04191", "#7b5aa6", "#6e9a2f"];
const FRUTIGER = `"Avenir Next Condensed", "Avenir Next", Frutiger, "Segoe UI", "Helvetica Neue", sans-serif`;
const SYSTEM_MENU = `"Helvetica Neue", Helvetica, Arial, sans-serif`;
const DECK = `"DIN Alternate", "DIN Condensed", Bahnschrift, "Arial Narrow", "Helvetica Neue", sans-serif`;

const STYLES: Record<ThemeId, MapStyle> = {
  default: BASE,
  metro: {
    ...BASE, node: "station", link: "metro", route: "metro", track: "#1d1d1b", marker: "badge",
    imports: "rgba(29,29,27,0.9)", usedBy: "rgba(29,29,27,0.9)",   // the folder lines have the colours; imports are ink, like a connection
    halo: "rgba(253,249,236,0.95)", fileInk: "#1d1d1b", fileInkQuiet: "rgba(29,29,27,0.74)",
    moduleInk: "rgba(29,29,31,0.55)", moduleInkLively: "rgba(29,29,31,0.8)",
    labelFont: FRUTIGER, moduleFont: FRUTIGER,
    lines: RER, palette: RER, zoneInk: "#e2730e",
    reach: [0.72, 1.1],                  // a station is 0.6r plus its ring; an agent adds one more ring
  },
  prism: {
    ...BASE, node: "cube", route: "hop", marker: "orb",
    halo: "rgba(18,18,46,0.88)", fileInk: "#74d4ff", fileInkQuiet: "rgba(206,210,228,0.72)", folderInk: "#e9ebf6",
    moduleInk: "rgba(205,210,255,0.26)", moduleInkLively: "rgba(116,212,255,0.75)",
    moduleFont: SYSTEM_MENU, labelFont: SYSTEM_MENU,
    linkIdle: "rgba(120,160,255,0.16)",
    imports: "rgba(242,227,106,0.9)", usedBy: "rgba(140,200,255,0.9)",
    markerStroke: "rgba(255,255,255,0.95)", markerText: "#16163a", glow: true,
    palette: ["#8fb4ff", "#7ee0ff", "#ff9ff3", "#c7a6ff", "#9dffb0", "#ffe08a", "#ffb38a", "#a6f0ff"],
    reach: [1.25, 1.95],                 // a turning cube's corners (0.78r, tilted); active: 1.3x and the floor ring
  },
  hologram: {
    ...BASE, node: "plate", route: "elbow", marker: "waypoint",
    halo: "rgba(6,14,20,0.9)", fileInk: "#e6f4fc", fileInkQuiet: "rgba(168,204,226,0.66)",
    moduleInk: "rgba(127,200,240,0.3)", moduleInkLively: "rgba(127,214,255,0.75)",
    moduleFont: DECK, labelFont: DECK,
    linkIdle: "rgba(120,180,220,0.16)",
    imports: "rgba(243,207,74,0.9)", usedBy: "rgba(127,214,255,0.9)",
    markerStroke: "#eaf6ff", markerText: "#eaf6ff", glow: true,
    palette: ["#7fd6ff", "#eaf6ff", "#ffb36b", "#b6e3ff", "#9ef7c8", "#ffd98a", "#8fb8ff", "#c9a8ff"],
    reach: [1.35, 2.05],                 // a room is 2.4r by 1.24r (its corners 1.35r out); active: the rectangle around it
  },
};

export const mapStyle = (): MapStyle => STYLES[getTheme()];

/** How far a file of radius r reaches on the canvas in this theme (graph units, never under 4: the smallest station). */
export const reachOf = (r: number, active = false, st = mapStyle()) => Math.max(4, r * st.reach[active ? 1 : 0]);

const TAU = Math.PI * 2;
const rgba = ([r, g, b]: RGB, a: number) => `rgba(${r},${g},${b},${a})`;
/** Colour strings built once: the same few colours are asked for by thousands of files a frame. */
const rgbaCache = new Map<string, string>();
const rgbaOf = (r: number, g: number, b: number, a: number) => {
  const k = r + "," + g + "," + b + "," + a;
  let v = rgbaCache.get(k);
  if (v === undefined) { v = `rgba(${k})`; if (rgbaCache.size > 4000) rgbaCache.clear(); rgbaCache.set(k, v); }
  return v;
};
const q = (v: number) => Math.round(v * 100) / 100;   // alphas to 1/100: fewer distinct strings, the same picture

// ---------- Prism: a glass cube, turning slowly ----------
const CUBE_V = [-1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1];
const CUBE_F = [0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 5, 4, 2, 3, 7, 6, 1, 2, 6, 5, 0, 3, 7, 4];
const TILT_C = Math.cos(0.55), TILT_S = Math.sin(0.55);
const PV = new Float64Array(24), FZ = new Float64Array(6), ORDER = [0, 1, 2, 3, 4, 5];
/** The cube's six glass faces at `angle`, far to near (one set of buffers: nothing allocated per cube). */
function cubeBody(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, angle: number, c: RGB, lineWidth: number) {
  const ca = Math.cos(angle), sa = Math.sin(angle);
  for (let v = 0; v < 8; v++) {
    const a = CUBE_V[v * 3], b = CUBE_V[v * 3 + 1], d = CUBE_V[v * 3 + 2];
    const x1 = a * ca - d * sa, z1 = a * sa + d * ca;
    PV[v * 3] = x + x1 * s; PV[v * 3 + 1] = y + (b * TILT_C - z1 * TILT_S) * s; PV[v * 3 + 2] = b * TILT_S + z1 * TILT_C;
  }
  for (let f = 0; f < 6; f++) {
    FZ[f] = (PV[CUBE_F[f * 4] * 3 + 2] + PV[CUBE_F[f * 4 + 1] * 3 + 2] + PV[CUBE_F[f * 4 + 2] * 3 + 2] + PV[CUBE_F[f * 4 + 3] * 3 + 2]) / 4;
    ORDER[f] = f;
  }
  // Far (bigger z) first; stable, like the sort it replaces.
  for (let i = 1; i < 6; i++) { const f = ORDER[i]; let j = i - 1; while (j >= 0 && FZ[ORDER[j]] < FZ[f]) { ORDER[j + 1] = ORDER[j]; j--; } ORDER[j + 1] = f; }
  ctx.lineWidth = lineWidth;
  for (let i = 0; i < 6; i++) {
    const f = ORDER[i], z = FZ[f];
    ctx.beginPath();
    for (let n = 0; n < 4; n++) { const v = CUBE_F[f * 4 + n] * 3; if (n) ctx.lineTo(PV[v], PV[v + 1]); else ctx.moveTo(PV[v], PV[v + 1]); }
    ctx.closePath();
    ctx.fillStyle = rgbaOf(c[0], c[1], c[2], q(0.2 + (1 - z) * 0.12)); ctx.fill();
    ctx.strokeStyle = rgbaOf(232, 240, 255, q(0.38 + (1 - z) * 0.25)); ctx.stroke();
  }
}
function cubeGlow(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, c: RGB) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, s * 3.6);
  g.addColorStop(0, rgba(c, 0.45)); g.addColorStop(1, rgba(c, 0));
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, s * 3.6, 0, TAU); ctx.fill();
}
export function drawCube(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, angle: number, c: RGB, glow: boolean, scale: number, here: string | null = null) {
  if (here) { // where an agent is: one glowing ring on the floor under the cube
    ctx.save();
    ctx.beginPath(); ctx.ellipse(x, y + s * 1.35, s * 1.9, s * 0.62, 0, 0, TAU);
    ctx.strokeStyle = here; ctx.lineWidth = 1.8 / scale; ctx.shadowColor = here; ctx.shadowBlur = 12; ctx.stroke();
    ctx.restore();
  }
  if (glow) cubeGlow(ctx, x, y, s, c);
  cubeBody(ctx, x, y, s, angle, c, 0.9 / scale);
}

/** Below this size on screen (half a cube's width, in pixels) a cube stands still: its turn wouldn't show. */
export const CUBE_STILL_PX = 3;
const CUBE_STAMP_PX = 12;    // up to here a cube is stamped at one of ANGLES angles; bigger ones are drawn as they turn
const ANGLES = 32;           // per quarter turn (a cube looks the same a quarter turn on): 2.8° apart
const QUARTER = Math.PI / 2;
/**
 * A Prism cube, the quick way: a stamp of its glow and one of its body at the nearest of 32 angles, for every cube up to
 * CUBE_STAMP_PX on screen (all of them on a big map); false when it's bigger (drawCube draws it then). Looks like drawCube.
 * `css`: its colour as a string, the stamp's key.
 */
export function stampCube(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, angle: number, c: RGB, css: string, glow: boolean, scale: number, memo: StampMemo = {}, alpha = 1): boolean {
  const S = s * scale;
  if (S > CUBE_STAMP_PX) return false;
  const b = bucket(S), k = (1 / scale) * (S / b);
  if (glow) {
    let g: Sprite | null | undefined = memo.g;
    if (!g || memo.gk !== css || memo.c !== b) g = memo.g = sprite("cg|" + css + "|" + b, b * 7.2, b * 7.2, b * 3.6, b * 3.6, (cx) => cubeGlow(cx, b * 3.6, b * 3.6, b, c));
    memo.gk = css;
    if (g) stamp(ctx, g, x, y, k);
  }
  let a = angle % QUARTER; if (a < 0) a += QUARTER;
  const step = Math.round((a / QUARTER) * ANGLES) % ANGLES, half = b * 1.8 + 1, fa = faded(alpha);   // the glow is one fill: it fades as is
  let body: Sprite | null | undefined = memo.s;
  if (!body || memo.a !== css || memo.c !== b || memo.d !== step || memo.e !== fa) {
    body = memo.s = sprite("cb|" + css + "|" + b + "|" + step + "|" + fa, half * 2, half * 2, half, half, (cx) => { cx.globalAlpha = fa; cubeBody(cx, half, half, b, (step / ANGLES) * QUARTER, c, 0.9); });
    memo.a = css; memo.c = b; memo.d = step; memo.e = fa;
  }
  if (!body) { cubeBody(ctx, x, y, s, angle, c, 0.9 / scale); return true; }
  stamp(ctx, body, x, y, k, fa < 1);
  return true;
}

// ---------- Hologram: a floor tile, a low slab seen from above ----------
const TILE_W = 1.2, TILE_H = 0.62;   // half its width and half its height, in radii
/** A room on a deck plan: a translucent steel-blue panel, a bright edge, a bevel inside, a hatch on its right side. */
function plateBody(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, c: RGB, lit: boolean, scale: number) {
  const hx = r * TILE_W, hy = r * TILE_H, cr = hy * 0.16, lw = 1 / scale;
  if (lit) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, hx * 2.2);
    g.addColorStop(0, rgba(c, 0.3)); g.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, hx * 2.2, 0, TAU); ctx.fill();
  }
  ctx.fillStyle = lit ? rgba(c, 0.5) : "rgba(44,96,130,0.5)";
  ctx.beginPath(); ctx.roundRect(x - hx, y - hy, hx * 2, hy * 2, cr); ctx.fill();
  ctx.strokeStyle = lit ? rgba(c, 1) : "rgba(140,206,242,0.8)"; ctx.lineWidth = lw; ctx.stroke();
  const ix = hy * 0.3;   // the bevel: a fainter edge inside
  if (hy - ix > lw * 2) {
    ctx.strokeStyle = lit ? rgba(c, 0.45) : "rgba(140,206,242,0.26)";
    ctx.beginPath(); ctx.rect(x - hx + ix, y - hy + ix, (hx - ix) * 2, (hy - ix) * 2); ctx.stroke();
  }
  const d = hy * 0.42;   // the hatch: a small square on its right side, like a door between rooms
  ctx.fillStyle = "rgba(10,24,34,0.95)"; ctx.fillRect(x + hx - d / 2, y - d / 2, d, d);
  ctx.strokeStyle = lit ? rgba(c, 1) : "rgba(200,232,250,0.85)"; ctx.strokeRect(x + hx - d / 2, y - d / 2, d, d);
}
export function drawPlate(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, c: RGB, lit: boolean, scale: number, here: string | null = null) {
  if (here) { // where an agent is: one holographic rectangle projected on the floor around the tile
    const qx = r * TILE_W * 1.45 + 5 / scale, qy = r * TILE_H * 1.6 + 4 / scale;
    ctx.save();
    ctx.beginPath(); ctx.roundRect(x - qx, y - qy, qx * 2, qy * 2, 3 / scale);
    ctx.strokeStyle = here; ctx.lineWidth = 1.5 / scale; ctx.shadowColor = here; ctx.shadowBlur = 10; ctx.stroke();
    ctx.restore();
  }
  plateBody(ctx, x, y, r, c, lit, scale);
}
const PLATE_STAMP_PX = 40;
/** A Hologram room as a stamp (up to PLATE_STAMP_PX on screen, no agent rectangle); false when drawPlate must draw it. */
export function stampPlate(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, c: RGB, css: string, lit: boolean, scale: number, memo: StampMemo = {}, alpha = 1): boolean {
  const R = r * scale;
  if (R > PLATE_STAMP_PX) return false;
  const b = bucket(R), key = lit ? css : "", fa = faded(alpha);
  let sp: Sprite | null | undefined = memo.s;
  if (!sp || memo.a !== key || memo.c !== b || memo.e !== fa) {
    const rx = b * TILE_W, ry = b * TILE_H;
    const half = lit ? rx * 2.2 : rx + ry * 0.25 + 2, top = lit ? rx * 2.2 : ry + 2, h = top * 2;
    sp = memo.s = sprite("p|" + key + "|" + b + "|" + fa, half * 2, h, half, top, (cx) => { cx.globalAlpha = fa; plateBody(cx, half, top, b, c, lit, 1); });
    memo.a = key; memo.c = b; memo.e = fa;
  }
  if (!sp) return false;
  stamp(ctx, sp, x, y, (1 / scale) * (R / b), fa < 1);
  return true;
}

// ---------- Metro: a station, and imports as transit lines ----------
/** A station: ringed in its folder's line colour (ink outside any line), filled with the recency colour once the file
 *  changed (white while quiet), like a stop on an RER line.
 *  Where an agent is: one more ring, in the "just now" colour. Nothing else is drawn around a station. */
export function drawStation(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, ring: string, here: string | null, bold: boolean, scale: number) {
  const rr = Math.max(2.6, r * 0.6);
  ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU);
  ctx.fillStyle = fill; ctx.fill();
  ctx.lineWidth = (bold ? 2.4 : 1.6) / scale + rr * 0.14;
  ctx.strokeStyle = ring; ctx.stroke();
  if (here) {
    ctx.beginPath(); ctx.arc(x, y, rr + 4.5 / scale + rr * 0.18, 0, TAU);
    ctx.lineWidth = 2.2 / scale; ctx.strokeStyle = here; ctx.stroke();
  }
}
const STATION_STAMP_PX = 40;
/** A Metro station as a stamp (up to STATION_STAMP_PX on screen, no agent ring); false when drawStation must draw it. */
export function stampStation(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, ring: string, bold: boolean, scale: number, memo: StampMemo = {}, alpha = 1): boolean {
  const rr = Math.max(2.6, r * 0.6), R = rr * scale;
  if (R > STATION_STAMP_PX) return false;
  const b = bucket(R), fa = faded(alpha);
  let sp: Sprite | null | undefined = memo.s;
  if (!sp || memo.a !== fill || memo.b !== ring || memo.c !== b || memo.d !== bold || memo.e !== fa) {
    // The ring's width is in pixels plus a share of the station (drawStation): the same, measured on screen.
    const lw = (bold ? 2.4 : 1.6) + b * 0.14, half = b + lw / 2 + 1;
    sp = memo.s = sprite("s|" + fill + "|" + ring + "|" + (bold ? 1 : 0) + "|" + b + "|" + fa, half * 2, half * 2, half, half, (cx) => {
      cx.globalAlpha = fa;
      cx.beginPath(); cx.arc(half, half, b, 0, TAU);
      cx.fillStyle = fill; cx.fill();
      cx.lineWidth = lw; cx.strokeStyle = ring; cx.stroke();
    });
    memo.a = fill; memo.b = ring; memo.c = b; memo.d = bold; memo.e = fa;
  }
  if (!sp) return false;
  stamp(ctx, sp, x, y, (1 / scale) * (R / b), fa < 1);
  return true;
}

/** Where a marker stands by its file: just off the top-right (or around it, when several agents share it). Metro tracks run between these points. */
export const platform = (x: number, y: number, r: number, scale: number, angle = -Math.PI / 4) =>
  ({ x: x + Math.cos(angle) * (r + 11 / scale), y: y + Math.sin(angle) * (r + 11 / scale) });

/** Metro: a white casing under an agent's track, so it reads over the import lines it crosses (the caller strokes the track after). */
export function casing(ctx: CanvasRenderingContext2D, scale: number) {
  const { strokeStyle, lineWidth, globalAlpha } = ctx;
  ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = lineWidth + 3 / scale; ctx.globalAlpha = Math.min(1, globalAlpha * 1.4);
  ctx.stroke();
  ctx.strokeStyle = strokeStyle; ctx.lineWidth = lineWidth; ctx.globalAlpha = globalAlpha;
}

/** The corners of a metro track between two points: straight, then 45°, then straight. */
export function metroPoints(x1: number, y1: number, x2: number, y2: number): Pt2[] {
  const dx = x2 - x1, dy = y2 - y1, ax = Math.abs(dx), ay = Math.abs(dy);
  if (ax >= ay) { const h = ((ax - ay) / 2) * Math.sign(dx); return [[x1, y1], [x1 + h, y1], [x2 - h, y2], [x2, y2]]; }
  const v = ((ay - ax) / 2) * Math.sign(dy); return [[x1, y1], [x1, y1 + v], [x2, y2 - v], [x2, y2]];
}
export type Pt2 = [number, number];

/** The point a fraction k (0..1) of the way along a polyline, by length: an agent riding the track. */
export function along(pts: Pt2[], k: number): { x: number; y: number } {
  const seg: number[] = []; let total = 0;
  for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(d); total += d; }
  let left = Math.max(0, Math.min(1, k)) * total;
  for (let i = 1; i < pts.length; i++) {
    const d = seg[i - 1];
    if (left <= d || i === pts.length - 1) { const f = d ? Math.min(1, left / d) : 1; return { x: pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, y: pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f }; }
    left -= d;
  }
  return { x: pts[pts.length - 1][0], y: pts[pts.length - 1][1] };
}

/** The way between two points for a route, as a polyline: the marker rides it and the trail draws it.
 *  metro: straight, 45°, straight. elbow: along the longer axis, one right angle, like a corridor on a deck plan.
 *  hop: an arc that rises on screen and lands. glide: a straight line. */
export function routePoints(route: MapStyle["route"], x1: number, y1: number, x2: number, y2: number): Pt2[] {
  if (route === "metro") return metroPoints(x1, y1, x2, y2);
  if (route === "elbow") return Math.abs(x2 - x1) >= Math.abs(y2 - y1) ? [[x1, y1], [x2, y1], [x2, y2]] : [[x1, y1], [x1, y2], [x2, y2]];
  if (route === "hop") {
    const h = Math.hypot(x2 - x1, y2 - y1) * 0.32, cx = (x1 + x2) / 2, cy = (y1 + y2) / 2 - h, pts: Pt2[] = [];
    for (let i = 0; i <= 16; i++) { const k = i / 16, m = 1 - k; pts.push([m * m * x1 + 2 * m * k * cx + k * k * x2, m * m * y1 + 2 * m * k * cy + k * k * y2]); }
    return pts;
  }
  return [[x1, y1], [x2, y2]];
}

/** Starts a path along a polyline (the caller strokes it). */
export function polyPath(ctx: CanvasRenderingContext2D, pts: Pt2[]) {
  ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
}

/** The polyline from its start to a fraction k of its length. */
export function upTo(pts: Pt2[], k: number): Pt2[] {
  if (k >= 1) return pts;
  const end = along(pts, k), out: Pt2[] = [pts[0]];
  let total = 0; const seg: number[] = [];
  for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(d); total += d; }
  let left = k * total;
  for (let i = 1; i < pts.length && left > seg[i - 1]; i++) { out.push(pts[i]); left -= seg[i - 1]; }
  out.push([end.x, end.y]);
  return out;
}

/** A regular octagon around a circle (flat sides up, down and across), as a path: Metro's fare zones. */
export function octagonPath(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  const R = r * 1.03;   // its corners just past the circle, its sides just inside it (the packing leaves room)
  ctx.beginPath();
  for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + (i * Math.PI) / 4, px = x + Math.cos(a) * R, py = y + Math.sin(a) * R; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
  ctx.closePath();
}

/**
 * An agent's mark, of radius R (map units), in the theme's way (MapStyle.marker), with `text` (its letter, a replay's
 * step number) in the middle. disc: filled in its colour, ringed white. badge (Metro): white, ringed in its colour, the
 * letter in its colour, like an RER line's roundel. orb (Prism): a glowing ball of light, white at the heart. waypoint
 * (Hologram): a dark disc ringed in its colour, a broken ring around it and a locator triangle above.
 */
export function drawMarker(ctx: CanvasRenderingContext2D, x: number, y: number, R: number, color: string, text: string, fontPx: number, family: string, scale: number, st = mapStyle()) {
  const rgb = toRGB(color);
  ctx.save();
  if (st.marker === "orb") {
    const g = ctx.createRadialGradient(x, y, 0, x, y, R * 2.8);
    g.addColorStop(0, rgba(rgb, 0.55)); g.addColorStop(0.4, rgba(rgb, 0.22)); g.addColorStop(1, rgba(rgb, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, R * 2.8, 0, TAU); ctx.fill();
    const b = ctx.createRadialGradient(x - R * 0.2, y - R * 0.25, 0, x, y, R);
    b.addColorStop(0, "#ffffff"); b.addColorStop(0.5, rgba(mix(rgb, [255, 255, 255], 0.55), 1)); b.addColorStop(1, rgba(rgb, 1));
    ctx.fillStyle = b; ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.fill();
    ctx.fillStyle = st.markerText;
  } else if (st.marker === "badge") {
    ctx.shadowColor = "rgba(60,40,0,0.18)"; ctx.shadowBlur = 5; ctx.shadowOffsetY = 1;
    ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.fillStyle = "#fff"; ctx.fill();
    ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    ctx.lineWidth = 2.4 / scale; ctx.strokeStyle = color; ctx.stroke();
    ctx.fillStyle = color;
  } else if (st.marker === "waypoint") {
    ctx.shadowColor = color; ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.fillStyle = "rgba(8,20,30,0.94)"; ctx.fill();
    ctx.lineWidth = 1.8 / scale; ctx.strokeStyle = color; ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalAlpha *= 0.55; ctx.lineWidth = 1 / scale;   // the broken ring: four arcs
    for (let i = 0; i < 4; i++) { const a = (i * Math.PI) / 2 + 0.3; ctx.beginPath(); ctx.arc(x, y, R + 3.5 / scale, a, a + Math.PI / 2 - 0.6); ctx.stroke(); }
    ctx.globalAlpha /= 0.55;
    const ty = y - R - 5 / scale, w = 3.6 / scale;          // the locator: a small triangle pointing down at it
    ctx.beginPath(); ctx.moveTo(x - w, ty - w * 1.3); ctx.lineTo(x + w, ty - w * 1.3); ctx.lineTo(x, ty); ctx.closePath();
    ctx.fillStyle = color; ctx.fill();
    ctx.fillStyle = color;
  } else {
    ctx.shadowColor = st.glow ? color : "rgba(0,0,0,0.18)"; ctx.shadowBlur = st.glow ? 16 : 6; ctx.shadowOffsetY = st.glow ? 0 : 1;
    ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.fillStyle = color; ctx.fill();
    ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    ctx.lineWidth = 2 / scale; ctx.strokeStyle = st.markerStroke; ctx.stroke();
    ctx.fillStyle = st.markerText;
  }
  ctx.font = `700 ${fontPx / scale}px ${family}`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(text, x, y + 0.5 / scale);
  ctx.restore();
}

/** Prism's thinking: a ring of small glowing orbs turning slowly around the marker, like the console's menu. */
export function drawOrbRing(ctx: CanvasRenderingContext2D, x: number, y: number, R: number, color: string, alpha: number, t: number, scale: number) {
  const rgb = toRGB(color), n = 7, turn = t / 2600;
  ctx.save();
  for (let i = 0; i < n; i++) {
    const a = turn + (i * TAU) / n, px = x + Math.cos(a) * R, py = y + Math.sin(a) * R, s = 2.2 / scale;
    ctx.globalAlpha = alpha * (0.55 + 0.45 * Math.sin(t / 400 + i));
    const g = ctx.createRadialGradient(px, py, 0, px, py, s * 3);
    g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.3, rgba(rgb, 0.9)); g.addColorStop(1, rgba(rgb, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, s * 3, 0, TAU); ctx.fill();
  }
  ctx.restore();
}
const mix = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k].map(Math.round) as RGB;
const toRGB = (c: string): RGB => {
  if (c.startsWith("#")) { const h = c.slice(1), n = parseInt(h.length === 3 ? h.split("").map((x) => x + x).join("") : h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  return ((c.match(/\d+/g) ?? ["0", "0", "0"]).slice(0, 3).map(Number)) as RGB;
};

/** Files a marker just landed on (Prism: the cube spins up and flashes). Set by the agent and replay layers, read by the map. */
export const landings = new Map<string, number>();
export const LAND_MS = 520;
/** Forget landings that are over (the map only clears the ones it draws, and it doesn't draw files off screen). */
export function settleLandings(now = performance.now()) {
  for (const [id, t] of landings) if (now - t >= LAND_MS) landings.delete(id);
}

/**
 * The trip itself, drawn under the marker while it travels (p: 0..1 of the trip, e: the eased position on it).
 * Hologram: a dashed locator line projects ahead to the destination, then the marker follows it.
 * Prism: fading afterimages of the marker along the arc behind it.
 */
export function drawTrip(ctx: CanvasRenderingContext2D, route: MapStyle["route"], pts: Pt2[], p: number, e: number, color: string, r: number, alpha: number, scale: number) {
  if (p >= 1) return;
  ctx.save();
  if (route === "elbow") {
    ctx.setLineDash([6 / scale, 4 / scale]);
    ctx.lineDashOffset = -performance.now() / 40 / scale;          // dashes running toward the destination
    ctx.strokeStyle = color; ctx.lineWidth = 1.8 / scale; ctx.lineCap = "butt"; ctx.lineJoin = "miter";
    ctx.shadowColor = color; ctx.shadowBlur = 8;
    ctx.globalAlpha = alpha * 0.9 * Math.min(1, (1 - p) * 3);
    polyPath(ctx, upTo(pts, Math.min(1, p / 0.3))); ctx.stroke();  // reaches the destination in the first third of the trip
    const end = pts[pts.length - 1];
    if (p >= 0.3) { ctx.setLineDash([]); ctx.beginPath(); ctx.arc(end[0], end[1], 3 / scale, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill(); }
  } else if (route === "hop") {
    ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 10;
    for (let i = 1; i <= 3; i++) {
      const k = e - i * 0.07;
      if (k <= 0) break;
      const q = along(pts, k);
      ctx.globalAlpha = alpha * (0.32 - i * 0.08);
      ctx.beginPath(); ctx.arc(q.x, q.y, r * (1 - i * 0.12), 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
}

/** How long a trip takes: a bent route is longer than a glide, so it gets a little more time; a fast replay shortens it so the marker arrives before the next step. */
const TRIP: Record<MapStyle["route"], number> = { glide: 1, metro: 1.45, elbow: 1.35, hop: 1.2 };
export const tripMs = (route: MapStyle["route"], glideMs: number, speed = 1) => (glideMs * TRIP[route]) / Math.max(1, speed);
