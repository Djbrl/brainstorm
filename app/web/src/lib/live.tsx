// Owned by the lead. One store for the whole app: REST bootstrap + websocket updates, or a static replay file.
//
// The state lives in an external store (not React state). WebSocket messages are queued and applied together, once
// per animation frame (or after 100 ms when the tab is in the background), so a burst of messages costs one render.
// The reducer keeps indexes beside the state (file path → position, step id → thread and position, outgoing imports
// per file) so a message touches only what it changes: one file, one thread's step list.
//
// Reading it:
//   useLiveSelector(s => s.sessions)          renders again only when that slice changes (Object.is). For a selector
//   useLiveSelector(s => ({ a: s.a, b: s.b }), shallowEqual)   that builds an object, pass shallowEqual.
//   useLiveActions()                          { loadSteps, reload }, never changes.
//   useLiveStep(stepId)                       one step by id, without scanning a thread.
//   useLive()                                 { state, loadSteps, reload }: the whole state, renders on every change.
// Migrating a component: replace `const { state } = useLive()` with one useLiveSelector per thing it reads (or one
// shallowEqual object). Selectors must not build new arrays/objects each call unless eq handles it. `state.map` is a
// new object whenever any file changes (recency, active thread); for work that only depends on which files exist
// (layout, path resolvers, the file tree) key memos on `state.structureVersion` instead.
import { installSetupShim, startAgentPlayback } from "./preview";
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { AgentPresence, Attention, AskRequest, AskResponse, Edge, FileNode, GitState, Harness, SetupStatus, ProjectMap, Replay, Session, Step, WsMessage } from "@contract";
import { harnessOf, withHarness } from "./harness";
import { listeners, shallowEqual, useStoreSelector } from "./store";

export { shallowEqual };

export type LiveState = {
  connected: boolean;
  replay: boolean;
  sessions: Session[];
  steps: Record<string, Step[]>;   // by sessionId, ordered by seq
  map: ProjectMap | null;
  /**
   * Bumps on every file added or removed, a file's module changing, and every new map (a "map" message, a reload or
   * workspace switch, a replay), even when its paths look the same. Unchanged means: the same file paths in the same
   * order, the same root and former roots. Recency, activity, summary and line-count updates don't bump it.
   */
  structureVersion: number;
  agents: Record<string, AgentPresence>; // live agents by id (main session thread or subagent)
  setup: SetupStatus | null;             // null until loaded (and always null in replay)
  preview: boolean;                      // replay built for the post-deadline preview (agent + setup playback)
  shared: Replay["shared"] | null;       // a replay file someone shared from their Rundown
  attention: Record<string, Attention>;  // by sessionId: is a thread waiting on you (local app only)
  sessionsLoaded: boolean;               // the thread list has arrived (so a thread missing from it really is missing)
  git: GitState | null;                  // the project's branch, uncommitted and unpushed files, worktrees (null: not a repo, or not loaded)
};

type Action =
  | { type: "connected"; value: boolean }
  | { type: "sessions"; sessions: Session[] }
  | { type: "steps"; sessionId: string; steps: Step[] }
  | { type: "map"; map: ProjectMap }
  | { type: "agents"; agents: AgentPresence[] }
  | { type: "attention-all"; list: Attention[] }
  | { type: "setup-status"; status: SetupStatus }
  | { type: "reset" }
  | { type: "replay"; data: Replay }
  | WsMessage;

const initial: LiveState = { connected: false, replay: false, sessions: [], steps: {}, map: null, structureVersion: 0, agents: {}, setup: null, preview: false, shared: null, attention: {}, sessionsLoaded: false, git: null };

/** Lookups kept beside the state, always for the store's current state. */
type Indexes = {
  fileAt: Map<string, number>;                         // path → position in map.files
  edgesFrom: Map<string, Edge[]>;                      // path → its outgoing imports
  stepAt: Map<string, { sid: string; i: number }>;     // step id → its thread and position in that thread's list
};

