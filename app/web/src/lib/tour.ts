// The first-run tour (map/tour/Tour.tsx): which step shows, and whether this install had it. Kept by
// the server (GET/PUT /api/onboarding), not in a browser: the Claude app's pane, Chrome and Safari would each show it
// again. While it runs, the extras (the Readmap, the file window, read lines, the key hints, the "agents elsewhere"
// pill) are hidden until the step that shows them (`:root[data-tour]`, tour.css), and an example agent can walk the map.
import { useSyncExternalStore } from "react";
import type { AgentPresence } from "@contract";
import { ApiError, get, put } from "./api";

export type TourStep = "hello" | "threads" | "steps" | "step" | "files" | "map" | "readmap" | "keys" | "stats" | "end";

type State = {
  /** The step showing, or null when the tour isn't running. */
  step: TourStep | null;
  /** Whether this install finished or skipped it: unknown until the server answers. */
  done: boolean | null;
  /** The example agent walking the map (the map step), or null. */
  agent: AgentPresence | null;
};

let state: State = { step: null, done: null, agent: null };
const subs = new Set<() => void>();
const set = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  if (typeof document !== "undefined") {
    if (state.step) document.documentElement.dataset.tour = state.step;
    else delete document.documentElement.dataset.tour;
  }
  subs.forEach((f) => f());
};

export const tourStore = {
  get: () => state,
  subscribe: (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; },
  /** Start (again) from the first step. */
  start: () => set({ step: "hello" }),
  go: (step: TourStep) => set({ step }),
  setAgent: (agent: AgentPresence | null) => set({ agent }),
  /** Finished or skipped: not shown again on this install (Settings and the shortcuts list start it again). */
  finish: () => {
    set({ step: null, done: true, agent: null });
    save(true);
    window.dispatchEvent(new Event("rundown-welcomed"));   // the usage question waits for this (UsageAsk)
  },
  /** Whether the server says this install had it; starts it if not. */
  load: () => {
    get<{ done: boolean }>("/api/onboarding").catch((e: unknown) => { if (e instanceof ApiError && e.status) return null; throw e; }).then((r) => {
      if (state.done !== null) return;
      // An older server without the route: count it as done, so nothing nags.
      const done = r ? !!r.done : true;
      set({ done, ...(done ? {} : { step: "hello" as TourStep }) });
    }).catch(() => set({ done: true }));
  },
};

function save(done: boolean) {
  put("/api/onboarding", { done })
    .catch(() => { /* offline: it shows again next time, which is fine */ });
}

export function useTour<T>(pick: (s: State) => T): T {
  return useSyncExternalStore(tourStore.subscribe, () => pick(state), () => pick(state));
}

/** The tour is on and the step isn't one that shows the extras: the map leaves out read lines and the like. */
export const tourHidesExtras = () => !!state.step && state.step !== "map";

export const TOUR_AGENT = "tour-example-agent";
