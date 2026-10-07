// Owner: camera. The part of a map canvas that no panel covers (the "safe area"), and camera moves that land in it.
// The sidebar on the left, a side panel (or the file window) on the right, the stats line, the colour key and the lens
// pill at the top, the footer at the bottom: all float over the canvas. Every framing (fit, a file, a followed agent,
// the replay tracer) centres its content in what's left, measured from the DOM, not hard-coded.
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";

/** Canvas size, and how much of each side is covered, in CSS pixels. */
export type Safe = { w: number; h: number; left: number; top: number; right: number; bottom: number };
export type View = { x: number; y: number; k: number };
export type Box = { x0: number; y0: number; x1: number; y1: number };

/** The bits of force-graph's camera we use (code map and places map). */
export type Graph = { centerAt(): { x: number; y: number }; centerAt(x: number, y: number, ms?: number): unknown; zoom(): number; zoom(k: number, ms?: number): unknown };

const GAP = 12;                                         // breathing room off each covering element
const LEFT = ".map-sidebar:not(.sidebar-overlay), .sidebar-collapsed"; // the narrow sheet opens over the map: no reframing
const RIGHT = ".map-panel.open";
const FLOAT_RIGHT = ".map-peek";                         // floats in from the right edge: covers from its left side on
const TOP = ".map-stats, .lens-switch";
const BOTTOM = ".dock, .rp-bar";
const WATCH = [LEFT, ".map-panel", FLOAT_RIGHT, TOP, BOTTOM].join(", ");

/** Measure the safe area of the canvas living in `host` (the covering elements are looked up in its .map-wrap). */
export function measureSafe(host: HTMLElement): Safe {
  const scope = host.closest(".map-wrap") ?? host;
  const r = host.getBoundingClientRect();
  const w = host.clientWidth || r.width, h = host.clientHeight || r.height;
  let left = 0, right = 0, top = 0, bottom = 0;
  const shown = (b: DOMRect) => b.width > 0 && b.height > 0;
  for (const el of scope.querySelectorAll(LEFT)) { const b = el.getBoundingClientRect(); if (shown(b)) left = Math.max(left, b.right - r.left + GAP); }
  // Side panels slide in with a transform: their layout width says how much they will cover once open.
  for (const el of scope.querySelectorAll<HTMLElement>(RIGHT)) if (el.offsetWidth) right = Math.max(right, el.offsetWidth + GAP);
  // The file window (replay/Peek.tsx): the tracer and the thread's files keep to its left, never under it.
  for (const el of scope.querySelectorAll(FLOAT_RIGHT)) { const b = el.getBoundingClientRect(); if (shown(b)) right = Math.max(right, r.right - b.left + GAP); }
  // Top and bottom bands count only where they reach into the space between the side panels.
  const x0 = r.left + left, x1 = r.right - right;
  const across = (b: DOMRect) => shown(b) && b.right > x0 && b.left < x1;
  for (const el of scope.querySelectorAll(TOP)) { const b = el.getBoundingClientRect(); if (across(b)) top = Math.max(top, b.bottom - r.top + GAP); }
  for (const el of scope.querySelectorAll(BOTTOM)) { const b = el.getBoundingClientRect(); if (across(b)) bottom = Math.max(bottom, r.bottom - b.top + GAP); }
  // The canvas fades out in a band at the top and bottom (map.css, --fade-top / --fade-bottom): keep framings out of it too.
  const cs = getComputedStyle(scope);
  top = Math.max(top, parseFloat(cs.getPropertyValue("--fade-top")) || 0);
  bottom = Math.max(bottom, parseFloat(cs.getPropertyValue("--fade-bottom")) || 0);
  // A tiny window: never squeeze the safe area below a usable size.
  const minW = Math.min(240, w * 0.5), minH = Math.min(200, h * 0.5);
  if (w - left - right < minW) { const k = Math.max(0, w - minW) / Math.max(1, left + right); left *= k; right *= k; }
  if (h - top - bottom < minH) { const k = Math.max(0, h - minH) / Math.max(1, top + bottom); top *= k; bottom *= k; }
  return { w, h, left, top, right, bottom };
}

const near = (a: Safe, b: Safe) => (["w", "h", "left", "top", "right", "bottom"] as const).every((k) => Math.abs(a[k] - b[k]) < 2);

/** The camera centre that puts graph point (x, y) in the middle of the safe area at zoom k. */
export function centerFor(s: Safe, x: number, y: number, k: number) {
  const sx = s.left + (s.w - s.left - s.right) / 2, sy = s.top + (s.h - s.top - s.bottom) / 2;
  return { x: x - (sx - s.w / 2) / k, y: y - (sy - s.h / 2) / k };
}

