// Owned by the lead. Cross-view navigation: which view, which session, which file is focused.
// Thread replay (map) state and hidden agents added by the thread-replay foundation.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { ReplayDetail } from "./thread";

export type View = "follow" | "map" | "failures";
export type ReplaySpeed = 1 | 2 | 4;
/**
 * A thread being replayed on the map. `index` is the current beat (see lib/thread.ts) in `detail` mode.
 * `atStep` is a step id to land on once the thread is built (links, Follow, switching detail); the replay layer resolves and clears it.
 */
export type ThreadReplay = { sessionId: string; index: number; playing: boolean; speed: ReplaySpeed; detail: ReplayDetail; atStep?: string };

/**
 * Map display prefs read by the canvas layers (live agents, thread replay) on every frame.
 * Kept in sync with the `showReads` nav state; mutate only through setShowReads.
 */
export const mapPrefs: { showReads: boolean } = { showReads: true };

/** The step id at the replay cursor, published by the replay layer while rendering, so the URL can point at a step (stable across detail modes). */
export const replayCursor: { stepId: string | null } = { stepId: null };

type Nav = {
  view: View; setView: (v: View) => void;
  sessionId: string | null; setSessionId: (id: string | null) => void;
  focusFile: string | null; setFocusFile: (p: string | null) => void;
  /** Jump to the map with a file selected (e.g. from an edit step). */
  openFile: (path: string) => void;
  /** Step to reveal in Follow (set by openStep; Follow selects + scrolls to it, then clears it). */
  focusStep: string | null; setFocusStep: (id: string | null) => void;
  /** Jump to Follow with a session selected and a step revealed (e.g. from Failures evidence). */
  openStep: (sessionId: string, stepId: string) => void;

  /** Thread replay on the map, or null. */
  replay: ThreadReplay | null;
  /** Open the map and replay a thread, paused: from a beat index, or from the beat holding a step id. */
  startReplay: (sessionId: string, at?: number | string) => void;
  /** Move the replay cursor. The caller clamps to the thread length. */
  setReplayIndex: (i: number | ((prev: number) => number)) => void;
  setReplayPlaying: (playing: boolean) => void;
  setReplaySpeed: (speed: ReplaySpeed) => void;
  /** Switch between the light replay (summaries) and every step, staying on the same step. */
  setReplayDetail: (detail: ReplayDetail, atStep?: string) => void;
  /** Clear `atStep` after landing on it, at `index`. */
  landReplay: (index: number) => void;
  stopReplay: () => void;

  /** Agents hidden from the map (agent ids: sessionId for main threads, agentId for subagents). */
  hiddenAgents: ReadonlySet<string>;
  toggleAgent: (id: string) => void;
  setHiddenAgents: (ids: Iterable<string>) => void;

  /** Map: draw reads (lines of sight, read flashes) or only writes. Remembered per browser. */
  showReads: boolean;
  setShowReads: (v: boolean) => void;
};
const Ctx = createContext<Nav | null>(null);

const HIDDEN_KEY = "brainstorm-hidden-agents";
const READS_KEY = "brainstorm-map-show-reads";
function loadShowReads(): boolean {
  try { return localStorage.getItem(READS_KEY) !== "0"; } catch { return true; }
}
function loadHidden(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]") as string[]); } catch { return new Set(); }
}

