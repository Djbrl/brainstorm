// Owned by the lead. How each map theme draws on the canvas: files, imports, labels and agent markers.
// Colours that also style the chrome (recency, accent) come from CSS variables set per theme in themes.css;
// this file holds what CSS can't reach. The current theme is read on every frame (getTheme()).
import { getTheme, type ThemeId } from "../lib/theme";

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

/** A folder's line colour (Metro): stable per folder name. */
export function moduleColor(m: string): string {
  let h = 0;
  for (let i = 0; i < m.length; i++) h = (h * 31 + m.charCodeAt(i)) >>> 0;
  return `hsl(${(h * 137.508) % 360}, 68%, 46%)`;
}

const TAU = Math.PI * 2;
const rgba = ([r, g, b]: RGB, a: number) => `rgba(${r},${g},${b},${a})`;

// ---------- PS2: a glass cube, turning slowly ----------
const CUBE_V: RGB[] = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
const CUBE_F = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [0, 3, 7, 4]];
export function drawCube(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, angle: number, c: RGB, glow: boolean, scale: number, here: string | null = null) {
  if (here) { // where an agent is: one glowing ring on the floor under the cube
    ctx.save();
    ctx.beginPath(); ctx.ellipse(x, y + s * 1.35, s * 1.9, s * 0.62, 0, 0, TAU);
    ctx.strokeStyle = here; ctx.lineWidth = 1.8 / scale; ctx.shadowColor = here; ctx.shadowBlur = 12; ctx.stroke();
    ctx.restore();
  }
  if (glow) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, s * 3.6);
    g.addColorStop(0, rgba(c, 0.45)); g.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, s * 3.6, 0, TAU); ctx.fill();
  }
  const ca = Math.cos(angle), sa = Math.sin(angle), cb = Math.cos(0.55), sb = Math.sin(0.55);
  const pv = CUBE_V.map(([a, b, d]) => {
    const x1 = a * ca - d * sa, z1 = a * sa + d * ca, y1 = b * cb - z1 * sb, z2 = b * sb + z1 * cb;
    return [x + x1 * s, y + y1 * s, z2] as RGB;
  });
  ctx.lineWidth = 0.9 / scale;
  CUBE_F.map((f) => ({ f, z: f.reduce((m, i) => m + pv[i][2], 0) / 4 })).sort((a, b) => b.z - a.z).forEach(({ f, z }) => {
    ctx.beginPath();
    f.forEach((i, n) => (n ? ctx.lineTo(pv[i][0], pv[i][1]) : ctx.moveTo(pv[i][0], pv[i][1])));
    ctx.closePath();
    ctx.fillStyle = rgba(c, 0.2 + (1 - z) * 0.12); ctx.fill();
    ctx.strokeStyle = `rgba(232,240,255,${0.38 + (1 - z) * 0.25})`; ctx.stroke();
  });
}

// ---------- Dead Space: a floor plate, seen from above at an angle ----------
export function drawPlate(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, c: RGB, lit: boolean, scale: number, here: string | null = null) {
  const rx = r * 1.3, ry = r * 0.72, depth = Math.max(r * 0.35, 2.5 / scale);
  if (here) { // where an agent is: one holographic square projected on the floor around the plate
    const qx = rx * 1.75 + 5 / scale, qy = ry * 1.75 + 3 / scale;
    ctx.save();
    ctx.beginPath(); ctx.moveTo(x - qx, y); ctx.lineTo(x, y - qy); ctx.lineTo(x + qx, y); ctx.lineTo(x, y + qy); ctx.closePath();
    ctx.strokeStyle = here; ctx.lineWidth = 1.5 / scale; ctx.shadowColor = here; ctx.shadowBlur = 10; ctx.stroke();
    ctx.restore();
  }
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
  polyPath(ctx, metroPoints(x1, y1, x2, y2));
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
