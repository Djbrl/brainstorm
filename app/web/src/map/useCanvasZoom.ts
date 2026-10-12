// The map's canvas, owned by us: its size and pixel ratio, the camera (pan and zoom), and the input that moves it
// (wheel, trackpad pinch as ctrl+wheel, drag, two-finger pinch). It draws only when asked (`redraw()`), or when the
// camera or the size changes, one frame per animation frame at most: nothing runs while nothing moves. It replaces the
// graph library's canvas (react-force-graph-2d), whose loop ran every animation frame even with nothing to draw.
//
// The camera behaves as the library's did (d3-zoom underneath), so framings and gestures feel the same: the transform
// is screen = graph * k + (x, y) in CSS pixels; the wheel zooms by 2^(-deltaY * 0.002) about the pointer (ten times
// that with ctrl: a trackpad pinch); a resize keeps the middle of the view where it was; a double-click does nothing
// (the library had its double-click zoom turned off).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Graph } from "./camera";

export type ZoomApi = Graph & {
  /** A point on the canvas (CSS pixels from its top left) in graph units. */
  screen2GraphCoords(x: number, y: number): { x: number; y: number };
  /** A pointer event's place in graph units. */
  toGraph(clientX: number, clientY: number): { x: number; y: number };
  /** Draw a frame (on the next animation frame; several asks make one frame). */
  redraw(): void;
  /** A drag or pinch is under way (no hover then). */
  dragging(): boolean;
};

const wheelDelta = (e: WheelEvent) => -e.deltaY * (e.deltaMode === 1 ? 0.05 : e.deltaMode ? 1 : 0.002) * (e.ctrlKey ? 10 : 1);

/**
 * `draw(ctx, k)` paints one frame with the camera already applied (graph units, k the zoom). `ref.current` is the
 * camera while the canvas is mounted (undefined before, as the library's ref was): `canvasRef` goes on the <canvas>.
 */