function indexMap(ix: Indexes, map: ProjectMap | null) {
  ix.fileAt.clear(); ix.edgesFrom.clear();
  if (!map) return;
  map.files.forEach((f, i) => ix.fileAt.set(f.path, i));
  for (const e of map.edges) { const l = ix.edgesFrom.get(e.from); if (l) l.push(e); else ix.edgesFrom.set(e.from, [e]); }
}
function indexSteps(ix: Indexes, sid: string, list: Step[]) { list.forEach((st, i) => ix.stepAt.set(st.id, { sid, i })); }
function reindex(ix: Indexes, s: LiveState) {
  indexMap(ix, s.map);
  ix.stepAt.clear();
  for (const [sid, list] of Object.entries(s.steps)) indexSteps(ix, sid, list);
}

const byRecency = (a: Session, b: Session) => b.lastEventAt.localeCompare(a.lastEventAt);
const sortSessions = (l: Session[]) => l.map(withHarness).sort(byRecency);
const sameEdges = (a: Edge[], b: Edge[]) => a.length === b.length && a.every((e, k) => e.to === b[k].to);

/**
 * Applies a batch of actions to a state. Each container (the state, map, files, a thread's steps…) is copied at most
 * once per batch, then changed in place, so N messages cost one copy, not N; untouched containers keep their identity.
 */
