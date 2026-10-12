// Map choices remembered per browser, read on every frame by the canvas layers (like lib/theme):
// how much of an open thread the map lights up (its last 15 moments, its last 50, or all of it: see thread/ThreadLayer.ts's
// focus), whether the camera locks onto what moves (the replay tracer, or an agent you follow), and whether the small
// window with the file the agent is reading or writing shows while you follow or replay a thread (thread/FileWindow.tsx), and
// whether the Readmap shows (Readmap.tsx): on unless turned off, M flips it.
import { createAtom } from "../lib/store";

/** How many moments up to the replay cursor the map lights up ("all": the whole thread). */
export type StepWindow = 15 | 50 | "all";
export const STEP_WINDOWS: { id: StepWindow; name: string }[] = [
  { id: 15, name: "The last 15 steps" },
  { id: 50, name: "The last 50 steps" },
  { id: "all", name: "The whole thread" },
];

const onOff = (on: boolean) => (on ? "1" : "0");
const stepWindow = createAtom<StepWindow>(15, { key: "rundown-map-window", parse: (v) => (v === "50" ? 50 : v === "all" ? "all" : 15) });
const lock = createAtom(false, { key: "rundown-camera-lock", parse: (v) => v === "1", serialize: onOff });
const peek = createAtom(true, { key: "rundown-map-peek", parse: (v) => v !== "0", serialize: onOff });    // on unless turned off
const mini = createAtom(true, { key: "rundown-readmap-shown", parse: (v) => v !== "0", serialize: onOff }); // on unless turned off

export const getStepWindow = stepWindow.get;
export const setStepWindow = (w: StepWindow) => stepWindow.set(w);
export const useStepWindow = stepWindow.use;

/** Locked: the camera keeps the tracer (or the followed agent) centred; unlocked, it frames it once and stays put. */
export const getCameraLock = lock.get;
export const setCameraLock = (on: boolean) => lock.set(on);
export const useCameraLock = lock.use;

/** Show file: the small window with what the agent is reading or writing, while you follow or replay a thread. */
export const getShowFile = peek.get;
export const setShowFile = (on: boolean) => peek.set(on);
export const useShowFile = peek.use;

/** The Readmap (Readmap.tsx): shown unless turned off (M, or its close button). */
export const getReadmap = mini.get;
export const setReadmap = (on: boolean) => mini.set(on);
export const useReadmap = mini.use;
