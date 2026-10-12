// The tracer, shared by the three layers that draw one: the live agents (agents.tsx), the replay's marker
// (thread/ThreadLayer.ts) and the places map's marker (places/PlacesMap.tsx). A marker glides from stop to stop along the
// theme's route, leaves a trail of segments behind it, and rings: a pulse on activity, a red ring on a failure, a slow
// breath while it thinks. One copy of the timings and the strokes, so a theme's look reaches every layer.
import type { MapStyle } from "./themes";
import { along, casing, polyPath, routePoints, tripMs, type Pt2 } from "./routes";
import { ease } from "./util";

export const GLIDE_MS = 650;       // a marker's glide from one stop to the next (at 1×)
export const THINK_MS = 2400;      // the thinking ring's breath
export const PULSE_MS = 700;       // the pulse on an edit (the replay's marker) or activity (a live agent)
export const ERR_PULSE_MS = 1100;  // the red ring on a failed tool call
export const ERROR_RED = "#d93025";

type Route = MapStyle["route"];
/** A marker on its way: where it is, where it set off from and when; the trip whose landing was announced. */
export type Glider = { x: number; y: number; fromX: number; fromY: number; t0: number; landedT0?: number };

/** Set off toward a new stop from where the marker stands now. */
export function setOff(g: Glider, t: number) { g.fromX = g.x; g.fromY = g.y; g.t0 = t; }

/**
 * One frame of a glide toward (tx, ty): moves the marker along the theme's route (eased) and returns how far the trip
 * is (`p`, and `e` eased) and, while a routed trip is under way, its points (for drawTrip). Prism's hop announces its
 * landing once per trip (`onLand`: the cube it lands on spins up).
 */
export function glide(g: Glider, tx: number, ty: number, t: number, route: Route, speed = 1, onLand?: () => void) {
  const p = Math.min(1, (t - g.t0) / tripMs(route, GLIDE_MS, speed)), e = ease(p);
  const trip: Pt2[] | null = p < 1 && route !== "glide" ? routePoints(route, g.fromX, g.fromY, tx, ty) : null;
  if (trip) { const q = along(trip, e); g.x = q.x; g.y = q.y; }  // ride the route
  else { g.x = g.fromX + (tx - g.fromX) * e; g.y = g.fromY + (ty - g.fromY) * e; }
  if (route === "hop" && p >= 1 && g.t0 > 0 && g.landedT0 !== g.t0) { g.landedT0 = g.t0; onLand?.(); }
  return { p, e, trip };
}

/** The path of one trail segment, ready to stroke: the theme's route (Metro: bent, with its casing), else a soft curve. */
export function trailPath(ctx: CanvasRenderingContext2D, a: { x: number; y: number }, b: { x: number; y: number }, route: Route, scale: number) {
  if (route !== "glide") { polyPath(ctx, routePoints(route, a.x, a.y, b.x, b.y)); if (route === "metro") casing(ctx, scale); }  // the way it went
  else {
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, dx = b.x - a.x, dy = b.y - a.y;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(mx - dy * 0.15, my + dx * 0.15, b.x, b.y);
  }
}

/** A ring that grows and fades over a moment (p: 0..1 of it): from r0 to r0 + grow screen pixels, `alpha` at the start. */
export function drawPulse(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, r0: number, grow: number, color: string, width: number, alpha: number, scale: number) {
  if (p < 0 || p >= 1) return;
  ctx.globalAlpha = alpha * (1 - p);
  ctx.beginPath(); ctx.arc(x, y, (r0 + p * grow) / scale, 0, Math.PI * 2);
  ctx.strokeStyle = color; ctx.lineWidth = width / scale; ctx.stroke();
}

/** The thinking ring: a slow breath in the marker's colour, swelling and fading (`alpha` at its strongest). */
export function drawThinkRing(ctx: CanvasRenderingContext2D, x: number, y: number, t: number, color: string, alpha: number, scale: number) {
  const b = (t % THINK_MS) / THINK_MS;
  ctx.globalAlpha = alpha * Math.sin(b * Math.PI) * 0.7;
  ctx.beginPath(); ctx.arc(x, y, (11 + b * 9) / scale, 0, Math.PI * 2);
  ctx.strokeStyle = color; ctx.lineWidth = 2 / scale; ctx.stroke();
}
