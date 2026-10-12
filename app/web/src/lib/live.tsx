// One store for the whole app: REST bootstrap + websocket updates, or a static replay file.
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
// A thread's steps are fetched once, then kept up to date by "step" messages; history the server stores without
// sending it step by step ("steps-stored", and every loaded thread after a reconnect) is fetched with ?afterSeq=.
//   useLiveStep(stepId)                       one step by id, without scanning a thread.
// Selectors must not build new arrays/objects each call unless eq handles it. `state.map` is a
// new object whenever any file changes (recency, active thread); for work that only depends on which files exist
// (layout, path resolvers, the file tree) key memos on `state.structureVersion` instead.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AgentPresence, Attention, AskRequest, AskResponse, Edge, Harness, LiveToken, SetupStatus, ProjectMap, Replay, Session, Step, WsMessage } from "@contract";
import { harnessOf, withHarness } from "./harness";
import { listeners, shallowEqual, useStoreSelector } from "./store";
import { get } from "./api";

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
};

type Action =
  | { type: "connected"; value: boolean }
  | { type: "sessions"; sessions: Session[] }
  | { type: "steps"; sessionId: string; steps: Step[] }
  | { type: "steps-more"; sessionId: string; steps: Step[] } // a thread's steps after the ones it has (catchUp)
  | { type: "map"; map: ProjectMap }
  | { type: "agents"; agents: AgentPresence[] }
  | { type: "attention-all"; list: Attention[] }
  | { type: "reset" }
  /** Let go of these threads' steps (no view holds them; see LiveStore.hold). */
  | { type: "evict"; sessionIds: string[] }
  /** Forget agents the server dropped (it does so quietly, after AGENT_DROP_MS without a move). */
  | { type: "sweep"; now: number }
  | { type: "replay"; data: Replay }
  | WsMessage;

const initial: LiveState = { connected: false, replay: false, sessions: [], steps: {}, map: null, structureVersion: 0, agents: {}, setup: null, preview: false, shared: null, attention: {}, sessionsLoaded: false };

/** Lookups kept beside the state, always for the store's current state. */
type Indexes = {
  fileAt: Map<string, number>;                         // path → position in map.files
  edgesFrom: Map<string, Edge[]>;                      // path → its outgoing imports
  stepAt: Map<string, { sid: string; i: number }>;     // step id → its thread and position in that thread's list
  serverStatus: Map<string, Session["status"]>;        // thread id → the status the server sent (before attention's say)
  through: Map<string, number>;                        // thread id → the seq its steps are known up to, with none missing
};

/**
 * Attention knows better than the log's last write whether a thread is going: one the model is still thinking for (nothing
 * logged for minutes) or with a long command running is running, not idle. Applied after every batch that changes either.
 */
const BUSY = new Set(["thinking", "working"]);
/** The server forgets an agent this long after its last move (agents.service.ts DROP_MS), without saying so. */
export const AGENT_DROP_MS = 30 * 60_000;
/** Threads no view holds whose steps stay loaded (the last ones let go of), so going back to one is instant. */
export const KEEP_UNHELD = 2;

