// Owner: map-focus. Two map choices remembered per browser, read on every frame by the canvas layers (like lib/theme):
// how much of an open thread the map lights up (its last 15 moments, its last 50, or all of it: see replay/layer.ts's
// focus), and whether the camera locks onto what moves (the replay tracer, or an agent you follow).
import { useSyncExternalStore } from "react";

/** How many moments up to the replay cursor the map lights up ("all": the whole thread). */
export type StepWindow = 15 | 50 | "all";
export const STEP_WINDOWS: { id: StepWindow; name: string }[] = [
  { id: 15, name: "The last 15 steps" },
  { id: 50, name: "The last 50 steps" },
  { id: "all", name: "The whole thread" },
];

const WINDOW_KEY = "brainstorm-map-window";
const LOCK_KEY = "brainstorm-camera-lock";

function load<T>(key: string, parse: (v: string | null) => T): T {
  try { return parse(localStorage.getItem(key)); } catch { return parse(null); } // storage blocked: the default
}
const prefs = {
  window: load<StepWindow>(WINDOW_KEY, (v) => (v === "50" ? 50 : v === "all" ? "all" : 15)),
  lock: load<boolean>(LOCK_KEY, (v) => v === "1"),
};
const listeners = new Set<() => void>();
const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
function save(key: string, v: string) {
  try { localStorage.setItem(key, v); } catch { /* not remembered, still applied */ }
  listeners.forEach((f) => f());
}

export const getStepWindow = () => prefs.window;
export function setStepWindow(w: StepWindow) { if (w !== prefs.window) { prefs.window = w; save(WINDOW_KEY, String(w)); } }
export const useStepWindow = () => useSyncExternalStore(subscribe, getStepWindow, getStepWindow);

/** Locked: the camera keeps the tracer (or the followed agent) centred; unlocked, it frames it once and stays put. */
export const getCameraLock = () => prefs.lock;
export function setCameraLock(on: boolean) { if (on !== prefs.lock) { prefs.lock = on; save(LOCK_KEY, on ? "1" : "0"); } }
export const useCameraLock = () => useSyncExternalStore(subscribe, getCameraLock, getCameraLock);
