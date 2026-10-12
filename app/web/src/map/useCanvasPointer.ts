// Pointing and clicking on the map's canvas, worked out against where the circles are this frame (graph.ts hitAt),
// not a hit map painted now and then (the graph library's was repainted at most every 0.8 s). A click is a press and release less than 5 px apart: a
// trackpad's wobble still clicks, a pan doesn't. Moved out of MapView.tsx.
import { useEffect, type RefObject } from "react";
import type { ZoomApi } from "./useCanvasZoom";
import { hitAt, type Graph, type GNode } from "./graph";

export function useCanvasPointer({ wrapRef, fg, graphRef, hasCanvas, hover, onHover, onClick, onMiss }: {
  wrapRef: RefObject<HTMLElement | null>; fg: RefObject<ZoomApi | undefined>; graphRef: RefObject<Graph>;
  /** The canvas is mounted (the map has nodes): the listeners go on it. */
  hasCanvas: boolean;
  /** The node under the pointer now (to set it only when it changes). */
  hover: RefObject<string | null>;
  onHover: (id: string | null) => void;
  /** Latest handlers (refs): a click on a node, and on nothing. */
  onClick: RefObject<(n: GNode) => void>; onMiss: () => void;
}) {
  useEffect(() => {
    const canvas = wrapRef.current?.querySelector("canvas");
    if (!canvas) return;
    // Screen readers hear what the picture is (the threads and files themselves are in the sidebar).
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", "Map of the project's files, grouped by folder. Agents show up as dots moving to the files they work on. Click a file to open it, scroll to zoom.");
    const at = (e: PointerEvent) => {
      const g = fg.current, r = canvas.getBoundingClientRect();
      if (!g) return null;
      const p = g.screen2GraphCoords(e.clientX - r.left, e.clientY - r.top);
      return hitAt(graphRef.current, p.x, p.y, g.zoom());
    };
    let down: { x: number; y: number; t: number } | null = null, raf = 0, last: PointerEvent | null = null;
    const point = () => {
      raf = 0;
      if (!last || down) return;
      const n = at(last), id = n?.id ?? null;
      canvas.style.cursor = n ? "pointer" : "";
      if (id !== hover.current) onHover(id);
    };
    const onMove = (e: PointerEvent) => { last = e; if (!raf) raf = requestAnimationFrame(point); };
    const onDown = (e: PointerEvent) => { if (e.button === 0) down = { x: e.clientX, y: e.clientY, t: performance.now() }; };
    const onUp = (e: PointerEvent) => {
      const d = down; down = null;
      if (!d || e.button !== 0 || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) return;
      const n = at(e);
      if (n) onClick.current(n); else onMiss();
    };
    const onLeave = () => { last = null; down = null; canvas.style.cursor = ""; if (hover.current) onHover(null); };
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener("pointermove", onMove); canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp); canvas.removeEventListener("pointerleave", onLeave);
    };
  }, [hasCanvas, onMiss]); // eslint-disable-line react-hooks/exhaustive-deps
}
