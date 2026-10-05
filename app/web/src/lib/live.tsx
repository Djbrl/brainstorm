// Owned by the lead. One store for the whole app: REST bootstrap + websocket updates, or a static replay file.
import { installSetupShim, startAgentPlayback } from "./preview";
import { createContext, useCallback, useContext, useEffect, useReducer, type ReactNode } from "react";
import type { AgentPresence, Attention, AskRequest, AskResponse, Edge, FailureGroup, FileNode, SetupStatus, ProjectMap, Replay, Session, Step, WsMessage } from "@contract";

export type LiveState = {
  connected: boolean;
  replay: boolean;
  sessions: Session[];
  steps: Record<string, Step[]>;   // by sessionId, ordered by seq
  map: ProjectMap | null;
  failures: FailureGroup[];
  agents: Record<string, AgentPresence>; // live agents by id (main session thread or subagent)
  setup: SetupStatus | null;             // null until loaded (and always null in replay)
  preview: boolean;                      // replay built for the post-deadline preview (agent + setup playback)
  shared: Replay["shared"] | null;       // a replay file someone shared from their Brainstorm
  attention: Record<string, Attention>;  // by sessionId: is a thread waiting on you (local app only)
};

type Action =
  | { type: "connected"; value: boolean }
  | { type: "sessions"; sessions: Session[] }
  | { type: "steps"; sessionId: string; steps: Step[] }
  | { type: "map"; map: ProjectMap }
  | { type: "failures"; failures: FailureGroup[] }
  | { type: "agents"; agents: AgentPresence[] }
  | { type: "attention-all"; list: Attention[] }
  | { type: "setup-status"; status: SetupStatus }
  | { type: "reset" }
  | { type: "replay"; data: Replay }
  | WsMessage;

const initial: LiveState = { connected: false, replay: false, sessions: [], steps: {}, map: null, failures: [], agents: {}, setup: null, preview: false, shared: null, attention: {} };

/** A changed file, and its outgoing imports when the server recomputed them. */
function upsertFile(map: ProjectMap | null, file: FileNode, edges?: Edge[]): ProjectMap | null {
  if (!map) return map;
  const i = map.files.findIndex((f) => f.path === file.path);
  const files = i === -1 ? [...map.files, file] : map.files.map((f, j) => (j === i ? { ...f, ...file } : f));
  if (!edges) return { ...map, files };
  const same = (a: Edge[], b: Edge[]) => a.length === b.length && a.every((e, k) => e.to === b[k].to);
  const old = map.edges.filter((e) => e.from === file.path);
  if (same(old, edges)) return { ...map, files };
  return { ...map, files, edges: [...map.edges.filter((e) => e.from !== file.path), ...edges] };
}

function removeFile(map: ProjectMap | null, path: string): ProjectMap | null {
  if (!map || !map.files.some((f) => f.path === path)) return map;
  return { ...map, files: map.files.filter((f) => f.path !== path), edges: map.edges.filter((e) => e.from !== path && e.to !== path) };
}

function reducer(s: LiveState, a: Action): LiveState {
  switch (a.type) {
    case "connected": return { ...s, connected: a.value };
    case "sessions": return { ...s, sessions: sortSessions(a.sessions) };
    case "steps": return { ...s, steps: { ...s.steps, [a.sessionId]: a.steps } };
    case "map": return { ...s, map: a.map };
    case "failures": return { ...s, failures: a.failures };
    case "agents": return { ...s, agents: Object.fromEntries(a.agents.map((g) => [g.id, g])) };
    case "agent": return { ...s, agents: { ...s.agents, [a.agent.id]: a.agent } };
    case "attention-all": return { ...s, attention: Object.fromEntries(a.list.map((x) => [x.sessionId, x])) };
    case "attention": return { ...s, attention: { ...s.attention, [a.attention.sessionId]: a.attention } };
    case "setup-status": return { ...s, setup: a.status };
    case "setup": return { ...s, setup: a.status };
    case "reset": return { ...s, sessions: [], steps: {}, map: null, failures: [], agents: {}, attention: {} };
    case "replay": {
      const steps: Record<string, Step[]> = {};
      for (const st of a.data.steps) (steps[st.sessionId] ??= []).push(st);
      Object.values(steps).forEach((l) => l.sort((x, y) => x.seq - y.seq));
      return { ...s, replay: true, connected: true, sessions: sortSessions(a.data.sessions), steps, map: a.data.map, failures: a.data.failures ?? [], preview: !!(a.data.agentMoves?.length || a.data.setupPreview), shared: a.data.shared ?? null };
    }
    case "session": {
      const others = s.sessions.filter((x) => x.id !== a.session.id);
      return { ...s, sessions: sortSessions([a.session, ...others]) };
    }
    case "step": {
      const list = s.steps[a.step.sessionId];
      if (!list) return s; // not loaded yet; will come with the REST fetch
      if (list.some((x) => x.id === a.step.id)) return s;
      return { ...s, steps: { ...s.steps, [a.step.sessionId]: [...list, a.step] } };
    }
    case "step-update": {
      const steps: Record<string, Step[]> = {};
      for (const [k, list] of Object.entries(s.steps))
        steps[k] = list.map((x) => (x.id === a.id ? { ...x, ...(a.label !== undefined && { label: a.label }), ...(a.risk !== undefined && { risk: a.risk }) } : x));
      return { ...s, steps };
    }
    case "file": return { ...s, map: upsertFile(s.map, a.file, a.edges) };
    case "file-removed": return { ...s, map: removeFile(s.map, a.path) };
    default: return s;
  }
}