export function NavProvider({ children }: { children: ReactNode }) {
  const params = new URLSearchParams(location.search);
  const [view, setView] = useState<View>(() => ((params.get("view") as View) || "follow"));
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [focusFile, setFocusFile] = useState<string | null>(null);
  const [focusStep, setFocusStep] = useState<string | null>(null);
  // Deep link: ?view=map&thread=<sessionId>&step=<stepId>[&detail=full]  (older links: &beat=<n>)
  const [replay, setReplay] = useState<ThreadReplay | null>(() => {
    const t = params.get("thread");
    if (!t) return null;
    const detail: ReplayDetail = params.get("detail") === "full" ? "full" : "light";
    return { sessionId: t, index: Math.max(0, Number(params.get("beat")) || 0), playing: false, speed: 1, detail, atStep: params.get("step") ?? undefined };
  });
  const [hiddenAgents, setHidden] = useState<Set<string>>(loadHidden);
  const [showReads, setShowReadsState] = useState<boolean>(() => (mapPrefs.showReads = loadShowReads()));
  const setShowReads = useCallback((v: boolean) => {
    mapPrefs.showReads = v;
    setShowReadsState(v);
    try { localStorage.setItem(READS_KEY, v ? "1" : "0"); } catch { /* storage blocked: resets on reload */ }
  }, []);

  // Keep the view (and a replay) in the URL so a reload (e.g. the dev server reacting to agents editing this very repo) stays put.
  useEffect(() => {
    const u = new URL(location.href);
    u.searchParams.set("view", view);
    u.searchParams.delete("beat");
    if (replay) {
      u.searchParams.set("thread", replay.sessionId);
      const at = replay.atStep ?? replayCursor.stepId;
      if (at) u.searchParams.set("step", at); else u.searchParams.delete("step");
      if (replay.detail === "full") u.searchParams.set("detail", "full"); else u.searchParams.delete("detail");
    } else { u.searchParams.delete("thread"); u.searchParams.delete("step"); u.searchParams.delete("detail"); }
    if (u.href !== location.href) history.replaceState(null, "", u);
  }, [view, replay?.sessionId, replay?.index, replay?.detail, replay?.atStep]);

  useEffect(() => {
    try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hiddenAgents])); } catch { /* storage blocked: hidden agents reset on reload */ }
  }, [hiddenAgents]);

  const openFile = (p: string) => { setFocusFile(p); setView("map"); };
  const openStep = (sid: string, stepId: string) => { setSessionId(sid); setFocusStep(stepId); setView("follow"); };

  const startReplay = useCallback((sid: string, at: number | string = 0) => {
    setReplay((r) => ({
      sessionId: sid, playing: false, speed: r?.speed ?? 1, detail: r?.detail ?? "light",
      index: typeof at === "number" ? Math.max(0, at) : 0, atStep: typeof at === "string" ? at : undefined,
    }));
    setView("map");
  }, []);
  const setReplayIndex = useCallback((i: number | ((prev: number) => number)) =>
    setReplay((r) => (r ? { ...r, index: Math.max(0, typeof i === "function" ? i(r.index) : i) } : r)), []);
  const setReplayPlaying = useCallback((playing: boolean) => setReplay((r) => (r ? { ...r, playing } : r)), []);
  const setReplaySpeed = useCallback((speed: ReplaySpeed) => setReplay((r) => (r ? { ...r, speed } : r)), []);
  const setReplayDetail = useCallback((detail: ReplayDetail, atStep?: string) =>
    setReplay((r) => (r ? { ...r, detail, playing: false, atStep: atStep ?? replayCursor.stepId ?? undefined } : r)), []);
  const landReplay = useCallback((index: number) => setReplay((r) => (r ? { ...r, index: Math.max(0, index), atStep: undefined } : r)), []);
  const stopReplay = useCallback(() => { replayCursor.stepId = null; setReplay(null); }, []);

  const toggleAgent = useCallback((id: string) => setHidden((h) => { const n = new Set(h); if (n.has(id)) n.delete(id); else n.add(id); return n; }), []);
  const setHiddenAgents = useCallback((ids: Iterable<string>) => setHidden(new Set(ids)), []);

  return (
    <Ctx.Provider value={{
      view, setView, sessionId, setSessionId, focusFile, setFocusFile, openFile, focusStep, setFocusStep, openStep,
      replay, startReplay, setReplayIndex, setReplayPlaying, setReplaySpeed, setReplayDetail, landReplay, stopReplay,
      hiddenAgents, toggleAgent, setHiddenAgents, showReads, setShowReads,
    }}>{children}</Ctx.Provider>
  );
}
export function useNav() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useNav outside NavProvider");
  return v;
}
