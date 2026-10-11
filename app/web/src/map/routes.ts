// The ways agents travel between files in each theme's route (themes.ts MapStyle.route): Metro's track (straight, 45°,
// straight, on a casing), Prism's hop (an arc), a plain glide; where a marker stands by its file (platform), riding a
// polyline (along, upTo), Metro's fare zones (octagonPath), a trip's afterimages and how long it takes. Moved out of themes.ts.
import { mapStyle, type MapStyle } from "./themes";

/** Where a marker stands by its file: just off the top-right (or around it, when several agents share it). Metro tracks run between these points. */
export const platform = (x: number, y: number, r: number, scale: number, angle = -Math.PI / 4) =>
  ({ x: x + Math.cos(angle) * (r + 11 / scale), y: y + Math.sin(angle) * (r + 11 / scale) });

/** A casing under an agent's metro track, in the theme's outline colour (paper in Metro, the dark room in Hologram), so it
 *  reads over the lines it crosses (the caller strokes the track after). */
export function casing(ctx: CanvasRenderingContext2D, scale: number) {
  const { strokeStyle, lineWidth, globalAlpha } = ctx;
  ctx.strokeStyle = mapStyle().halo; ctx.lineWidth = lineWidth + 3 / scale; ctx.globalAlpha = Math.min(1, globalAlpha * 1.4);
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
 *  metro: straight, 45°, straight.
 *  hop: an arc that rises on screen and lands. glide: a straight line. */
export function routePoints(route: MapStyle["route"], x1: number, y1: number, x2: number, y2: number): Pt2[] {
  if (route === "metro") return metroPoints(x1, y1, x2, y2);
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
 * The trip itself, drawn under the marker while it travels (p: 0..1 of the trip, e: the eased position on it).
 * Prism: fading afterimages of the marker along the arc behind it.
 */
export function drawTrip(ctx: CanvasRenderingContext2D, route: MapStyle["route"], pts: Pt2[], p: number, e: number, color: string, r: number, alpha: number, _scale: number) {
  if (p >= 1) return;
  ctx.save();
  if (route === "hop") {
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
const TRIP: Record<MapStyle["route"], number> = { glide: 1, metro: 1.45, hop: 1.2 };
export const tripMs = (route: MapStyle["route"], glideMs: number, speed = 1) => (glideMs * TRIP[route]) / Math.max(1, speed);