function applyBatch(base: LiveState, actions: Action[], ix: Indexes): LiveState {
  let s = base;
  const owned = new Set<object>();
  const own = <T extends object>(o: T, copy: (o: T) => T): T => { if (owned.has(o)) return o; const c = copy(o); owned.add(c); return c; };
  const st = () => (s === base ? (s = { ...base }) : s);
  const steps = () => (st().steps = own(s.steps, (o) => ({ ...o })));
  const map = () => (st().map = own(s.map!, (o) => ({ ...o })));
  const files = () => (map().files = own(s.map!.files, (o) => o.slice()));
  let sortNeeded = false;
  const removed = new Set<string>(), changedFrom = new Set<string>(); // files whose imports changed, files removed

  for (const a of actions) {
    switch (a.type) {
      case "connected": if (s.connected !== a.value) st().connected = a.value; break;
      case "sessions": st().sessions = sortSessions(a.sessions); owned.add(s.sessions); s.sessionsLoaded = true; sortNeeded = false; break;
      case "session": {
        const list = st().sessions = own(s.sessions, (o) => o.slice());
        const i = list.findIndex((x) => x.id === a.session.id);
        if (i !== -1) list.splice(i, 1);
        list.unshift(withHarness(a.session));
        sortNeeded = true;
        break;
      }
      case "steps": {
        for (const old of s.steps[a.sessionId] ?? []) if (ix.stepAt.get(old.id)?.sid === a.sessionId) ix.stepAt.delete(old.id);
        steps()[a.sessionId] = a.steps;
        owned.add(a.steps); // freshly fetched: nobody else holds it yet
        indexSteps(ix, a.sessionId, a.steps);
        break;
      }
      case "step": {
        const sid = a.step.sessionId, list = s.steps[sid];
        if (!list) break; // not loaded yet; will come with the REST fetch
        if (ix.stepAt.get(a.step.id)?.sid === sid) break;
        const next = steps()[sid] = own(list, (o) => o.slice());
        next.push(a.step);
        ix.stepAt.set(a.step.id, { sid, i: next.length - 1 });
        break;
      }
      case "step-update": {
        const at = ix.stepAt.get(a.id);
        if (!at) break; // its thread isn't loaded
        const list = s.steps[at.sid];
        let i = at.i;
        if (list?.[i]?.id !== a.id) { i = list ? list.findIndex((x) => x.id === a.id) : -1; if (i === -1) break; at.i = i; }
        const next = steps()[at.sid] = own(list, (o) => o.slice());
        next[i] = { ...next[i], ...(a.label !== undefined && { label: a.label }), ...(a.risk !== undefined && { risk: a.risk }) };
        break;
      }
      case "map": st().map = a.map; s.structureVersion++; indexMap(ix, a.map); changedFrom.clear(); removed.clear(); break;
      case "file": {
        if (!s.map) break;
        const i = ix.fileAt.get(a.file.path);
        const list = files();
        if (i === undefined) { ix.fileAt.set(a.file.path, list.length); list.push(a.file); s.structureVersion++; removed.delete(a.file.path); }
        else { if (a.file.module !== list[i].module) s.structureVersion++; list[i] = { ...list[i], ...a.file }; }
        if (a.edges && !sameEdges(ix.edgesFrom.get(a.file.path) ?? [], a.edges)) {
          if (a.edges.length) ix.edgesFrom.set(a.file.path, a.edges); else ix.edgesFrom.delete(a.file.path);
          changedFrom.add(a.file.path);
        }
        break;
      }
      case "file-removed": {
        const i = s.map ? ix.fileAt.get(a.path) : undefined;
        if (i === undefined) break;
        const list = files();
        list.splice(i, 1);
        ix.fileAt.delete(a.path);
        for (let k = i; k < list.length; k++) ix.fileAt.set(list[k].path, k);
        ix.edgesFrom.delete(a.path);
        removed.add(a.path); changedFrom.add(a.path);
        s.structureVersion++;
        break;
      }
      case "agents": st().agents = Object.fromEntries(a.agents.map((g) => [g.id, g])); owned.add(s.agents); break;
      case "agent": (st().agents = own(s.agents, (o) => ({ ...o })))[a.agent.id] = a.agent; break;
      case "attention-all": st().attention = Object.fromEntries(a.list.map((x) => [x.sessionId, x])); owned.add(s.attention); break;
      case "attention": (st().attention = own(s.attention, (o) => ({ ...o })))[a.attention.sessionId] = a.attention; break;
      case "setup-status": case "setup": st().setup = a.status; break;
      case "git": st().git = a.git; break;
      case "reset":
        Object.assign(st(), { sessions: [], steps: {}, map: null, agents: {}, attention: {}, sessionsLoaded: false, git: null, structureVersion: s.structureVersion + 1 });
        reindex(ix, s); sortNeeded = false; changedFrom.clear(); removed.clear();
        break;
      case "replay": {
        const byThread: Record<string, Step[]> = {};
        for (const x of a.data.steps) (byThread[x.sessionId] ??= []).push(x);
        Object.values(byThread).forEach((l) => l.sort((x, y) => x.seq - y.seq));
        Object.assign(st(), {
          sessionsLoaded: true, replay: true, connected: true, sessions: sortSessions(a.data.sessions), steps: byThread, map: a.data.map,
          structureVersion: s.structureVersion + 1, preview: !!(a.data.agentMoves?.length || a.data.setupPreview), shared: a.data.shared ?? null,
        });
        reindex(ix, s); sortNeeded = false; changedFrom.clear(); removed.clear();
        break;
      }
    }
  }

  if (sortNeeded) s.sessions.sort(byRecency); // owned: copied by the first "session" of the batch
  // Imports: one pass over the edges, whatever the number of changed files (a removed file's imports go both ways).
  if ((changedFrom.size || removed.size) && s.map) {
    if (removed.size) for (const [from, l] of ix.edgesFrom) {
      const kept = l.filter((e) => !removed.has(e.to));
      if (kept.length !== l.length) { if (kept.length) ix.edgesFrom.set(from, kept); else ix.edgesFrom.delete(from); }
    }
    const edges: Edge[] = [];
    for (const e of s.map.edges) if (!changedFrom.has(e.from) && !removed.has(e.to)) edges.push(e);
    for (const from of changedFrom) for (const e of ix.edgesFrom.get(from) ?? []) edges.push(e);
    map().edges = edges;
  }
  return s;
}

export type LiveStore = {
  get: () => LiveState;
  subscribe: (listener: () => void) => () => void;
  /** Apply now (with anything queued before it). */
  dispatch: (a: Action) => void;
  /** Queue a message: applied with the others at the next frame. */
  enqueue: (a: Action) => void;
  /** A step by id, if its thread is loaded. */
  stepOf: (id: string) => Step | undefined;
  loadSteps: (sessionId: string) => void;
  /** Refetch everything for the (new) active workspace. */
  reload: () => void;
};