function indexMap(ix: Indexes, map: ProjectMap | null) {
  ix.fileAt.clear(); ix.edgesFrom.clear();
  if (!map) return;
  map.files.forEach((f, i) => ix.fileAt.set(f.path, i));
  for (const e of map.edges) { const l = ix.edgesFrom.get(e.from); if (l) l.push(e); else ix.edgesFrom.set(e.from, [e]); }
}
function indexSteps(ix: Indexes, sid: string, list: Step[]) { list.forEach((st, i) => ix.stepAt.set(st.id, { sid, i })); }
const lastSeq = (list: Step[]) => list.reduce((m, x) => Math.max(m, x.seq), -1);
function reindex(ix: Indexes, s: LiveState) {
  indexMap(ix, s.map);
  ix.stepAt.clear(); ix.through.clear();
  for (const [sid, list] of Object.entries(s.steps)) { indexSteps(ix, sid, list); ix.through.set(sid, lastSeq(list)); }
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
  let sortNeeded = false, statusCheck = false;
  const removed = new Set<string>(), changedFrom = new Set<string>(); // files whose imports changed, files removed

  for (const a of actions) {
    switch (a.type) {
      case "connected": if (s.connected !== a.value) st().connected = a.value; break;
      case "sessions":
        st().sessions = sortSessions(a.sessions); owned.add(s.sessions); s.sessionsLoaded = true; sortNeeded = false;
        ix.serverStatus.clear(); for (const x of a.sessions) ix.serverStatus.set(x.id, x.status); statusCheck = true;
        break;
      case "session": {
        const list = st().sessions = own(s.sessions, (o) => o.slice());
        const i = list.findIndex((x) => x.id === a.session.id);
        if (i !== -1) list.splice(i, 1);
        list.unshift(withHarness(a.session));
        ix.serverStatus.set(a.session.id, a.session.status); statusCheck = true;
        sortNeeded = true;
        break;
      }
      case "steps": {
        for (const old of s.steps[a.sessionId] ?? []) if (ix.stepAt.get(old.id)?.sid === a.sessionId) ix.stepAt.delete(old.id);
        steps()[a.sessionId] = a.steps;
        owned.add(a.steps); // freshly fetched: nobody else holds it yet
        indexSteps(ix, a.sessionId, a.steps);
        ix.through.set(a.sessionId, lastSeq(a.steps));
        break;
      }
      case "steps-more": {
        const sid = a.sessionId, list = s.steps[sid];
        if (!list) break;
        ix.through.set(sid, Math.max(ix.through.get(sid) ?? -1, lastSeq(a.steps)));
        const add = a.steps.filter((x) => ix.stepAt.get(x.id)?.sid !== sid);
        if (!add.length) break;
        const next = steps()[sid] = own(list, (o) => o.slice());
        const from = next.length;
        next.push(...add);
        // Live steps that came meanwhile have higher seqs: put the list back in seq order.
        if (from && next[from - 1].seq > next[from].seq) { next.sort((x, y) => x.seq - y.seq); indexSteps(ix, sid, next); }
        else add.forEach((x, k) => ix.stepAt.set(x.id, { sid, i: from + k }));
        break;
      }
      case "steps-stored": break; // handled by the store (enqueue): it fetches what a loaded thread lacks
      case "step": {
        const sid = a.step.sessionId, list = s.steps[sid];
        if (!list) break; // not loaded yet; will come with the REST fetch
        if (ix.stepAt.get(a.step.id)?.sid === sid) break;
        const next = steps()[sid] = own(list, (o) => o.slice());
        next.push(a.step);
        ix.stepAt.set(a.step.id, { sid, i: next.length - 1 });
        if (a.step.seq === (ix.through.get(sid) ?? -1) + 1) ix.through.set(sid, a.step.seq);
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
        if (i === undefined) {
          ix.fileAt.set(a.file.path, list.length); list.push(a.file); s.structureVersion++;
          // Removed earlier in this batch: the imports of it go now, as they would have in a batch of their own.
          if (removed.delete(a.file.path)) for (const [from, l] of ix.edgesFrom) {
            const kept = l.filter((e) => e.to !== a.file.path);
            if (kept.length !== l.length) { if (kept.length) ix.edgesFrom.set(from, kept); else ix.edgesFrom.delete(from); changedFrom.add(from); }
          }
        }
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
      case "sweep": {
        if (s.replay) break; // a recording's agents run on the recording's clock
        for (const [id, g] of Object.entries(s.agents)) if (a.now - Date.parse(g.ts) > AGENT_DROP_MS) delete (st().agents = own(s.agents, (o) => ({ ...o })))[id];
        break;
      }
      // An "idle" attention is what the server sends as it forgets a thread (and says no more than no entry): not kept.
      case "attention-all": st().attention = Object.fromEntries(a.list.filter((x) => x.state !== "idle").map((x) => [x.sessionId, x])); owned.add(s.attention); statusCheck = true; break;
      case "attention": {
        const sid = a.attention.sessionId;
        if (a.attention.state !== "idle") (st().attention = own(s.attention, (o) => ({ ...o })))[sid] = a.attention;
        else if (s.attention[sid]) delete (st().attention = own(s.attention, (o) => ({ ...o })))[sid];
        statusCheck = true;
        break;
      }
      case "evict": {
        for (const sid of a.sessionIds) {
          const list = s.steps[sid];
          if (!list) continue;
          for (const x of list) if (ix.stepAt.get(x.id)?.sid === sid) ix.stepAt.delete(x.id);
          ix.through.delete(sid);
          delete steps()[sid];
        }
        break;
      }
      case "setup": st().setup = a.status; break;
      case "reset":
        Object.assign(st(), { sessions: [], steps: {}, map: null, agents: {}, attention: {}, sessionsLoaded: false, structureVersion: s.structureVersion + 1 });
        reindex(ix, s); sortNeeded = false; changedFrom.clear(); removed.clear();
        break;
      case "replay": {
        const byThread: Record<string, Step[]> = {};
        for (const x of a.data.steps) (byThread[x.sessionId] ??= []).push(x);
        Object.values(byThread).forEach((l) => l.sort((x, y) => x.seq - y.seq));
        Object.assign(st(), {
          sessionsLoaded: true, replay: true, connected: true, sessions: sortSessions(a.data.sessions), steps: byThread, map: a.data.map,
          structureVersion: s.structureVersion + 1, preview: DEMO && !!(a.data.agentMoves?.length || a.data.setupPreview), shared: a.data.shared ?? null,
        });
        reindex(ix, s); sortNeeded = false; changedFrom.clear(); removed.clear();
        break;
      }
    }
  }

  if (statusCheck && !s.replay) {
    for (let i = 0; i < s.sessions.length; i++) {
      const x = s.sessions[i];
      const a = s.attention[x.id];
      // A call open for over 10 minutes with nothing else moving is more likely a closed session than a long command
      // (thinking is capped by the server, at 5 minutes).
      const busy = !!a && BUSY.has(a.state) && (a.state === "thinking" || Date.now() - Date.parse(a.since) < 10 * 60_000);
      const want = busy ? "running" : ix.serverStatus.get(x.id) ?? x.status;
      if (x.status !== want) (st().sessions = own(s.sessions, (o) => o.slice()))[i] = { ...x, status: want };
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
  /** Fetch the steps a loaded thread lacks (after the seq it has them all up to). */
  catchUp: (sessionId: string) => void;
  /** Refetch everything for the (new) active workspace. */
  reload: () => void;
  /** Bumps on every reload: an answer fetched under an older one is for another workspace, and is dropped. */
  generation: () => number;
  /** The server's project as it says now (a setup message, a reconnect): reloads when it isn't the one loaded. */
  checkRoot: (root: string | null) => void;
  /**
   * A view needs this thread's steps: they stay loaded until it lets go (the function returned). Threads no view holds
   * are let go of, but for the last KEEP_UNHELD (a day of opening threads would otherwise keep every one in memory).
   */
  hold: (sessionId: string) => () => void;
};

/** Called with the threads whose steps the store let go of: caches kept per thread (builders, counters) drop them too. */
const evictListeners = new Set<(sessionIds: string[]) => void>();
export function onStepsEvicted(fn: (sessionIds: string[]) => void) { evictListeners.add(fn); }

export function createLiveStore(start: LiveState = initial): LiveStore {
  let state = start;
  const ix: Indexes = { fileAt: new Map(), edgesFrom: new Map(), stepAt: new Map(), serverStatus: new Map(), through: new Map() };
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
    if (a.type === "step" && loading.has(a.step.sessionId) && !state.steps[a.step.sessionId]) {
      // Its thread's first fetch is in flight and may have been answered before this step was stored: kept for after it.
      const held = early.get(a.step.sessionId);
      if (held) held.push(a); else early.set(a.step.sessionId, [a]);
      return;
    }
    if (a.type === "steps-stored") {
      const through = ix.through.get(a.sessionId) ?? Infinity;
      if (through < a.lastSeq) catchUp(a.sessionId);
      // Behind what the page has: the server's steps were renumbered (a fresh database). Fetch the thread again.
      else if (through !== Infinity && a.lastSeq < through) loadSteps(a.sessionId);
      return;
    }
    queue.push(a);
    if (frame || timer !== undefined) return;
    // A frame when the tab is visible; the timer covers background tabs, where frames don't run.
    if (typeof requestAnimationFrame === "function") frame = requestAnimationFrame(flush);
    timer = setTimeout(flush, 100);
  };
  const dispatch = (a: Action) => { queue.push(a); flush(); };

  // A thread's steps are fetched once at a time (several views ask for the same thread when it opens).
  const loading = new Set<string>();
  /** Live steps that came while their thread's first fetch was in flight (see enqueue). */
  const early = new Map<string, Action[]>();
  /** Threads being caught up (catchUp), and whether to fetch again once that lands. */
  const catching = new Map<string, boolean>();
  let generation = 0; // bumps on reload: answers for the previous workspace are dropped
  const loadSteps = (sessionId: string) => {
    if (isRecording() || loading.has(sessionId)) return;
    loading.add(sessionId);
    const gen = generation;
    get<Step[]>(`/api/sessions/${encodeURIComponent(sessionId)}/steps`)
      .then((steps) => { if (gen === generation && Array.isArray(steps)) dispatch({ type: "steps", sessionId, steps }); })
      .catch(() => {})
      .finally(() => {
        if (gen !== generation) return;
        loading.delete(sessionId);
        const held = early.get(sessionId);
        early.delete(sessionId);
        if (held && state.steps[sessionId]) { queue.push(...held); flush(); } // the step case skips the ones it has
      });
  };
  const catchUp = (sessionId: string) => {
    if (isRecording() || loading.has(sessionId) || !state.steps[sessionId]) return;
    if (catching.has(sessionId)) { catching.set(sessionId, true); return; }
    catching.set(sessionId, false);
    const gen = generation;
    get<Step[]>(`/api/sessions/${encodeURIComponent(sessionId)}/steps?afterSeq=${ix.through.get(sessionId) ?? -1}`)
      .then((steps) => { if (gen === generation && Array.isArray(steps) && steps.length) dispatch({ type: "steps-more", sessionId, steps }); })
      .catch(() => {})
      .finally(() => {
        if (gen !== generation) return;
        const again = catching.get(sessionId);
        catching.delete(sessionId);
        if (again) catchUp(sessionId);
      });
  };
  let loadedRoot: string | null | undefined; // the project the data was loaded for (undefined: not known yet)
  const reload = () => { if (isRecording()) return; generation++; loadedRoot = undefined; loading.clear(); early.clear(); catching.clear(); dispatch({ type: "reset" }); loadAll(store); };
  const checkRoot = (root: string | null) => {
    if (loadedRoot !== undefined && root !== loadedRoot && root) reload(); // another project than the one shown
    else if (loadedRoot === undefined || root) loadedRoot = root;
  };
  const stepOf = (id: string) => {
    const at = ix.stepAt.get(id), st = at && state.steps[at.sid]?.[at.i];
    return st && st.id === id ? st : undefined;
  };
  const held = new Map<string, number>();
  let letGo: string[] = []; // threads let go of, most recent first
  const evict = () => {
    if (state.replay || isRecording()) return; // a recording can't fetch them again
    letGo = letGo.filter((sid) => !held.has(sid)).slice(0, KEEP_UNHELD);
    const out = Object.keys(state.steps).filter((sid) => !held.has(sid) && !letGo.includes(sid));
    if (!out.length) return;
    dispatch({ type: "evict", sessionIds: out });
    for (const fn of evictListeners) fn(out);
  };
  const hold = (sid: string) => {
    held.set(sid, (held.get(sid) ?? 0) + 1);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const n = (held.get(sid) ?? 1) - 1;
      if (n > 0) { held.set(sid, n); return; }
      held.delete(sid);
      letGo = [sid, ...letGo.filter((x) => x !== sid)];
      // After the views that take over (the next thread opened in the same commit) have held theirs.
      setTimeout(evict, 0);
    };
  };
  const store: LiveStore = { get: () => state, subscribe, dispatch, enqueue, stepOf, loadSteps, catchUp, reload, generation: () => generation, checkRoot, hold };
  return store;
}

/** A demo build (VITE_DEMO=1, `npm run build:demo`): the hosted demo's playback (lib/preview.ts). Any other build leaves it
 * out entirely: the constant is replaced at build time, so the import below is dropped. */
export const DEMO = import.meta.env.VITE_DEMO === "1";

// Hosted demo: built with VITE_REPLAY_URL=/replay.json so it opens straight into the recording.
// Both can't change without a reload (links keep ?replay=, see nav.tsx), so they're read once.
let replayUrlValue: string | null | undefined;
/** ?replay= only loads a file from this same site: a link can't pour someone else's recording into your Rundown. */
const sameSite = (u: string | null) => { if (!u) return null; try { return new URL(u, location.href).origin === location.origin ? u : null; } catch { return null; } };
const replayUrl = () => (replayUrlValue === undefined
  ? (replayUrlValue = sameSite(new URLSearchParams(location.search).get("replay")) ?? (import.meta.env.VITE_REPLAY_URL as string | undefined) ?? null)
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
export const isRecording = () => (replayMode ??= !!embeddedReplay() || !!replayUrl());

let replayData: Replay | null = null;
/** Places of a recorded thread (the hosted demos have no server to ask). */
export const replayCowork = (sessionId: string) => replayData?.cowork?.[sessionId] ?? null;

/** App clock. In replay mode it runs from the export time, so "just now" and recency colors look as they did when recorded. */
let clockOffset = 0;
export const clock = () => Date.now() - clockOffset;
export async function replayAnswer(req: AskRequest): Promise<AskResponse> {
  // The exact question only: an answer to another question is not an answer to this one. Shared files carry none.
  const hit = replayData?.answers?.find((a) => a.request.question === req.question && a.request.stepId === req.stepId && a.request.filePath === req.filePath);
  if (hit) return hit.response;
  return { answer: "This is a recording, so it can't answer new questions. Run Rundown on your own computer to ask.", model: "replay", tokensIn: 0, tokensOut: 0, costUsd: 0, fallback: false };
}

/** Load everything for the active workspace (on start, on a reconnect, and again whenever the server's project changes).
 * Answers that arrive after a newer reload are for the previous project: dropped. */
function loadAll(store: LiveStore) {
  const gen = store.generation();
  const load = <T,>(path: string, then: (v: T) => void) => get<T>(path)
    .then((v) => { if (gen === store.generation()) then(v); }).catch(() => {});
  load<SetupStatus>("/api/workspace", (status) => {
    store.checkRoot(status?.root ?? null);
    if (gen === store.generation()) store.dispatch({ type: "setup", status });
  });
  load<Session[]>("/api/sessions", (sessions) => store.dispatch({ type: "sessions", sessions }));
  load<ProjectMap>("/api/map", (map) => store.dispatch({ type: "map", map }));
  load<AgentPresence[]>("/api/agents", (agents) => store.dispatch({ type: "agents", agents }));
  load<Attention[]>("/api/attention", (list) => { if (Array.isArray(list)) store.dispatch({ type: "attention-all", list }); });
}

/** The server's version when the page first reached it: a different one after a reconnect (an update) has other
 * chunks than this page knows, so the page reloads itself. */
let serverVersion: string | undefined;
function checkServerVersion() {
  get<{ version?: string }>("/api/health").then((h) => {
    if (typeof h?.version !== "string") return;
    if (serverVersion !== undefined && h.version !== serverVersion) location.reload();
    serverVersion = h.version;
  }).catch(() => {});
}

const Ctx = createContext<LiveStore | null>(null);

export function LiveProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createLiveStore);

  useEffect(() => {
    const url = replayUrl(), inline = embeddedReplay();
    if (inline || url) {
      let stopPlayback = () => {}, gone = false;
      (inline ? Promise.resolve(inline) : get<Replay>(url!)).then((data: Replay) => {
        replayData = data; clockOffset = Math.max(0, Date.now() - Date.parse(data.exportedAt));
        store.dispatch({ type: "replay", data });
        // The hosted demo's playback (agent moves, the setup run) is only in a demo build (npm run build:demo).
        if (DEMO) void import("./preview").then(({ installSetupShim, startAgentPlayback }) => {
          if (gone) return;
          installSetupShim(data);
          stopPlayback = startAgentPlayback(data, store.enqueue);
        });
      });
      return () => { gone = true; stopPlayback(); };
    }
    loadAll(store);
    checkServerVersion();
    const sweep = setInterval(() => store.dispatch({ type: "sweep", now: Date.now() }), 60_000);

    let ws: WebSocket | null = null;
    let stop = false, opened = false;
    const retry = () => { store.dispatch({ type: "connected", value: false }); if (!stop) setTimeout(connect, 1500); };
    // The live feed needs a token only this page can read (another site, or another app on localhost, can't). It changes
    // when the server restarts, so it's fetched again on every connection.
    const connect = () => {
      get<LiveToken>("/api/live-token")
        .then(({ token }) => { if (!stop) open(token); }, retry);
    };
    const open = (token: string) => {
      const sock = (ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws?t=${encodeURIComponent(token)}`));
      // A server that's up but stuck accepts the connection and never answers: the socket would wait forever without
      // closing. Give up after a few seconds and try again (so the page can say it can't reach it).
      const giveUp = setTimeout(() => { if (sock.readyState === WebSocket.CONNECTING) sock.close(); }, 5000);
      sock.onopen = () => {
        clearTimeout(giveUp);
        store.dispatch({ type: "connected", value: true });
        // Back after an outage: what changed meanwhile (the server may have restarted, even on another project). The
        // first time too if the page loaded while the server was away (nothing came).
        if (opened) checkServerVersion();
        if (opened || !store.get().setup) loadAll(store);
        opened = true;
        // Steps stored while the page wasn't listening (an outage, a restart, or before this first connection).
        for (const sid of Object.keys(store.get().steps)) store.catchUp(sid);
      };
      sock.onclose = () => { clearTimeout(giveUp); retry(); };
      sock.onmessage = (e) => {
        let m: WsMessage;
        try { m = JSON.parse(e.data) as WsMessage; } catch { return; }
        // Another project (picked here, in another tab, by /rundown:open in another session): everything is reloaded.
        if (m.type === "setup") store.checkRoot(m.status?.root ?? null);
        store.enqueue(m);
      };
    };
    connect();
    return () => { stop = true; ws?.close(); clearInterval(sweep); };
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

/** A thread's steps, loaded if needed and held while the component is mounted (see LiveStore.hold). */
export function useThreadSteps(sessionId: string | null | undefined): Step[] | undefined {
  const store = useStore();
  const steps = useStoreSelector(store, (s) => (sessionId ? s.steps[sessionId] : undefined));
  useEffect(() => (sessionId ? store.hold(sessionId) : undefined), [store, sessionId]);
  useEffect(() => { if (sessionId && !steps) store.loadSteps(sessionId); }, [store, sessionId, steps]);
  return steps;
}

/** One step by id (undefined until its thread is loaded). */
export function useLiveStep(stepId: string | null | undefined): Step | undefined {
  const store = useStore();
  return useStoreSelector(store, () => (stepId ? store.stepOf(stepId) : undefined));
}

