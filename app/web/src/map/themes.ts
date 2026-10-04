// Owned by the lead. How each map theme draws on the canvas: files, imports, labels and agent markers.
// Colours that also style the chrome (recency, accent) come from CSS variables set per theme in themes.css;
// this file holds what CSS can't reach. The current theme is read on every frame (getTheme()).
import { getTheme, type ThemeId } from "../lib/theme";

export type RGB = [number, number, number];

export type MapStyle = {
  /** How a file is drawn: a dot, a turning glass cube, a hologram floor plate or a metro station. */
  node: "dot" | "cube" | "plate" | "station" | "mark";
  /** Imports: plain lines, or metro lines (horizontal, vertical and 45°, coloured by folder). */
  link: "line" | "metro";
  halo: string; fileInk: string; fileInkQuiet: string;
  moduleInk: string; moduleInkLively: string; moduleFont?: string; labelFont?: string;
  /** Metro: folder names in their line's colour. */
  moduleColored?: boolean;
  /** Folder names in capitals, spaced out (technical callouts). */
  moduleUpper?: boolean;
  linkIdle: string; linkDim: string; imports: string; usedBy: string;
  markerStroke: string; markerText: string; glow: boolean;
  /** Agent trails: soft curves, or right angles like a locator line. */
  trail: "curve" | "elbow";
  /** Subagent colours (main threads take the theme's accent). */
  palette: string[];
};

const BASE: MapStyle = {
  node: "dot", link: "line",
  halo: "rgba(251,251,253,0.9)", fileInk: "#1d1d1f", fileInkQuiet: "rgba(29,29,31,0.62)",
  moduleInk: "rgba(29,29,31,0.2)", moduleInkLively: "rgba(29,29,31,0.34)",
  linkIdle: "rgba(29,29,31,0.08)", linkDim: "rgba(29,29,31,0.04)",
  imports: "rgba(91,91,214,0.7)", usedBy: "rgba(15,157,138,0.7)",
  markerStroke: "#fff", markerText: "#fff", glow: false, trail: "curve",
  palette: ["#2f7ae5", "#0f9d8a", "#c2409a", "#7c4dde", "#2e9e4f", "#0b8fb3", "#b5487a", "#4a6fa5"],
};

const STYLES: Record<ThemeId, MapStyle> = {
  default: BASE,
  metro: {
    ...BASE, node: "station", link: "metro", moduleColored: true,
    halo: "rgba(255,255,255,0.95)", moduleInk: "rgba(29,29,31,0.55)", moduleInkLively: "rgba(29,29,31,0.8)",
  },
  ps2: {
    ...BASE, node: "cube",
    halo: "rgba(22,22,52,0.85)", fileInk: "#f0f2ff", fileInkQuiet: "rgba(215,222,255,0.62)",
    moduleInk: "rgba(205,210,255,0.26)", moduleInkLively: "rgba(242,227,106,0.75)",
    moduleFont: `"Arial Rounded MT Bold", "Nunito", system-ui, sans-serif`, labelFont: `"Arial Rounded MT Bold", "Nunito", system-ui, sans-serif`,
    linkIdle: "rgba(120,160,255,0.16)", linkDim: "rgba(120,160,255,0.05)",
    imports: "rgba(242,227,106,0.9)", usedBy: "rgba(140,200,255,0.9)",
    markerStroke: "rgba(255,255,255,0.95)", markerText: "#1b1b40", glow: true,
    palette: ["#8fb4ff", "#7ee0ff", "#ff9ff3", "#c7a6ff", "#9dffb0", "#ffe08a", "#ffb38a", "#a6f0ff"],
  },
  marathon: {
    ...BASE, node: "mark", moduleUpper: true,
    halo: "rgba(232,234,238,0.94)", fileInk: "#111", fileInkQuiet: "rgba(17,17,17,0.55)",
    moduleInk: "rgba(17,17,17,0.38)", moduleInkLively: "#111",
    moduleFont: `ui-monospace, "SF Mono", Menlo, monospace`, labelFont: `ui-monospace, "SF Mono", Menlo, monospace`,
    linkIdle: "rgba(17,17,17,0.1)", linkDim: "rgba(17,17,17,0.04)",
    imports: "rgba(123,108,255,0.9)", usedBy: "rgba(0,184,138,0.9)",
    markerStroke: "#e8eaee", markerText: "#fff",
    palette: ["#7b6cff", "#00b88a", "#ff5a36", "#2f7ae5", "#b04fd6", "#0aa2c0", "#e0a400", "#5b6170"],
  },
  deadspace: {
    ...BASE, node: "plate", trail: "elbow",
    halo: "rgba(8,14,16,0.9)", fileInk: "#dcf6f8", fileInkQuiet: "rgba(160,205,215,0.6)",
    moduleInk: "rgba(143,233,240,0.28)", moduleInkLively: "rgba(143,233,240,0.7)",
    moduleFont: `"Arial Narrow", "Helvetica Neue", sans-serif`, labelFont: `"Arial Narrow", "Helvetica Neue", sans-serif`,
    linkIdle: "rgba(120,170,180,0.16)", linkDim: "rgba(120,170,180,0.05)",
    imports: "rgba(95,227,224,0.9)", usedBy: "rgba(57,231,95,0.85)",
    markerStroke: "#0b1214", markerText: "#0b1214", glow: true,
    palette: ["#5fe3e0", "#7cc8ff", "#b6f0ff", "#9ef7c8", "#3fc1c9", "#8fe9f0", "#6fd3a8", "#a3d8ff"],
  },
};

