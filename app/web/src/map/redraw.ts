// Owner: perf-canvas. When the map canvas redraws.
//
// force-graph redraws a frame only when it has to (the layout engine is ticking, the camera moved, the canvas resized):
// its autoPauseRedraw. Everything else that changes the picture comes from us: an agent gliding, a replay step, a file
// fading into a thread's focus, a ripple, a PS2 cube turning, a hover, new data. This keeps frames coming for exactly
// as long as one of those runs, and lets the canvas rest (no work at all) when nothing moves.
//
// How a frame is asked for: zoom(zoom()), a camera move that goes nowhere, is force-graph's public way to mark it dirty.

/** What the last drawn frame still had moving: nothing, something smooth (every frame), or only slow motion. */
export const Motion = { None: 0, Smooth: 1, Slow: 2 } as const;
export type Motion = (typeof Motion)[keyof typeof Motion];
const SLOW_MS = 66;   // slow motion only (a cube turning a few degrees a second): 15 frames a second is plenty

export type Redraw = {
  /** Draw the next frame, and keep drawing for `ms` more (a glide or a flash we know the length of). */
  kick: (ms?: number) => void;
  /** Called after each drawn frame with what is still moving there, so the next frame comes (or not). */
  drew: (m: Motion) => void;
  /** The layout engine ticked: force-graph draws every frame on its own while it runs. */
  ticked: () => void;
  stop: () => void;
};

export function createRedraw(poke: () => void): Redraw {
  let until = 0, want: Motion = Motion.None as Motion, pending = false, raf = 0, lastPoke = -1e9, tickAt = -1e9;
  const loop = (t: number) => {
    raf = 0;
    const now = performance.now();
    const due = pending || now < until || want === Motion.Smooth || (want === Motion.Slow && t - lastPoke >= SLOW_MS);
    pending = false;
    // While the engine ticks force-graph draws anyway (and a poke in the middle of a node drag would end its click guard).
    if (due && now - tickAt > 50) { lastPoke = t; poke(); }
    if (now < until || want !== Motion.None) raf = requestAnimationFrame(loop);
  };
  const run = () => { if (!raf) raf = requestAnimationFrame(loop); };
  return {
    kick(ms = 0) { pending = true; until = Math.max(until, performance.now() + ms); run(); },
    drew(m) { want = m; if (m !== Motion.None) run(); },
    ticked() { tickAt = performance.now(); },
    stop() { cancelAnimationFrame(raf); raf = 0; until = 0; want = Motion.None; pending = false; },
  };
}
