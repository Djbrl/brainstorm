// Owned by the lead. Cross-view navigation: which view, which session, which file is focused.
// Thread replay (map) state and hidden agents added by the thread-replay foundation.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export type View = "follow" | "map" | "failures";
export type ReplaySpeed = 1 | 2 | 4;
/** A thread being replayed on the map. `index` is the current beat (see lib/thread.ts). */
export type ThreadReplay = { sessionId: string; index: number; playing: boolean; speed: ReplaySpeed };

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
  /** Open the map and replay a thread from `index` (default 0), paused. */
  startReplay: (sessionId: string, index?: number) => void;
  /** Move the replay cursor. The caller clamps to the thread length. */
  setReplayIndex: (i: number | ((prev: number) => number)) => void;
  setReplayPlaying: (playing: boolean) => void;
  setReplaySpeed: (speed: ReplaySpeed) => void;
  stopReplay: () => void;

  /** Agents hidden from the map (agent ids: sessionId for main threads, agentId for subagents). */
  hiddenAgents: ReadonlySet<string>;
  toggleAgent: (id: string) => void;
  setHiddenAgents: (ids: Iterable<string>) => void;
};
const Ctx = createContext<Nav | null>(null);

const HIDDEN_KEY = "brainstorm-hidden-agents";
function loadHidden(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]") as string[]); } catch { return new Set(); }
}

export function NavProvider({ children }: { children: ReactNode }) {
  const params = new URLSearchParams(location.search);
  const [view, setView] = useState<View>(() => ((params.get("view") as View) || "follow"));
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [focusFile, setFocusFile] = useState<string | null>(null);
  const [focusStep, setFocusStep] = useState<string | null>(null);
  // Deep link: ?view=map&thread=<sessionId>&beat=<n>
  const [replay, setReplay] = useState<ThreadReplay | null>(() => {
    const t = params.get("thread");
    return t ? { sessionId: t, index: Math.max(0, Number(params.get("beat")) || 0), playing: false, speed: 1 } : null;
  });
  const [hiddenAgents, setHidden] = useState<Set<string>>(loadHidden);

  // Keep the view (and a replay) in the URL so a reload (e.g. the dev server reacting to agents editing this very repo) stays put.
  useEffect(() => {
    const u = new URL(location.href);
    u.searchParams.set("view", view);
    if (replay) { u.searchParams.set("thread", replay.sessionId); u.searchParams.set("beat", String(replay.index)); }
    else { u.searchParams.delete("thread"); u.searchParams.delete("beat"); }
    if (u.href !== location.href) history.replaceState(null, "", u);
  }, [view, replay?.sessionId, replay?.index]);

  useEffect(() => {
    try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hiddenAgents])); } catch { /* storage blocked: hidden agents reset on reload */ }
  }, [hiddenAgents]);

  const openFile = (p: string) => { setFocusFile(p); setView("map"); };
  const openStep = (sid: string, stepId: string) => { setSessionId(sid); setFocusStep(stepId); setView("follow"); };

  const startReplay = useCallback((sid: string, index = 0) => { setReplay({ sessionId: sid, index, playing: false, speed: 1 }); setView("map"); }, []);
  const setReplayIndex = useCallback((i: number | ((prev: number) => number)) =>
    setReplay((r) => (r ? { ...r, index: Math.max(0, typeof i === "function" ? i(r.index) : i) } : r)), []);
  const setReplayPlaying = useCallback((playing: boolean) => setReplay((r) => (r ? { ...r, playing } : r)), []);
  const setReplaySpeed = useCallback((speed: ReplaySpeed) => setReplay((r) => (r ? { ...r, speed } : r)), []);
  const stopReplay = useCallback(() => setReplay(null), []);

  const toggleAgent = useCallback((id: string) => setHidden((h) => { const n = new Set(h); if (n.has(id)) n.delete(id); else n.add(id); return n; }), []);
  const setHiddenAgents = useCallback((ids: Iterable<string>) => setHidden(new Set(ids)), []);

  return (
    <Ctx.Provider value={{
      view, setView, sessionId, setSessionId, focusFile, setFocusFile, openFile, focusStep, setFocusStep, openStep,
      replay, startReplay, setReplayIndex, setReplayPlaying, setReplaySpeed, stopReplay,
      hiddenAgents, toggleAgent, setHiddenAgents,
    }}>{children}</Ctx.Provider>
  );
}
export function useNav() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useNav outside NavProvider");
  return v;
}