export const mapStyle = (): MapStyle => STYLES[getTheme()];

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
export function drawCube(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, angle: number, c: RGB, glow: boolean, scale: number) {
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
export function drawPlate(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, c: RGB, lit: boolean, scale: number) {
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

// ---------- Marathon: a crisp square mark with crosshair ticks ----------
export function drawMark(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, c: RGB, lit: boolean, hot: boolean, scale: number) {
  const s = Math.max(2.4, r * 0.62), px = 1 / scale;
  ctx.fillStyle = `rgb(${c.join(",")})`;
  ctx.fillRect(x - s, y - s, s * 2, s * 2);
  ctx.lineWidth = 1.1 * px; ctx.strokeStyle = "#111";
  ctx.strokeRect(x - s, y - s, s * 2, s * 2);
  if (lit) {                                   // crosshair ticks out of each side
    const a = s + 2.5 * px, b = s + 6.5 * px;
    ctx.beginPath();
    ctx.moveTo(x - b, y); ctx.lineTo(x - a, y); ctx.moveTo(x + a, y); ctx.lineTo(x + b, y);
    ctx.moveTo(x, y - b); ctx.lineTo(x, y - a); ctx.moveTo(x, y + a); ctx.lineTo(x, y + b);
    ctx.stroke();
  }
  if (hot) {                                   // a small "+" glyph, top right
    const gx = x + s + 5 * px, gy = y - s - 5 * px, g = 3 * px;
    ctx.lineWidth = 1.6 * px; ctx.beginPath(); ctx.moveTo(gx - g, gy); ctx.lineTo(gx + g, gy); ctx.moveTo(gx, gy - g); ctx.lineTo(gx, gy + g); ctx.stroke();
  }
}

// ---------- Metro: a station, and imports as transit lines ----------
export function drawStation(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, ring: string, bold: boolean, scale: number) {
  const rr = Math.max(2.6, r * 0.6);
  ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU);
  ctx.fillStyle = "#fff"; ctx.fill();
  ctx.lineWidth = (bold ? 2.6 : 1.7) / scale + rr * 0.18;
  ctx.strokeStyle = ring; ctx.stroke();
}

/** The path a metro line takes between two stations: straight, then 45°, then straight. */
export function metroPath(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1, dy = y2 - y1, ax = Math.abs(dx), ay = Math.abs(dy);
  ctx.beginPath(); ctx.moveTo(x1, y1);
  if (ax >= ay) { const h = ((ax - ay) / 2) * Math.sign(dx); ctx.lineTo(x1 + h, y1); ctx.lineTo(x2 - h, y2); }
  else { const v = ((ay - ax) / 2) * Math.sign(dy); ctx.lineTo(x1, y1 + v); ctx.lineTo(x2, y2 - v); }
  ctx.lineTo(x2, y2);
}