const sortSessions = (l: Session[]) => [...l].sort((a, b) => b.lastEventAt.localeCompare(a.lastEventAt));

// Hosted demo: built with VITE_REPLAY_URL=/replay.json so it opens straight into the recording.
const replayUrl = () => new URLSearchParams(location.search).get("replay") ?? (import.meta.env.VITE_REPLAY_URL as string | undefined) ?? null;

/** A shared replay file (GET /api/share) carries its recording inline, so it opens with no server. */
let embedded: Replay | null | undefined;
function embeddedReplay(): Replay | null {
  if (embedded === undefined) {
    const text = document.getElementById("brainstorm-replay")?.textContent;
    try { embedded = text ? (JSON.parse(text) as Replay) : null; } catch { embedded = null; }
  }
  return embedded;
}
export const isReplay = () => !!embeddedReplay() || !!replayUrl();

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
  return { answer: "This is a recorded demo. Run Brainstorm locally to ask new questions.", model: "replay", tokensIn: 0, tokensOut: 0, costUsd: 0, fallback: false };
}

/** Load everything for the active workspace (on start, and again after the setup screen switches workspace). */
function loadAll(dispatch: (a: Action) => void) {
  fetch("/api/workspace").then((r) => r.json()).then((status) => dispatch({ type: "setup-status", status })).catch(() => {});
  fetch("/api/sessions").then((r) => r.json()).then((sessions) => dispatch({ type: "sessions", sessions })).catch(() => {});
  fetch("/api/map").then((r) => r.json()).then((map) => dispatch({ type: "map", map })).catch(() => {});
  fetch("/api/failures").then((r) => r.json()).then((failures) => dispatch({ type: "failures", failures })).catch(() => {});
  fetch("/api/agents").then((r) => r.json()).then((agents) => dispatch({ type: "agents", agents })).catch(() => {});
  fetch("/api/attention").then((r) => r.json()).then((list) => Array.isArray(list) && dispatch({ type: "attention-all", list })).catch(() => {});
}

const Ctx = createContext<{ state: LiveState; loadSteps: (sessionId: string) => void; reload: () => void } | null>(null);

export function LiveProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial);

  useEffect(() => {
    const url = replayUrl(), inline = embeddedReplay();
    if (inline || url) {
      let stopPlayback = () => {};
      (inline ? Promise.resolve(inline) : fetch(url!).then((r) => r.json() as Promise<Replay>)).then((data: Replay) => {
        replayData = data; clockOffset = Math.max(0, Date.now() - Date.parse(data.exportedAt));
        dispatch({ type: "replay", data });
        installSetupShim(data);
        stopPlayback = startAgentPlayback(data, dispatch);
      });
      return () => stopPlayback();
    }
    loadAll(dispatch);
    const loadFailures = () => fetch("/api/failures").then((r) => r.json()).then((failures) => dispatch({ type: "failures", failures })).catch(() => {});
    const failTimer = setInterval(loadFailures, 15000);

    let ws: WebSocket | null = null;
    let stop = false;
    const connect = () => {
      ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
      ws.onopen = () => dispatch({ type: "connected", value: true });
      ws.onclose = () => { dispatch({ type: "connected", value: false }); if (!stop) setTimeout(connect, 1500); };
      ws.onmessage = (e) => { try { dispatch(JSON.parse(e.data) as WsMessage); } catch {} };
    };
    connect();
    return () => { stop = true; ws?.close(); clearInterval(failTimer); };
  }, []);

  const loadSteps = useCallback((sessionId: string) => {
    if (isReplay()) return;
    fetch(`/api/sessions/${encodeURIComponent(sessionId)}/steps`).then((r) => r.json())
      .then((steps: Step[]) => dispatch({ type: "steps", sessionId, steps })).catch(() => {});
  }, []);

  /** Refetch everything for the (new) active workspace. */
  const reload = useCallback(() => { if (isReplay()) return; dispatch({ type: "reset" }); loadAll(dispatch); }, []);

  return <Ctx.Provider value={{ state, loadSteps, reload }}>{children}</Ctx.Provider>;
}

export function useLive() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useLive outside LiveProvider");
  return v;
}