export function createLiveStore(start: LiveState = initial): LiveStore {
  let state = start;
  const ix: Indexes = { fileAt: new Map(), edgesFrom: new Map(), stepAt: new Map() };
  reindex(ix, state);
  const { subscribe, emit } = listeners();
  let queue: Action[] = [];
  let frame = 0, timer: ReturnType<typeof setTimeout> | undefined;

  const flush = () => {
    if (frame) { cancelAnimationFrame(frame); frame = 0; }
    if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
    if (!queue.length) return;
    const batch = queue; queue = [];
    let next: LiveState;
    try { next = applyBatch(state, batch, ix); }
    catch (e) { console.error("live store: a batch failed", e); reindex(ix, state); return; }
    if (next === state) return;
    state = next;
    emit();
  };
  const enqueue = (a: Action) => {
    queue.push(a);
    if (frame || timer !== undefined) return;
    // A frame when the tab is visible; the timer covers background tabs, where frames don't run.
    if (typeof requestAnimationFrame === "function") frame = requestAnimationFrame(flush);
    timer = setTimeout(flush, 100);
  };
  const dispatch = (a: Action) => { queue.push(a); flush(); };

  // A thread's steps are fetched once at a time (several views ask for the same thread when it opens).
  const loading = new Set<string>();
  let generation = 0; // bumps on reload: answers for the previous workspace are dropped
  const loadSteps = (sessionId: string) => {
    if (isReplay() || loading.has(sessionId)) return;
    loading.add(sessionId);
    const gen = generation;
    fetch(`/api/sessions/${encodeURIComponent(sessionId)}/steps`).then((r) => r.json())
      .then((steps: Step[]) => { if (gen === generation && Array.isArray(steps)) dispatch({ type: "steps", sessionId, steps }); })
      .catch(() => {})
      .finally(() => { if (gen === generation) loading.delete(sessionId); });
  };
  const reload = () => { if (isReplay()) return; generation++; loading.clear(); dispatch({ type: "reset" }); loadAll(dispatch); };
  const stepOf = (id: string) => {
    const at = ix.stepAt.get(id), st = at && state.steps[at.sid]?.[at.i];
    return st && st.id === id ? st : undefined;
  };
  return { get: () => state, subscribe, dispatch, enqueue, stepOf, loadSteps, reload };
}

// Hosted demo: built with VITE_REPLAY_URL=/replay.json so it opens straight into the recording.
// Both can't change without a reload (links keep ?replay=, see nav.tsx), so they're read once.
let replayUrlValue: string | null | undefined;
const replayUrl = () => (replayUrlValue === undefined
  ? (replayUrlValue = new URLSearchParams(location.search).get("replay") ?? (import.meta.env.VITE_REPLAY_URL as string | undefined) ?? null)
  : replayUrlValue);

/** A shared replay file (GET /api/share) carries its recording inline, so it opens with no server. */
let embedded: Replay | null | undefined;
function embeddedReplay(): Replay | null {
  if (embedded === undefined) {
    const text = (document.getElementById("rundown-replay") ?? document.getElementById("brainstorm-replay"))?.textContent;
    try { embedded = text ? (JSON.parse(text) as Replay) : null; } catch { embedded = null; }
  }
  return embedded;
}
let replayMode: boolean | undefined;
/** A recording (hosted demo or shared file) rather than the live app. Read once, then a constant. */
export const isReplay = () => (replayMode ??= !!embeddedReplay() || !!replayUrl());

let replayData: Replay | null = null;
/** Places of a recorded thread (the hosted demos have no server to ask). */
export const replayCowork = (sessionId: string) => replayData?.cowork?.[sessionId] ?? null;

