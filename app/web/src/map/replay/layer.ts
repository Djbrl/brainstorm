// Owner: replay agent. Map-canvas side of the thread replay: tracer, stops, read flashes, dimming,
// camera follow, and wheel-to-scrub. STUB: the replay agent replaces the body; keep the exported API.
import type { RefObject } from "react";
import type { ForceGraphMethods } from "react-force-graph-2d";

export type NodePos = { x?: number; y?: number; r: number };

export type ReplayLayerApi = {
  /** True while a thread replay is on (nav.replay is set and its thread is loaded). */
  active: boolean;
  /** Alpha for a node during replay: 1 = normal, lower = dimmed (not touched by the thread). */
  nodeAlpha: (id: string) => number;
  /** Draw the tracer, numbered stops, the current marker and read flashes. Called every frame after the agent layer. */
  draw: (ctx: CanvasRenderingContext2D, scale: number) => void;
};

export function useReplayLayer(_opts: {
  fg: RefObject<ForceGraphMethods | undefined>;
  wrapRef: RefObject<HTMLDivElement | null>;
  nodeIndexRef: RefObject<Map<string, NodePos>>;
  accent: string;
  font: string;
}): ReplayLayerApi {
  return { active: false, nodeAlpha: () => 1, draw: () => {} };
}
