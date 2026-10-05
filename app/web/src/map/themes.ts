// Owned by the lead. How each map theme draws on the canvas: files, imports, labels and agent markers.
// Colours that also style the chrome (recency, accent) come from CSS variables set per theme in themes.css;
// this file holds what CSS can't reach. The current theme is read on every frame (getTheme()).
import { getTheme, type ThemeId } from "../lib/theme";
import { bucket, faded, sprite, stamp, type Sprite, type StampMemo } from "./sprites";

export type RGB = [number, number, number];

export type MapStyle = {
  /** How a file is drawn: a dot, a turning glass cube, a hologram floor plate or a metro station. */
  node: "dot" | "cube" | "plate" | "station";
  /** Imports: plain lines, or metro lines (horizontal, vertical and 45°, coloured by folder). */
  link: "line" | "metro";
  halo: string; fileInk: string; fileInkQuiet: string;
  moduleInk: string; moduleInkLively: string; moduleFont?: string; labelFont?: string;
  /** Metro: folder names in their line's colour. */
  moduleColored?: boolean;
  linkIdle: string; linkDim: string; imports: string; usedBy: string;
  markerStroke: string; markerText: string; glow: boolean;
  /** How an agent travels between files, and the shape of the trail it leaves (see routePoints):
   *  a straight glide (trails curve softly), metro track, a locator line with one right angle, or a hop in an arc. */
  route: "glide" | "metro" | "elbow" | "hop";
  /** Metro: the agent's own line (the main thread and a replay), in a colour no folder line can take. Others use the accent. */
  track?: string;
  /** Subagent colours (main threads take the theme's accent). */
  palette: string[];
  /** How far a file's mark reaches from its centre, in radii: idle, and with an agent on it (its ring, its bigger cube).
   *  The layout keeps this clear between files and labels stay out of it (see reachOf). */
  reach: [number, number];
};

const BASE: MapStyle = {
  node: "dot", link: "line",
  halo: "rgba(251,251,253,0.9)", fileInk: "#1d1d1f", fileInkQuiet: "rgba(29,29,31,0.62)",
  moduleInk: "rgba(29,29,31,0.2)", moduleInkLively: "rgba(29,29,31,0.34)",
  linkIdle: "rgba(29,29,31,0.08)", linkDim: "rgba(29,29,31,0.04)",
  imports: "rgba(91,91,214,0.7)", usedBy: "rgba(15,157,138,0.7)",
  markerStroke: "#fff", markerText: "#fff", glow: false, route: "glide",
  palette: ["#2f7ae5", "#0f9d8a", "#c2409a", "#7c4dde", "#2e9e4f", "#0b8fb3", "#b5487a", "#4a6fa5"],
  reach: [1, 1.2],                       // a dot; the active outline sits 3.5px out
};

