// Owned by the lead. Where you are in the app, and the links for it.
//
// Three levels, one at a time:
//   /                                   the project: the map at rest, live agents as dots, what changed since you last looked
//   /thread/<id>                        one thread: its steps, at the end (a running one follows live); its replay from the footer
//   /thread/<id>/step/<stepId>          one step, in a side panel (its diff, its output, Ask)
// A thread can be seen three ways, the lens: /thread/<id> (the map), /thread/<id>/track, /thread/<id>/places.
// Opening or closing a thread, a step or a lens adds a browser history entry, so Back and Esc go up one level. Moving
// through a replay doesn't. A file opened from disk (a shared replay) keeps the same paths after a `#`.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { ReplayDetail } from "./thread";

/** How a thread is shown: where it happened in the code, the story as a vertical track, or the places it went outside the code. */
export type Lens = "map" | "track" | "places";
export type ReplaySpeed = 1 | 2 | 4;
/**
 * How much of an open thread is out: its steps as a list (what opening a thread shows), or the replay with its player
 * (from the footer). "footprint", the files it touched all lit at once with no tracer, is no longer opened by the UI.
 */
export type ThreadMode = "footprint" | "steps" | "play";
/** Open a thread at its end: the index is clamped to its last moment once it loads (a running one then follows live). */
export const END = Number.MAX_SAFE_INTEGER;
/**
 * An open thread. `index` is the current beat (see lib/thread.ts) in `detail` mode.
 * `atStep` is a step id to land on once the thread is built (links, switching detail); the replay layer resolves and clears it.
 */
export type ThreadReplay = { sessionId: string; index: number; playing: boolean; speed: ReplaySpeed; detail: ReplayDetail; mode: ThreadMode; atStep?: string; live?: boolean };

/**
 * Map display prefs read by the canvas layers (live agents, thread replay) on every frame.
 * Kept in sync with the `showReads` nav state; mutate only through setShowReads.
 */
export const mapPrefs: { showReads: boolean } = { showReads: true };

/** The step id at the replay cursor, published by the replay layer while rendering. */
export const replayCursor: { stepId: string | null } = { stepId: null };