/** App clock. In replay mode it runs from the export time, so "just now" and recency colors look as they did when recorded. */
let clockOffset = 0;
export const clock = () => Date.now() - clockOffset;
export async function replayAnswer(req: AskRequest): Promise<AskResponse> {
  const hit = replayData?.answers.find((a) => a.request.question === req.question && a.request.stepId === req.stepId && a.request.filePath === req.filePath)
    ?? replayData?.answers.find((a) => (req.stepId && a.request.stepId === req.stepId) || (req.filePath && a.request.filePath === req.filePath));
  if (hit) return hit.response;
  return { answer: "This is a recorded demo. Run Rundown locally to ask new questions.", model: "replay", tokensIn: 0, tokensOut: 0, costUsd: 0, fallback: false };
}

/** Load everything for the active workspace (on start, and again after the setup screen switches workspace). */
function loadAll(dispatch: (a: Action) => void) {
  fetch("/api/workspace").then((r) => r.json()).then((status) => dispatch({ type: "setup-status", status })).catch(() => {});
  fetch("/api/sessions").then((r) => r.json()).then((sessions) => dispatch({ type: "sessions", sessions })).catch(() => {});
  fetch("/api/map").then((r) => r.json()).then((map) => dispatch({ type: "map", map })).catch(() => {});
  fetch("/api/agents").then((r) => r.json()).then((agents) => dispatch({ type: "agents", agents })).catch(() => {});
  fetch("/api/attention").then((r) => r.json()).then((list) => Array.isArray(list) && dispatch({ type: "attention-all", list })).catch(() => {});
  fetch("/api/git").then((r) => r.text()).then((t) => dispatch({ type: "git", git: t ? JSON.parse(t) : null })).catch(() => {});
}

const Ctx = createContext<LiveStore | null>(null);

export function LiveProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createLiveStore);

  useEffect(() => {
    const url = replayUrl(), inline = embeddedReplay();
    if (inline || url) {
      let stopPlayback = () => {};
      (inline ? Promise.resolve(inline) : fetch(url!).then((r) => r.json() as Promise<Replay>)).then((data: Replay) => {
        replayData = data; clockOffset = Math.max(0, Date.now() - Date.parse(data.exportedAt));
        store.dispatch({ type: "replay", data });
        installSetupShim(data);
        stopPlayback = startAgentPlayback(data, store.enqueue);
      });
      return () => stopPlayback();
    }
    loadAll(store.dispatch);

    let ws: WebSocket | null = null;
    let stop = false;
    const connect = () => {
      ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
      ws.onopen = () => store.dispatch({ type: "connected", value: true });
      ws.onclose = () => { store.dispatch({ type: "connected", value: false }); if (!stop) setTimeout(connect, 1500); };
      ws.onmessage = (e) => { try { store.enqueue(JSON.parse(e.data) as WsMessage); } catch {} };
    };
    connect();
    return () => { stop = true; ws?.close(); };
  }, [store]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

function useStore(): LiveStore {
  const store = useContext(Ctx);
  if (!store) throw new Error("live store used outside LiveProvider");
  return store;
}

/** A slice of the live state: renders again only when it changes (by `eq`, Object.is by default). */
export function useLiveSelector<T>(select: (s: LiveState) => T, eq?: (a: T, b: T) => boolean): T {
  return useStoreSelector(useStore(), select, eq);
}

/** Which agent ran a thread ("claude" when it isn't known). */
export const useHarness = (sessionId?: string | null): Harness =>
  useLiveSelector((s) => harnessOf(sessionId ? s.sessions.find((x) => x.id === sessionId) : undefined));

/** `loadSteps` and `reload`; the same functions for the app's lifetime. */
export function useLiveActions(): Pick<LiveStore, "loadSteps" | "reload"> {
  const store = useStore();
  return useMemo(() => ({ loadSteps: store.loadSteps, reload: store.reload }), [store]);
}

/** One step by id (undefined until its thread is loaded). */
export function useLiveStep(stepId: string | null | undefined): Step | undefined {
  const store = useStore();
  return useStoreSelector(store, () => (stepId ? store.stepOf(stepId) : undefined));
}

/** The whole state: renders on every change. Prefer useLiveSelector in new code. */
export function useLive() {
  const store = useStore();
  const state = useSyncExternalStore(store.subscribe, store.get, store.get);
  return useMemo(() => ({ state, loadSteps: store.loadSteps, reload: store.reload }), [state, store]);
}