const STYLES: Record<ThemeId, MapStyle> = {
  default: BASE,
  metro: {
    ...BASE, node: "station", link: "metro", moduleColored: true, route: "metro", track: "#1d1d1f",
    halo: "rgba(255,255,255,0.95)", moduleInk: "rgba(29,29,31,0.55)", moduleInkLively: "rgba(29,29,31,0.8)",
    reach: [0.72, 1.1],                  // a station is 0.6r plus its ring; an agent adds one more ring
  },
  ps2: {
    ...BASE, node: "cube", route: "hop",
    halo: "rgba(22,22,52,0.85)", fileInk: "#f0f2ff", fileInkQuiet: "rgba(215,222,255,0.62)",
    moduleInk: "rgba(205,210,255,0.26)", moduleInkLively: "rgba(242,227,106,0.75)",
    moduleFont: `"Arial Rounded MT Bold", "Nunito", system-ui, sans-serif`, labelFont: `"Arial Rounded MT Bold", "Nunito", system-ui, sans-serif`,
    linkIdle: "rgba(120,160,255,0.16)", linkDim: "rgba(120,160,255,0.05)",
    imports: "rgba(242,227,106,0.9)", usedBy: "rgba(140,200,255,0.9)",
    markerStroke: "rgba(255,255,255,0.95)", markerText: "#1b1b40", glow: true,
    palette: ["#8fb4ff", "#7ee0ff", "#ff9ff3", "#c7a6ff", "#9dffb0", "#ffe08a", "#ffb38a", "#a6f0ff"],
    reach: [1.25, 1.95],                 // a turning cube's corners (0.78r, tilted); active: 1.3x and the floor ring
  },
  deadspace: {
    ...BASE, node: "plate", route: "elbow",
    halo: "rgba(8,14,16,0.9)", fileInk: "#dcf6f8", fileInkQuiet: "rgba(160,205,215,0.6)",
    moduleInk: "rgba(143,233,240,0.28)", moduleInkLively: "rgba(143,233,240,0.7)",
    moduleFont: `"Arial Narrow", "Helvetica Neue", sans-serif`, labelFont: `"Arial Narrow", "Helvetica Neue", sans-serif`,
    linkIdle: "rgba(120,170,180,0.16)", linkDim: "rgba(120,170,180,0.05)",
    imports: "rgba(95,227,224,0.9)", usedBy: "rgba(57,231,95,0.85)",
    markerStroke: "#0b1214", markerText: "#0b1214", glow: true,
    palette: ["#5fe3e0", "#7cc8ff", "#b6f0ff", "#9ef7c8", "#3fc1c9", "#8fe9f0", "#6fd3a8", "#a3d8ff"],
    reach: [1.2, 2.05],                  // a plate is 1.17r wide; active: the projected square around it
  },
};

export const mapStyle = (): MapStyle => STYLES[getTheme()];

/** How far a file of radius r reaches on the canvas in this theme (graph units, never under 4: the smallest station). */
export const reachOf = (r: number, active = false, st = mapStyle()) => Math.max(4, r * st.reach[active ? 1 : 0]);

/** A folder's line colour (Metro): stable per folder name (memoized: it's asked for by every import line, every frame). */
const moduleColors = new Map<string, string>();
export function moduleColor(m: string): string {
  let c = moduleColors.get(m);
  if (c) return c;
  let h = 0;
  for (let i = 0; i < m.length; i++) h = (h * 31 + m.charCodeAt(i)) >>> 0;
  c = `hsl(${(h * 137.508) % 360}, 68%, 46%)`;
  moduleColors.set(m, c);
  return c;
}

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

// ---------- PS2: a glass cube, turning slowly ----------
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
 * A PS2 cube, the quick way: a stamp of its glow and one of its body at the nearest of 32 angles, for every cube up to
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

// ---------- Dead Space: a floor plate, seen from above at an angle ----------
function plateBody(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, c: RGB, lit: boolean, scale: number) {
  const rx = r * 1.3, ry = r * 0.72, depth = Math.max(r * 0.35, 2.5 / scale);
  ctx.fillStyle = "rgba(16,24,26,0.95)";
  ctx.beginPath(); ctx.ellipse(x, y + depth, rx, ry, 0, 0, TAU); ctx.fill();
  ctx.fillRect(x - rx, y, rx * 2, depth);
  ctx.fillStyle = lit ? rgba(c, 0.85) : "rgba(92,108,112,0.92)";
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = lit ? rgba(c, 1) : "rgba(150,190,198,0.35)"; ctx.lineWidth = 1 / scale; ctx.stroke();
  if (lit) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, rx * 2.2);
    g.addColorStop(0, rgba(c, 0.28)); g.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rx * 2.2, 0, TAU); ctx.fill();
  }
}
export function drawPlate(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, c: RGB, lit: boolean, scale: number, here: string | null = null) {
  if (here) { // where an agent is: one holographic square projected on the floor around the plate
    const qx = r * 1.3 * 1.75 + 5 / scale, qy = r * 0.72 * 1.75 + 3 / scale;
    ctx.save();
    ctx.beginPath(); ctx.moveTo(x - qx, y); ctx.lineTo(x, y - qy); ctx.lineTo(x + qx, y); ctx.lineTo(x, y + qy); ctx.closePath();
    ctx.strokeStyle = here; ctx.lineWidth = 1.5 / scale; ctx.shadowColor = here; ctx.shadowBlur = 10; ctx.stroke();
    ctx.restore();
  }
  plateBody(ctx, x, y, r, c, lit, scale);
}
const PLATE_STAMP_PX = 40;
/** A Dead Space plate as a stamp (up to PLATE_STAMP_PX on screen, no agent square); false when drawPlate must draw it. */
export function stampPlate(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, c: RGB, css: string, lit: boolean, scale: number, memo: StampMemo = {}, alpha = 1): boolean {
  const R = r * scale;
  if (R > PLATE_STAMP_PX) return false;
  const b = bucket(R), key = lit ? css : "", fa = faded(alpha);
  let sp: Sprite | null | undefined = memo.s;
  if (!sp || memo.a !== key || memo.c !== b || memo.e !== fa) {
    const rx = b * 1.3, ry = b * 0.72, depth = Math.max(b * 0.35, 2.5);
    const half = lit ? rx * 2.2 : rx + 1, top = lit ? rx * 2.2 : ry + 1, h = top + Math.max(lit ? rx * 2.2 : 0, depth + ry + 1);
    sp = memo.s = sprite("p|" + key + "|" + b + "|" + fa, half * 2, h, half, top, (cx) => { cx.globalAlpha = fa; plateBody(cx, half, top, b, c, lit, 1); });
    memo.a = key; memo.c = b; memo.e = fa;
  }
  if (!sp) return false;
  stamp(ctx, sp, x, y, (1 / scale) * (R / b), fa < 1);
  return true;
}

