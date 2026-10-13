// The replay's side of the camera (moved out of ThreadLayer.ts). The director (useMapCamera.ts, director.ts) decides what
// the camera frames and when; the layer's draw() only tells it, through `follow.kick`, when the marker, the view or the
// pinned file changed since the last frame, so it looks again at once instead of at its next beat.
import { useCallback, useRef, type RefObject } from "react";
import type { Camera, ReplayCamera } from "../camera";

export function useReplayFollow({ camera, follow, target }: {
  active: boolean; mode: string;
  camera: RefObject<Camera>; follow: RefObject<ReplayCamera>;
  /** The marker this frame, or null. */
  target: () => { x: number; y: number } | null;
}) {
  const seen = useRef({ x: null as number | null, y: null as number | null, pinned: false, safe: null as unknown, a: null as number | null, e: null as number | null, f: null as number | null });
  /** From draw(), every frame: kick the director when something it frames changed since the last frame. */
  return useCallback((ctx: CanvasRenderingContext2D) => {
    const s = seen.current, c = target(), m = ctx.getTransform();
    const x = c?.x ?? null, y = c?.y ?? null, pinned = follow.current.pinned, safe = camera.current.safe.current;
    if (x === s.x && y === s.y && pinned === s.pinned && safe === s.safe && m.a === s.a && m.e === s.e && m.f === s.f) return;
    Object.assign(s, { x, y, pinned, safe, a: m.a, e: m.e, f: m.f });
    follow.current.kick?.();
  }, [camera]); // eslint-disable-line react-hooks/exhaustive-deps
}
