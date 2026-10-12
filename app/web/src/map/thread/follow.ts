// The replay's camera follow (moved out of ThreadLayer.ts). Locked: the marker stays in the middle of the part of the map no
// panel covers (easing, never snapping); the wheel and pinch still zoom, and the zoom stays where you put it. Unlocked:
// the camera stays where it is; when the marker leaves the view, the map's camera frames the recent window again
// (`follow.onLost`), unless you moved the camera since it last framed it. The loop runs only while there is something to
// do: locked, until the camera has caught up with the marker; unlocked, while the marker is out of view. The layer's
// draw() starts it again when the marker, the view, the lock or the pinned file changes (kick).
import { useCallback, useEffect, useRef, type RefObject } from "react";
import { centerFor, type Camera, type ReplayCamera } from "../camera";
import { getCameraLock } from "../prefs";

export function useReplayFollow({ active, mode, camera, follow, target }: {
  active: boolean; mode: string;
  camera: RefObject<Camera>; follow: RefObject<ReplayCamera>;
  /** The camera's target this frame (the marker, or between it and a file it reads), or null. */
  target: () => { x: number; y: number } | null;
}) {
  const camLoop = useRef({ enabled: false, raf: 0, lostAt: 0, tick: () => {},
    seen: { x: null as number | null, y: null as number | null, lock: false, pinned: false, safe: null as unknown, a: null as number | null, e: null as number | null, f: null as number | null } });
  useEffect(() => {
    const L = camLoop.current;
    if (!active) return;
    L.tick = () => {
      L.raf = 0;
      const c = target(), cam = camera.current;
      let busy = false;
      if (c && !follow.current.pinned) {
        if (getCameraLock()) {
          // The same test easeToward makes before it moves (over 1.5 px off): once it's under, the camera has arrived.
          const v = cam.view();
          if (v) { const t = centerFor(cam.safe.current, c.x, c.y, v.k); busy = Math.hypot(t.x - v.x, t.y - v.y) * v.k > 1.5; }
          if (busy) cam.easeToward(c.x, c.y, 0.08);
        } else {
          busy = !cam.sees(c.x, c.y, follow.current.margin());
          if (busy && performance.now() - L.lostAt > 1200) { L.lostAt = performance.now(); follow.current.onLost?.(); }
        }
      }
      if (busy) L.raf = requestAnimationFrame(L.tick);
    };
    L.enabled = true;
    L.raf = requestAnimationFrame(L.tick);
    return () => { L.enabled = false; cancelAnimationFrame(L.raf); L.raf = 0; };
  }, [active, mode, camera]); // eslint-disable-line react-hooks/exhaustive-deps
  /** From draw(), every frame: start the camera loop again when something it follows changed since the last frame. */
  return useCallback((ctx: CanvasRenderingContext2D) => {
    const L = camLoop.current, s = L.seen, c = target(), m = ctx.getTransform();
    const x = c?.x ?? null, y = c?.y ?? null, lock = getCameraLock(), pinned = follow.current.pinned, safe = camera.current.safe.current;
    if (x === s.x && y === s.y && lock === s.lock && pinned === s.pinned && safe === s.safe && m.a === s.a && m.e === s.e && m.f === s.f) return;
    s.x = x; s.y = y; s.lock = lock; s.pinned = pinned; s.safe = safe; s.a = m.a; s.e = m.e; s.f = m.f;
    if (L.enabled && !L.raf) L.raf = requestAnimationFrame(L.tick);
  }, [camera]); // eslint-disable-line react-hooks/exhaustive-deps
}