export function useCanvasZoom({ width, height, draw, minZoom = 0.01, maxZoom = 1000 }: {
  width: number; height: number;
  draw: (ctx: CanvasRenderingContext2D, k: number) => void;
  minZoom?: number; maxZoom?: number;
}) {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const t = useRef({ k: 1, x: width / 2, y: height / 2 });
  const dims = useRef({ w: 0, h: 0, dpr: 1 });
  const drawRef = useRef(draw); drawRef.current = draw;
  const raf = useRef(0);
  const drag = useRef(false);
  const ext = useRef([minZoom, maxZoom]); ext.current = [minZoom, maxZoom];

  const api = useMemo<ZoomApi>(() => {
    const clampK = (k: number) => Math.max(ext.current[0], Math.min(ext.current[1], k));
    const frame = () => {
      raf.current = 0;
      const c = canvasEl.current, ctx = c?.getContext("2d");
      if (!c || !ctx) return;
      const { w, h, dpr } = dims.current, T = t.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.setTransform(dpr * T.k, 0, 0, dpr * T.k, dpr * T.x, dpr * T.y);
      drawRef.current(ctx, T.k);
    };
    const redraw = () => { if (!raf.current) raf.current = requestAnimationFrame(frame); };
    function centerAt(): { x: number; y: number };
    function centerAt(x: number, y: number): unknown;
    function centerAt(x?: number, y?: number) {
      const T = t.current, { w, h } = dims.current;
      if (x === undefined || y === undefined) return { x: (w / 2 - T.x) / T.k, y: (h / 2 - T.y) / T.k };
      T.x = w / 2 - x * T.k; T.y = h / 2 - y * T.k;
      redraw();
      return api;
    }
    function zoom(): number;
    function zoom(k: number): unknown;
    function zoom(k?: number) {
      const T = t.current, { w, h } = dims.current;
      if (k === undefined) return T.k;
      // About the middle of the canvas, as d3-zoom's scaleTo.
      const k1 = clampK(k), px = (w / 2 - T.x) / T.k, py = (h / 2 - T.y) / T.k;
      T.k = k1; T.x = w / 2 - px * k1; T.y = h / 2 - py * k1;
      redraw();
      return api;
    }
    const screen2GraphCoords = (x: number, y: number) => { const T = t.current; return { x: (x - T.x) / T.k, y: (y - T.y) / T.k }; };
    const toGraph = (cx: number, cy: number) => {
      const r = canvasEl.current?.getBoundingClientRect();
      return screen2GraphCoords(cx - (r?.left ?? 0), cy - (r?.top ?? 0));
    };
    const api: ZoomApi = { centerAt, zoom, screen2GraphCoords, toGraph, redraw, dragging: () => drag.current };
    return api;
  }, []);
  const canvasEl = useRef<HTMLCanvasElement | null>(null);
  canvasEl.current = canvas;
  const ref = useRef<ZoomApi | undefined>(undefined);
  ref.current = canvas ? api : undefined;

  // A new canvas starts a new camera (declared before the size effect, which then puts the origin in the middle)
  // as the library's did: zoom 1, the graph origin in the middle.
  useEffect(() => {
    if (!canvas) return;
    t.current = { k: 1, x: 0, y: 0 }; dims.current = { w: 0, h: 0, dpr: dims.current.dpr };
    return () => { cancelAnimationFrame(raf.current); raf.current = 0; };
  }, [canvas]);

  // Size and pixel ratio: the canvas's memory is CSS size × devicePixelRatio; a resize keeps the view's middle.
  const [dprTick, setDprTick] = useState(0);
  useEffect(() => {
    const mq = matchMedia(`(resolution: ${devicePixelRatio}dppx)`);
    const on = () => setDprTick((n) => n + 1);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [dprTick]);
  useEffect(() => {
    if (!canvas) return;
    const d = dims.current, dpr = devicePixelRatio || 1, T = t.current;
    T.x += (width - d.w) / 2; T.y += (height - d.h) / 2;
    d.w = width; d.h = height; d.dpr = dpr;
    canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    api.redraw();
  }, [canvas, width, height, dprTick, api]);

  // Input: wheel and trackpad, drag to pan, two fingers to pinch.
  useEffect(() => {
    if (!canvas) return;
    Object.assign(canvas.style, { touchAction: "none", userSelect: "none", outline: "none", webkitTapHighlightColor: "transparent" });
    const zoomAbout = (sx: number, sy: number, k: number) => {
      const T = t.current, k1 = Math.max(ext.current[0], Math.min(ext.current[1], k));
      const px = (sx - T.x) / T.k, py = (sy - T.y) / T.k;
      T.k = k1; T.x = sx - px * k1; T.y = sy - py * k1;
      api.redraw();
    };
    const local = (e: { clientX: number; clientY: number }) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = local(e);
      zoomAbout(p.x, p.y, t.current.k * 2 ** wheelDelta(e));
    };
    const pts = new Map<number, { x: number; y: number }>();
    let pinch: { d: number; k: number; gx: number; gy: number } | null = null;
    const startPinch = () => {
      const [a, b] = [...pts.values()], m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, T = t.current;
      pinch = { d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), k: T.k, gx: (m.x - T.x) / T.k, gy: (m.y - T.y) / T.k };
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || pts.size >= 2) return;
      pts.set(e.pointerId, local(e));
      try { canvas.setPointerCapture(e.pointerId); } catch { /* a synthetic pointer: no capture */ }
      if (pts.size === 2) { startPinch(); drag.current = true; }
    };
    const onMove = (e: PointerEvent) => {
      const prev = pts.get(e.pointerId);
      if (!prev) return;
      const p = local(e);
      pts.set(e.pointerId, p);
      const T = t.current;
      if (pinch && pts.size === 2) {
        const [a, b] = [...pts.values()], m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const k = Math.max(ext.current[0], Math.min(ext.current[1], pinch.k * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d));
        T.k = k; T.x = m.x - pinch.gx * k; T.y = m.y - pinch.gy * k;
        api.redraw();
        return;
      }
      const dx = p.x - prev.x, dy = p.y - prev.y;
      if (!dx && !dy) return;
      drag.current = true;
      T.x += dx; T.y += dy;
      api.redraw();
    };
    const onUp = (e: PointerEvent) => {
      if (!pts.delete(e.pointerId)) return;
      if (pts.size < 2) pinch = null;
      if (!pts.size) setTimeout(() => { if (!pts.size) drag.current = false; }, 0);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    return () => {
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
    };
  }, [canvas, api]);

  const canvasRef = useCallback((el: HTMLCanvasElement | null) => setCanvas(el), []);
  return { canvasRef, ref, canvas };
}
