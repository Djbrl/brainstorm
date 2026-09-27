// Owner: replay agent. Small module-level store shared by the replay layer (inside MapView) and the ReplayBar,
// so the bar can zoom and recenter without MapView passing anything down.
import type { RefObject } from "react";
import type { ForceGraphMethods } from "react-force-graph-2d";

/** Zoom the camera eases to when a replay starts or on Recenter. */
export const REPLAY_ZOOM = 2.2;
/** How long a user drag or zoom pauses the camera follow. */
export const USER_CAMERA_MS = 3000;

export const replayCamera = {
  fg: null as RefObject<ForceGraphMethods | undefined> | null,
  /** Last time the user moved the camera themselves (drag, pinch, zoom). */
  userAt: 0,
  /** Zoom the camera eases toward, or null once the user picked a zoom. */
  targetZoom: REPLAY_ZOOM as number | null,

  userMoved() { this.userAt = performance.now(); },
  recenter() { this.userAt = 0; this.targetZoom = REPLAY_ZOOM; },
  zoomBy(factor: number) {
    const g = this.fg?.current;
    if (!g) return;
    this.userAt = performance.now();
    this.targetZoom = null;
    g.zoom(Math.max(0.2, Math.min(12, g.zoom() * factor)), 250);
  },
};