/** The view that fits `box` (graph coordinates) in the safe area, `pad` screen pixels inside it. */
export function fitView(s: Safe, box: Box, { pad = 48, minZoom = 0.05, maxZoom = 6 } = {}): View {
  const sw = Math.max(60, s.w - s.left - s.right - 2 * pad), sh = Math.max(60, s.h - s.top - s.bottom - 2 * pad);
  const k = Math.max(minZoom, Math.min(maxZoom, sw / Math.max(1, box.x1 - box.x0), sh / Math.max(1, box.y1 - box.y0)));
  return { ...centerFor(s, (box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2, k), k };
}

/** Bounding box of circles. */
export function boxOf(pts: Iterable<{ x?: number; y?: number; r?: number }>): Box | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    if (p.x === undefined || p.y === undefined || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    const r = p.r ?? 0;
    x0 = Math.min(x0, p.x - r); x1 = Math.max(x1, p.x + r); y0 = Math.min(y0, p.y - r); y1 = Math.max(y1, p.y + r);
  }
  return x0 === Infinity ? null : { x0, y0, x1, y1 };
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export type Camera = {
  /** The safe area, kept up to date (for per-frame follows). */
  safe: RefObject<Safe>;
  /** Bumps whenever the safe area changes (a panel opens, the sidebar collapses, the window resizes). */
  version: number;
  /** Measure now: right after a state change, before the observers have caught up. */
  measure: () => Safe;
  /** Last time the user moved the camera by hand (drag, wheel, pinch). */
  userAt: () => number;
  view: () => View | null;
  /** Glide to a view (centre and zoom together, so the subject travels in a straight line). */
  moveTo: (v: View, ms?: number) => void;
  /** Put a graph point in the middle of the safe area, at zoom k (default: the current zoom). */
  lookAt: (x: number, y: number, k?: number, ms?: number) => void;
  /** Move the view by (dx, dy) screen pixels, as a hand move (the arrow keys). */
  pan: (dx: number, dy: number, ms?: number) => void;
  /** Fit a box in the safe area. */
  frame: (box: Box, opts?: { pad?: number; minZoom?: number; maxZoom?: number }, ms?: number) => void;
  /** Pan just enough to bring a circle into the safe area (no move if it's already in it). */
  reveal: (x: number, y: number, r: number, ms?: number) => void;
  /** One step of a follow: ease the centre toward putting (x, y) in the middle of the safe area. */
  easeToward: (x: number, y: number, f: number) => void;
  /** Whether graph point (x, y) is on screen, at least `m` pixels inside the safe area. */
  sees: (x: number, y: number, m?: number) => boolean;
  /** Stop a glide in progress. */
  stop: () => void;
};

/**
 * The camera of one force-graph canvas. `fg` is its ref, `hostRef` the element the canvas fills
 * (looked up inside its .map-wrap for the panels that cover it).
 */
export function useCamera(fg: RefObject<Graph | undefined | null>, hostRef: RefObject<HTMLElement | null>): Camera {
  const safe = useRef<Safe>({ w: 800, h: 600, left: 0, top: 0, right: 0, bottom: 0 });
  const [version, setVersion] = useState(0);
  const userAt = useRef(0);
  const glide = useRef(0);
  const panTo = useRef<{ to: View; until: number } | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const scope = host.closest(".map-wrap") ?? host;
    let raf = 0;
    const update = () => {
      raf = 0;
      const s = measureSafe(host);
      if (!near(s, safe.current)) { safe.current = s; setVersion((v) => v + 1); }
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(update); };
    const ro = new ResizeObserver(schedule);
    const watched = new Set<Element>();
    // Panels open and close by class, the sidebar collapses by swapping elements: watch both, but only on the covering
    // elements themselves and the map's own children. Not the whole subtree: a class change on every Track row would
    // otherwise run the lookups below and force a layout each time.
    const classes = new MutationObserver(schedule);
    const observe = () => {
      let changed = false;
      for (const el of scope.querySelectorAll(WATCH)) if (!watched.has(el)) { watched.add(el); ro.observe(el); changed = true; }
      for (const el of watched) if (!el.isConnected) { watched.delete(el); ro.unobserve(el); changed = true; }
      if (!changed) return;
      classes.disconnect();
      for (const el of watched) classes.observe(el, { attributes: true, attributeFilter: ["class"] });
    };
    const mo = new MutationObserver(() => { observe(); schedule(); });
    mo.observe(scope, { childList: true });
    ro.observe(host);
    observe();
    safe.current = measureSafe(host);
    setVersion((v) => v + 1);
    // Hand moves: a wheel or a drag on the canvas.
    let down: { x: number; y: number } | null = null;
    const onWheel = (e: WheelEvent) => { if ((e.target as HTMLElement).tagName === "CANVAS") { userAt.current = performance.now(); cancelAnimationFrame(glide.current); } };
    const onDown = (e: PointerEvent) => { down = (e.target as HTMLElement).tagName === "CANVAS" ? { x: e.clientX, y: e.clientY } : null; };
    const onMove = (e: PointerEvent) => {
      if (!down || !e.buttons || Math.hypot(e.clientX - down.x, e.clientY - down.y) < 4) return;
      userAt.current = performance.now(); cancelAnimationFrame(glide.current);
    };
    const onUp = () => { down = null; };
    host.addEventListener("wheel", onWheel, { capture: true, passive: true });
    host.addEventListener("pointerdown", onDown, true);
    addEventListener("pointermove", onMove, true);
    addEventListener("pointerup", onUp, true);
    return () => {
      ro.disconnect(); mo.disconnect(); classes.disconnect(); cancelAnimationFrame(raf); cancelAnimationFrame(glide.current);
      host.removeEventListener("wheel", onWheel, { capture: true });
      host.removeEventListener("pointerdown", onDown, true);
      removeEventListener("pointermove", onMove, true);
      removeEventListener("pointerup", onUp, true);
    };
  }, [hostRef]);

  return useMemo(() => {
    const g = () => fg.current ?? undefined;
    const measure = () => { const host = hostRef.current; if (host) safe.current = measureSafe(host); return safe.current; };
    const view = (): View | null => { const c = g(); if (!c) return null; const p = c.centerAt(); return p ? { x: p.x, y: p.y, k: c.zoom() } : null; };
    const stop = () => cancelAnimationFrame(glide.current);
    const moveTo = (to: View, ms = 700) => {
      const c = g(), from = view();
      stop();
      if (!c || !from || !Number.isFinite(to.x) || !Number.isFinite(to.y) || !Number.isFinite(to.k)) return;
      if (ms <= 0 || matchMedia?.("(prefers-reduced-motion: reduce)").matches) { c.zoom(to.k); c.centerAt(to.x, to.y); return; }
      const t0 = performance.now(), lk0 = Math.log(from.k), lk1 = Math.log(to.k);
      const tick = () => {
        const p = Math.min(1, (performance.now() - t0) / ms), e = ease(p);
        c.zoom(Math.exp(lk0 + (lk1 - lk0) * e));
        c.centerAt(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e);
        if (p < 1) glide.current = requestAnimationFrame(tick);
      };
      glide.current = requestAnimationFrame(tick);
    };
    const lookAt = (x: number, y: number, k?: number, ms = 700) => {
      const kk = k ?? g()?.zoom() ?? 1;
      moveTo({ ...centerFor(measure(), x, y, kk), k: kk }, ms);
    };
    // Presses add up: one made while the last pan still glides goes on from where that one was headed.
    const pan = (dx: number, dy: number, ms = 220) => {
      const now = performance.now(), last = panTo.current;
      const v = last && now < last.until ? last.to : view();
      if (!v) return;
      userAt.current = now;
      const to = { x: v.x + dx / v.k, y: v.y + dy / v.k, k: v.k };
      panTo.current = { to, until: now + ms };
      moveTo(to, ms);
    };
    const frame = (box: Box, opts?: { pad?: number; minZoom?: number; maxZoom?: number }, ms = 700) => moveTo(fitView(measure(), box, opts), ms);
    const reveal = (x: number, y: number, r: number, ms = 600) => {
      const v = view();
      if (!v) return;
      const s = measure(), m = 36;   // margin inside the safe area, in pixels
      const sx = s.w / 2 + (x - v.x) * v.k, sy = s.h / 2 + (y - v.y) * v.k, rr = r * v.k + m;
      let dx = 0, dy = 0;
      if (sx - rr < s.left) dx = sx - rr - s.left; else if (sx + rr > s.w - s.right) dx = sx + rr - (s.w - s.right);
      if (sy - rr < s.top) dy = sy - rr - s.top; else if (sy + rr > s.h - s.bottom) dy = sy + rr - (s.h - s.bottom);
      if (dx || dy) moveTo({ x: v.x + dx / v.k, y: v.y + dy / v.k, k: v.k }, ms);
    };
    const easeToward = (x: number, y: number, f: number) => {
      const c = g();
      if (!c) return;
      const p = c.centerAt(), k = c.zoom(), t = centerFor(safe.current, x, y, k);
      const dx = t.x - p.x, dy = t.y - p.y;
      if (Math.hypot(dx, dy) * k > 1.5) c.centerAt(p.x + dx * f, p.y + dy * f);
    };
    const sees = (x: number, y: number, m = 24) => {
      const v = view(), s = safe.current;
      if (!v) return true;
      const sx = s.w / 2 + (x - v.x) * v.k, sy = s.h / 2 + (y - v.y) * v.k;
      return sx > s.left + m && sx < s.w - s.right - m && sy > s.top + m && sy < s.h - s.bottom - m;
    };
    return { safe, version, measure, userAt: () => userAt.current, view, moveTo, lookAt, pan, frame, reveal, easeToward, sees, stop };
  }, [fg, hostRef, version]);
}

/** A small, quiet "fit" button for the bottom-right corner of a map. */
export const FIT_TITLE = "Fit to view (F)";

/** F or 0 (not while typing, no modifiers) fits the map. */
export function isFitKey(e: KeyboardEvent) {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return false;
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return false;
  return e.key === "f" || e.key === "F" || e.key === "0";
}
