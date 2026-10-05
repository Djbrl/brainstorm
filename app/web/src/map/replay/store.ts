// Owner: replay agent. Small module-level store shared by the replay layer (inside MapView) and the ReplayBar,
// so the bar can zoom and recenter without MapView passing anything down.
import type { RefObject } from "react";
import type { ForceGraphMethods } from "react-force-graph-2d";
import { centerFor, type Safe } from "../camera";

/** Zoom the camera eases to when a replay starts or on Recenter. */
export const REPLAY_ZOOM = 2.2;
/** How long a user drag or zoom pauses the camera follow. */
export const USER_CAMERA_MS = 3000;

export const replayCamera = {
  fg: null as RefObject<ForceGraphMethods | undefined> | null,
  /** The map's safe area (the part of the canvas no panel covers), kept up to date by MapView's camera. */
  safe: null as RefObject<Safe> | null,
  /** Last time the user moved the camera themselves (drag, pinch, zoom). */
  userAt: 0,
  /** Zoom the camera eases toward, or null once the user picked a zoom. */
  targetZoom: REPLAY_ZOOM as number | null,
  /** When the follow was put on hold (the fit button): it resumes once the marker leaves the view or the user moves the camera. */
  heldAt: null as number | null,
  /** A file's panel is open: the camera stays on that file instead of following the tracer. */
  pinned: false,

  userMoved() { this.userAt = performance.now(); },
  recenter() { this.userAt = 0; this.targetZoom = REPLAY_ZOOM; this.heldAt = null; },
  /** Leave the camera where it is (a fit) while the marker stays in sight. */
  hold() { this.heldAt = performance.now(); },
  zoomBy(factor: number) {
    const g = this.fg?.current;
    if (!g) return;
    this.userAt = performance.now();
    this.targetZoom = null;
    const k = g.zoom(), k2 = Math.max(0.2, Math.min(12, k * factor));
    const s = this.safe?.current;
    if (s) { // zoom about the middle of the safe area, not the middle of the canvas
      const c = g.centerAt() as unknown as { x: number; y: number };
      const sx = s.left + (s.w - s.left - s.right) / 2, sy = s.top + (s.h - s.top - s.bottom) / 2;
      const p = centerFor(s, c.x + (sx - s.w / 2) / k, c.y + (sy - s.h / 2) / k, k2);
      g.centerAt(p.x, p.y, 250);
    }
    g.zoom(k2, 250);
  },
};