type Nav = {
  focusFile: string | null; setFocusFile: (p: string | null) => void;
  /** Select a file on the map. */
  openFile: (path: string) => void;

  /** The open thread, or null on the project overview. */
  replay: ThreadReplay | null;
  /** Open a thread: its footprint unless `mode` says otherwise, landing on a beat index or on the beat holding a step id. `live` follows its newest step. */
  startReplay: (sessionId: string, at?: number | string, opts?: { live?: boolean; mode?: ThreadMode }) => void;
  /** Show more or less of the open thread (footprint → steps → play). */
  setThreadMode: (mode: ThreadMode) => void;
  /** Keep a live replay on the newest beat (called as the thread grows). */
  followLive: (index: number) => void;
  /** Go back to following a running thread live, or stop following. */
  setReplayLive: (live: boolean) => void;
  lens: Lens; setLens: (l: Lens) => void;
  /** Move the replay cursor. The caller clamps to the thread length. */
  setReplayIndex: (i: number | ((prev: number) => number)) => void;
  setReplayPlaying: (playing: boolean) => void;
  setReplaySpeed: (speed: ReplaySpeed) => void;
  /** Switch between the light replay (summaries) and every step, staying on the same step. */
  setReplayDetail: (detail: ReplayDetail, atStep?: string) => void;
  /** Clear `atStep` after landing on it, at `index`. */
  landReplay: (index: number) => void;
  /** Close the thread: back to the project. */
  stopReplay: () => void;

  /** The step open in the side panel, or null. */
  step: string | null;
  /** Open a step of a thread in the side panel (opening the thread first if needed). */
  openStep: (sessionId: string, stepId: string) => void;
  /** Show another step of the open thread in the panel as the cursor moves (scrolling, scrubbing): no new history entry. */
  showStep: (stepId: string) => void;
  closeStep: () => void;
  /** Up one level: step → thread → project. */
  back: () => void;

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

// ---- links ----

type Place = { thread: string | null; step: string | null; lens: Lens };
const hashMode = typeof location !== "undefined" && location.protocol === "file:"; // a shared .html opened from disk

/** The query a hosted demo needs on every link (?replay=…), kept as is. */
function keptQuery(): string {
  const replay = new URLSearchParams(location.search).get("replay");
  return replay ? `?${new URLSearchParams({ replay })}` : "";
}

export function pathFor(p: Place): string {
  if (!p.thread) return "/";
  let path = `/thread/${encodeURIComponent(p.thread)}${p.lens === "map" ? "" : `/${p.lens}`}`;
  if (p.step) path += `/step/${encodeURIComponent(p.step)}`;
  return path;
}

function readPlace(): Place {
  const raw = hashMode ? location.hash.replace(/^#/, "") || "/" : location.pathname;
  const m = /^\/thread\/([^/]+)(?:\/(track|places))?(?:\/step\/([^/]+))?\/?$/.exec(raw);
  if (m) return { thread: decodeURIComponent(m[1]), lens: (m[2] as Lens) ?? "map", step: m[3] ? decodeURIComponent(m[3]) : null };
  // Links from before the paths: ?view=map&lens=places&thread=<id>&step=<id> (and ?view=cowork for Places).
  const q = new URLSearchParams(location.search), thread = q.get("thread");
  const lens: Lens = q.get("lens") === "track" || q.get("lens") === "places" ? (q.get("lens") as Lens) : q.get("view") === "cowork" ? "places" : "map";
  return { thread, step: thread ? q.get("step") : null, lens: thread ? lens : "map" };
}

const hrefFor = (p: Place) => (hashMode ? `${location.pathname}${keptQuery()}#${pathFor(p)}` : `${pathFor(p)}${keptQuery()}`);
const hereHref = () => (hashMode ? `${location.pathname}${location.search}${location.hash || "#/"}` : `${location.pathname}${location.search}`);

export function NavProvider({ children }: { children: ReactNode }) {
  const first = useRef<Place | null>(null);
  if (!first.current) first.current = readPlace();
  const [focusFile, setFocusFile] = useState<string | null>(null);
  const [replay, setReplay] = useState<ThreadReplay | null>(() => {
    const f = first.current!;
    return f.thread ? { sessionId: f.thread, index: END, playing: false, speed: 1, detail: "light", mode: "steps", atStep: f.step ?? undefined } : null;
  });
  const [step, setStep] = useState<string | null>(first.current.step);
  const [lens, setLensState] = useState<Lens>(first.current.lens);
  const [hiddenAgents, setHidden] = useState<Set<string>>(loadHidden);
  const [showReads, setShowReadsState] = useState<boolean>(() => (mapPrefs.showReads = loadShowReads()));
  const setShowReads = useCallback((v: boolean) => {
    mapPrefs.showReads = v;
    setShowReadsState(v);
    try { localStorage.setItem(READS_KEY, v ? "1" : "0"); } catch { /* storage blocked: resets on reload */ }
  }, []);

  // The URL follows the place (thread, lens, step): a new history entry per move, except when the move came from the URL.
  const fromUrl = useRef(true); // the first render matches the URL already (an old ?view= link is rewritten in place)
  const replaceNext = useRef(false); // a move that shouldn't add a history entry (the panel following the cursor)
  const thread = replay?.sessionId ?? null;
  useEffect(() => {
    const href = hrefFor({ thread, step: thread ? step : null, lens: thread ? lens : "map" });
    if (href !== hereHref()) {
      if (fromUrl.current || replaceNext.current) history.replaceState(null, "", href);
      else history.pushState(null, "", href);
    }
    fromUrl.current = false;
    replaceNext.current = false;
  }, [thread, step, lens]);

  // Back and Forward: go where the URL says.
  useEffect(() => {
    const onPop = () => {
      const p = readPlace();
      fromUrl.current = true;
      setLensState(p.lens);
      setStep(p.step);
      setReplay((r) => {
        if (!p.thread) { replayCursor.stepId = null; return null; }
        if (r && r.sessionId === p.thread) return p.step ? { ...r, atStep: p.step, playing: false, mode: r.mode === "footprint" ? "steps" : r.mode } : r;
        return { sessionId: p.thread, index: END, playing: false, speed: r?.speed ?? 1, detail: r?.detail ?? "light", mode: "steps", atStep: p.step ?? undefined };
      });
    };
    addEventListener(hashMode ? "hashchange" : "popstate", onPop);
    return () => removeEventListener(hashMode ? "hashchange" : "popstate", onPop);
  }, []);

  useEffect(() => {
    try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hiddenAgents])); } catch { /* storage blocked: hidden agents reset on reload */ }
  }, [hiddenAgents]);

  const startReplay = useCallback((sid: string, at: number | string = 0, opts?: { live?: boolean; mode?: ThreadMode }) => {
    setReplay((r) => ({
      sessionId: sid, playing: false, speed: r?.speed ?? 1, detail: r?.detail ?? "light", mode: opts?.mode ?? "steps",
      index: typeof at === "number" ? Math.max(0, at) : 0, atStep: typeof at === "string" ? at : undefined, live: !!opts?.live,
    }));
    setStep(null);
  }, []);
  const stopReplay = useCallback(() => { replayCursor.stepId = null; setReplay(null); setStep(null); }, []);
  const setThreadMode = useCallback((mode: ThreadMode) => setReplay((r) => (r ? { ...r, mode, playing: mode === "play" ? r.playing : false } : r)), []);
  const openFile = useCallback((p: string) => { setFocusFile(p); setLensState("map"); }, []);
  const setLens = useCallback((l: Lens) => { setLensState(l); setStep(null); }, []);
  // Moving the cursor by hand stops following live; followLive is the only setter that keeps it.
  const setReplayIndex = useCallback((i: number | ((prev: number) => number)) =>
    setReplay((r) => (r ? { ...r, live: false, index: Math.max(0, typeof i === "function" ? i(r.index) : i) } : r)), []);
  const followLive = useCallback((i: number) => setReplay((r) => (r && r.live && r.index !== i ? { ...r, index: Math.max(0, i), atStep: undefined } : r)), []);
  const setReplayLive = useCallback((live: boolean) => setReplay((r) => (r ? { ...r, live, playing: false, mode: r.mode === "footprint" ? "steps" : r.mode } : r)), []);
  const setReplayPlaying = useCallback((playing: boolean) => setReplay((r) => (r ? { ...r, playing, live: playing ? false : r.live, mode: playing ? "play" : r.mode } : r)), []);
  const setReplaySpeed = useCallback((speed: ReplaySpeed) => setReplay((r) => (r ? { ...r, speed } : r)), []);
  const setReplayDetail = useCallback((detail: ReplayDetail, atStep?: string) =>
    setReplay((r) => (r ? { ...r, detail, playing: false, atStep: atStep ?? replayCursor.stepId ?? undefined } : r)), []);
  const landReplay = useCallback((index: number) => setReplay((r) => (r ? { ...r, index: Math.max(0, index), atStep: undefined } : r)), []);

  const openStep = useCallback((sid: string, stepId: string) => {
    setReplay((r) => (r && r.sessionId === sid
      ? { ...r, atStep: stepId, playing: false, live: false, mode: r.mode === "footprint" ? "steps" : r.mode }
      : { sessionId: sid, index: 0, playing: false, speed: r?.speed ?? 1, detail: r?.detail ?? "light", mode: "steps", atStep: stepId }));
    setStep(stepId);
  }, []);
  const showStep = useCallback((stepId: string) => { replaceNext.current = true; setStep(stepId); }, []);
  const closeStep = useCallback(() => setStep(null), []);
  const back = useCallback(() => {
    if (step) { setStep(null); return; }
    if (replay?.mode === "play") { setThreadMode("steps"); return; }
    if (replay) stopReplay();
  }, [step, replay, setThreadMode, stopReplay]);

  const toggleAgent = useCallback((id: string) => setHidden((h) => { const n = new Set(h); if (n.has(id)) n.delete(id); else n.add(id); return n; }), []);
  const setHiddenAgents = useCallback((ids: Iterable<string>) => setHidden(new Set(ids)), []);

  return (
    <Ctx.Provider value={{
      focusFile, setFocusFile, openFile,
      replay, startReplay, setThreadMode, setReplayIndex, setReplayPlaying, setReplaySpeed, setReplayDetail, landReplay, stopReplay, followLive, setReplayLive, lens, setLens,
      step, openStep, showStep, closeStep, back,
      hiddenAgents, toggleAgent, setHiddenAgents, showReads, setShowReads,
    }}>{children}</Ctx.Provider>
  );
}
export function useNav() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useNav outside NavProvider");
  return v;
}
