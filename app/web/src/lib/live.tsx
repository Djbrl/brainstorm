// Owned by the lead. One store for the whole app: REST bootstrap + websocket updates, or a static replay file.
import { createContext, useCallback, useContext, useEffect, useReducer, type ReactNode } from "react";
import type { AgentPresence, AskRequest, AskResponse, FailureGroup, FileNode, SetupStatus, ProjectMap, Replay, Session, Step, WsMessage } from "@contract";

export type LiveState = {
  connected: boolean;
  replay: boolean;
  sessions: Session[];
  steps: Record<string, Step[]>;   // by sessionId, ordered by seq
  map: ProjectMap | null;
  failures: FailureGroup[];
  agents: Record<string, AgentPresence>; // live agents by id (main session thread or subagent)
  setup: SetupStatus | null;             // null until loaded (and always null in replay)
};

type Action =
  | { type: "connected"; value: boolean }
  | { type: "sessions"; sessions: Session[] }
  | { type: "steps"; sessionId: string; steps: Step[] }
  | { type: "map"; map: ProjectMap }
  | { type: "failures"; failures: FailureGroup[] }
  | { type: "agents"; agents: AgentPresence[] }
  | { type: "setup-status"; status: SetupStatus }
  | { type: "reset" }
  | { type: "replay"; data: Replay }
  | WsMessage;

const initial: LiveState = { connected: false, replay: false, sessions: [], steps: {}, map: null, failures: [], agents: {}, setup: null };

function upsertFile(map: ProjectMap | null, file: FileNode): ProjectMap | null {
  if (!map) return map;
  const i = map.files.findIndex((f) => f.path === file.path);
  const files = i === -1 ? [...map.files, file] : map.files.map((f, j) => (j === i ? { ...f, ...file } : f));
  return { ...map, files };
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
    case "setup-status": return { ...s, setup: a.status };
    case "setup": return { ...s, setup: a.status };
    case "reset": return { ...s, sessions: [], steps: {}, map: null, failures: [], agents: {} };
    case "replay": {
      const steps: Record<string, Step[]> = {};
      for (const st of a.data.steps) (steps[st.sessionId] ??= []).push(st);
      Object.values(steps).forEach((l) => l.sort((x, y) => x.seq - y.seq));
      return { ...s, replay: true, connected: true, sessions: sortSessions(a.data.sessions), steps, map: a.data.map, failures: a.data.failures ?? [] };
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
    case "file": return { ...s, map: upsertFile(s.map, a.file) };
    default: return s;
  }
}

const sortSessions = (l: Session[]) => [...l].sort((a, b) => b.lastEventAt.localeCompare(a.lastEventAt));

// Hosted demo: built with VITE_REPLAY_URL=/replay.json so it opens straight into the recording.
const replayUrl = () => new URLSearchParams(location.search).get("replay") ?? (import.meta.env.VITE_REPLAY_URL as string | undefined) ?? null;
export const isReplay = () => !!replayUrl();

let replayData: Replay | null = null;

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
}

const Ctx = createContext<{ state: LiveState; loadSteps: (sessionId: string) => void; reload: () => void } | null>(null);

export function LiveProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial);

  useEffect(() => {
    const url = replayUrl();
    if (url) {
      fetch(url).then((r) => r.json()).then((data: Replay) => { replayData = data; clockOffset = Math.max(0, Date.now() - Date.parse(data.exportedAt)); dispatch({ type: "replay", data }); });
      return;
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
