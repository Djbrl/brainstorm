// Owned by the lead. Post-deadline preview (brainstorm-next): plays back recorded agent moves on the Map and a recorded
// setup run, so the hosted replay can show features that normally need the local server.
import type { AgentPresence, FileNode, Replay, SetupStatus, WsMessage } from "@contract";
import { clock } from "./live";

const TICK_MS = 700;          // one recorded move per tick
const IDLE_TICKS = 18;        // an agent with no move for this many ticks turns inactive
const PULSE_TICKS = 6;        // an edited file pulses for this many ticks

/** Replays `agentMoves` in order, looping, as live `agent` (and `file` pulse) messages. Returns a stop function. */
export function startAgentPlayback(data: Replay, dispatch: (m: WsMessage | { type: "agents"; agents: AgentPresence[] }) => void): () => void {
  const moves = data.agentMoves ?? [];
  const files = new Map<string, FileNode>((data.map?.files ?? []).map((f) => [f.path, f]));
  if (!moves.length) return () => {};
  let i = 0, tick = 0;
  let agents = new Map<string, AgentPresence & { lastTick: number }>();
  const pulses = new Map<string, number>(); // path → tick when the pulse ends

  const step = () => {
    tick++;
    if (i >= moves.length) { // loop: clear the map and start over
      i = 0; agents = new Map(); dispatch({ type: "agents", agents: [] });
    }
    const m = moves[i++];
    const now = new Date(clock()).toISOString();
    const prev = agents.get(m.id);
    const trail = [...(prev?.trail ?? [])];
    const last = trail[trail.length - 1];
    if (last && last.file === m.file && last.action === m.action) last.ts = now;
    else trail.push({ file: m.file, action: m.action, ts: now });
    const a = { id: m.id, sessionId: m.sessionId, name: m.name, isSubagent: m.isSubagent, file: m.file, action: m.action, ts: now, active: true, trail: trail.slice(-12), lastTick: tick };
    agents.set(m.id, a);
    const { lastTick: _t, ...agent } = a;
    dispatch({ type: "agent", agent });
    if (m.action === "edit" || m.action === "write") {
      const f = files.get(m.file);
      if (f) { dispatch({ type: "file", file: { ...f, activeSessionId: m.sessionId, lastChangedAt: now } }); pulses.set(m.file, tick + PULSE_TICKS); }
    }
    for (const [path, end] of pulses) if (tick >= end) {
      const f = files.get(path);
      if (f) dispatch({ type: "file", file: { ...f, activeSessionId: undefined, lastChangedAt: new Date(clock()).toISOString() } });
      pulses.delete(path);
    }
    for (const g of agents.values()) if (g.active && tick - g.lastTick > IDLE_TICKS) {
      g.active = false;
      const { lastTick: _l, ...agent } = g;
      dispatch({ type: "agent", agent });
    }
  };
  const timer = setInterval(step, TICK_MS);
  return () => clearInterval(timer);
}

/** Serves the recorded setup run to the setup screen: /api/workspace* answered locally, steps completing one by one. */
export function installSetupShim(data: Replay) {
  const rec = data.setupPreview;
  if (!rec) return;
  let startedAt = 0;
  let chosen: string | null = null; // the folder the visitor clicked
  const STEP_MS = 850, SUMMARY_MS = 3200;
  const statusAt = (elapsed: number): SetupStatus => {
    const steps = rec.status.steps.map((s, idx) => {
      const begin = idx * STEP_MS;
      if (elapsed < begin) return { ...s, state: "pending" as const, detail: undefined, done: s.total ? 0 : undefined };
      const span = s.total ? SUMMARY_MS : STEP_MS;
      if (elapsed < begin + span) {
        const done = s.total ? Math.round((s.total * (elapsed - begin)) / span) : undefined;
        return { ...s, state: "running" as const, detail: s.total ? undefined : s.detail && elapsed - begin > STEP_MS * 0.5 ? s.detail : undefined, done };
      }
      return s;
    });
    const ready = ["scan", "imports"].every((id) => steps.find((s) => s.id === id)?.state === "done");
    const root = chosen ?? rec.status.root;
    return { ...rec.status, root, name: root ? root.split("/").pop() ?? root : rec.status.name, ready, steps };
  };
  const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  const realFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    if (path.startsWith("/api/workspace/suggestions")) return json(rec.suggestions);
    if (path.startsWith("/api/workspace")) {
      if ((init?.method ?? "GET").toUpperCase() === "POST") {
        try { chosen = (JSON.parse(String(init?.body ?? "{}")) as { root?: string }).root ?? null; } catch { chosen = null; }
        startedAt = Date.now();
        return json(statusAt(0));
      }
      return json(startedAt ? statusAt(Date.now() - startedAt) : { root: null, name: null, ready: false, steps: [] });
    }
    return realFetch(input, init);
  };
}
