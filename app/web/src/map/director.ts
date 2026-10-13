// The director: what the camera frames and when, as plain maths (useMapCamera.ts runs it). It frames the work, not a
// point: the area of the working agents' last few edits (a replay: the marker and its next few moves), with a margin,
// at a zoom chosen from how spread out they are. It holds still while what it frames stays in the middle of the view
// (the dead zone), glides for a short move and cuts for a long one. Reads never count: the markers stand on edits.
import { centerFor, type Box, type Safe, type View } from "./camera";

export type P = { x: number; y: number };

export const DIRECTOR = {
  /** The middle part of the safe area (each way) the framed markers may wander in before the camera moves. */
  dead: 0.6,
  /** The part of the safe area (each way) a framing fills: smaller than the dead zone, so the next edit next door still
   *  lands inside it without a move. */
  fit: 0.42,
  /** The zoom range: never closer than the files' names need, never so far that the work is specks. */
  minK: 0.9, maxK: 2.2,
  /** Graph units around a lone point: one agent on one file still gets its neighbourhood. */
  around: 60,
  /** A move longer than this many safe-area diagonals (on screen, at the current zoom) is a cut, not a glide. */
  cut: 1.2,
  /** The view is that much wider (a factor) than the spread wants (the work is specks): move even when the markers are in
   *  the dead zone. Closer than it wants never moves by itself: a marker leaving the dead zone does. */
  zoomOff: 2.2,
  /** Look-ahead in a replay: at most this many moves after the marker's. */
  ahead: 6,
};

/** The bounding box of points, or null. */
export function boxOfPts(pts: Iterable<P>): Box | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
  }
  return x0 === Infinity ? null : { x0, y0, x1, y1 };
}

/** The middle of the safe area the director frames into, in screen pixels: `frac` of it each way. */
function middle(s: Safe, frac: number) {
  const w = Math.max(60, s.w - s.left - s.right), h = Math.max(60, s.h - s.top - s.bottom);
  return { w: w * frac, h: h * frac };
}

/** Zoom by spread: the zoom that fits `box` (grown to a neighbourhood at least) in the framing (`fit`), within min/max. */
export function zoomForSpread(box: Box, s: Safe, o = DIRECTOR): number {
  const m = middle(s, o.fit);
  const bw = Math.max(2 * o.around, box.x1 - box.x0), bh = Math.max(2 * o.around, box.y1 - box.y0);
  return Math.max(o.minK, Math.min(o.maxK, m.w / bw, m.h / bh));
}
/** The zoom the box would need, unclamped (to tell whether it fits at all). */
function rawZoom(box: Box, s: Safe, o = DIRECTOR) {
  const m = middle(s, o.fit);
  return Math.min(m.w / Math.max(2 * o.around, box.x1 - box.x0), m.h / Math.max(2 * o.around, box.y1 - box.y0));
}

/**
 * The area to frame: every group's points together (each group an agent's last few edits, newest last), or, when they
 * are too far apart to fit at the least zoom, only the group of the agent that edited last (`latest`).
 */
export function frameArea(groups: P[][], latest: number, s: Safe, o = DIRECTOR): Box | null {
  const all = boxOfPts(groups.flat());
  if (!all) return null;
  if (groups.length < 2 || rawZoom(all, s, o) >= o.minK) return all;
  return boxOfPts(groups[Math.max(0, Math.min(groups.length - 1, latest))] ?? []) ?? all;
}

/** The view that frames `box`: centred in the safe area, zoom by spread. */
export function viewFor(box: Box, s: Safe, o = DIRECTOR): View {
  const k = zoomForSpread(box, s, o);
  return { ...centerFor(s, (box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2, k), k };
}

/** Where graph point p falls on screen (CSS pixels from the canvas's top left) at view v. */
export const toScreen = (v: View, s: Safe, p: P) => ({ x: s.w / 2 + (p.x - v.x) * v.k, y: s.h / 2 + (p.y - v.y) * v.k });

/** Whether every point is inside the dead zone: the middle `dead` of the safe area. */
export function inDeadZone(v: View, s: Safe, pts: P[], o = DIRECTOR): boolean {
  const m = middle(s, o.dead);
  const cx = s.left + (s.w - s.left - s.right) / 2, cy = s.top + (s.h - s.top - s.bottom) / 2;
  return pts.every((p) => { const q = toScreen(v, s, p); return Math.abs(q.x - cx) <= m.w / 2 && Math.abs(q.y - cy) <= m.h / 2; });
}

/** Whether the camera should move: a marker left the dead zone, or the view is far wider than the spread wants. */
export function shouldMove(v: View, s: Safe, markers: P[], want: View, o = DIRECTOR): boolean {
  if (!markers.length) return false;
  if (!inDeadZone(v, s, markers, o)) return true;
  return v.k * o.zoomOff < want.k;
}

/** A long jump (cut) or a short one (glide): how far the middle travels on screen, and how much the zoom changes. */
export function isCut(from: View, to: View, s: Safe, o = DIRECTOR): boolean {
  const diag = Math.hypot(s.w - s.left - s.right, s.h - s.top - s.bottom);
  const k = Math.min(from.k, to.k);
  return Math.hypot(to.x - from.x, to.y - from.y) * k > o.cut * diag || Math.max(from.k / to.k, to.k / from.k) > 3;
}

/**
 * Look-ahead: from the marker's place and the next moves (in order), the run that fits in one framing at a zoom of at
 * least `minK`: the camera moves once for it, and the marker walks through it. At least the marker's own place.
 */
export function groupAhead(pts: P[], s: Safe, o = DIRECTOR): P[] {
  const out: P[] = [];
  for (const p of pts.slice(0, o.ahead + 1)) {
    const next = [...out, p], box = boxOfPts(next);
    if (out.length && (!box || rawZoom(box, s, o) < o.minK)) break;
    out.push(p);
  }
  return out;
}