// ---------- Metro: a station, and imports as transit lines ----------
/** A station: an ink ring, filled with the recency colour once the file changed (white while quiet).
 *  Where an agent is: one more ring, in the "just now" colour. Nothing else is drawn around a station. */
export function drawStation(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, ring: string, here: string | null, bold: boolean, scale: number) {
  const rr = Math.max(2.6, r * 0.6);
  ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU);
  ctx.fillStyle = fill; ctx.fill();
  ctx.lineWidth = (bold ? 2.4 : 1.6) / scale + rr * 0.18;
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
    const lw = (bold ? 2.4 : 1.6) + b * 0.18, half = b + lw / 2 + 1;
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

/** Starts a path along a metro track (the caller strokes it). */
export function metroPath(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  ctx.beginPath();
  metroSegment(ctx, x1, y1, x2, y2);
}

/** Adds a metro track to the current path, the corners of metroPoints without building them: many tracks share one stroke. */
export function metroSegment(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1, dy = y2 - y1, ax = Math.abs(dx), ay = Math.abs(dy);
  ctx.moveTo(x1, y1);
  if (ax >= ay) { const h = ((ax - ay) / 2) * Math.sign(dx); ctx.lineTo(x1 + h, y1); ctx.lineTo(x2 - h, y2); }
  else { const v = ((ay - ax) / 2) * Math.sign(dy); ctx.lineTo(x1, y1 + v); ctx.lineTo(x2, y2 - v); }
  ctx.lineTo(x2, y2);
}

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
function upTo(pts: Pt2[], k: number): Pt2[] {
  if (k >= 1) return pts;
  const end = along(pts, k), out: Pt2[] = [pts[0]];
  let total = 0; const seg: number[] = [];
  for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(d); total += d; }
  let left = k * total;
  for (let i = 1; i < pts.length && left > seg[i - 1]; i++) { out.push(pts[i]); left -= seg[i - 1]; }
  out.push([end.x, end.y]);
  return out;
}

/** Files a marker just landed on (PS2: the cube spins up and flashes). Set by the agent and replay layers, read by the map. */
export const landings = new Map<string, number>();
export const LAND_MS = 520;
/** Forget landings that are over (the map only clears the ones it draws, and it doesn't draw files off screen). */
export function settleLandings(now = performance.now()) {
  for (const [id, t] of landings) if (now - t >= LAND_MS) landings.delete(id);
}

/**
 * The trip itself, drawn under the marker while it travels (p: 0..1 of the trip, e: the eased position on it).
 * Dead Space: a dashed locator line projects ahead to the destination, then the marker follows it.
 * PS2: fading afterimages of the marker along the arc behind it.
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
