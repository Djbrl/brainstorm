// Owner: replay agent. Small module-level store shared by the replay layer (inside MapView) and MapView's camera.
import type { RefObject } from "react";
import type { ForceGraphMethods } from "react-force-graph-2d";
import type { Safe } from "../camera";

export const replayCamera = {
  fg: null as RefObject<ForceGraphMethods | undefined> | null,
  /** The map's safe area (the part of the canvas no panel covers), kept up to date by MapView's camera. */
  safe: null as RefObject<Safe> | null,
  /** A file's panel is open: the camera stays on that file instead of following the tracer. */
  pinned: false,
  /** Unlocked camera: the tracer left the view. MapView frames the recent window again, unless you moved the camera. */
  lost: null as (() => void) | null,
};
