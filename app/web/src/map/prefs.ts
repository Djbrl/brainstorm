// Map choices remembered per browser, read on every frame by the canvas layers (like lib/theme): whether the small
// window with the file the agent is reading or writing shows while you follow or replay a thread (thread/FileWindow.tsx),
// and whether the Readmap is pinned (Readmap.tsx): off unless M pins it; unpinned it comes and goes with the reads. How
// much of an open thread the map lights up is no longer a choice: the director frames the work (director.ts), and the
// map keeps a fixed window.
import { createAtom } from "../lib/store";

/** How many moments up to the replay cursor the map lights up ("all": the whole thread). */
export type StepWindow = 15 | 50 | "all";
/** The map lights up an open thread's last 15 moments (thread/focus.ts). Fixed since the director replaced the setting. */
const STEP_WINDOW: StepWindow = 15;

const onOff = (on: boolean) => (on ? "1" : "0");
const peek = createAtom(true, { key: "rundown-map-peek", parse: (v) => v !== "0", serialize: onOff });    // on unless turned off
const mini = createAtom(false, { key: "rundown-readmap-pinned", parse: (v) => v === "1", serialize: onOff }); // off unless pinned

export const getStepWindow = (): StepWindow => STEP_WINDOW;
export const useStepWindow = (): StepWindow => STEP_WINDOW;

/** Show file: the small window with what the agent is reading or writing, while you follow or replay a thread. */
export const getShowFile = peek.get;
export const setShowFile = (on: boolean) => peek.set(on);
export const useShowFile = peek.use;

/** The Readmap pinned (Readmap.tsx): always shown. Unpinned (the default), it shows when an agent reads a file off the
 *  visible map and fades after a few seconds with nothing new. M pins and unpins it. */
export const getReadmap = mini.get;
export const setReadmap = (on: boolean) => mini.set(on);
export const useReadmap = mini.use;
