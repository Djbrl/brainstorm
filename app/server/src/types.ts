// THE CONTRACT. Shared by server and web. Change only by ADDING fields, and log it in docs/build-log.md.

export type Session = { id: string; cwd: string; title: string; startedAt: string; lastEventAt: string; status: "running" | "idle" };
export type StepKind = "prompt" | "text" | "thinking" | "tool_call" | "tool_result" | "edit";
export type Step = {
  id: string; sessionId: string; seq: number; ts: string; kind: StepKind;
  text?: string; tool?: string; input?: unknown;
  filePath?: string; diff?: { before: string; after: string };
  label?: string;       // short human label, filled by the reader (B)
  risk?: string[];      // e.g. ["deleted test", "touches auth"], filled by the reader (B)
  isSubagent?: boolean;
  agentId?: string;     // subagent id (from its log); absent for the main session thread. Live only, not persisted.
};
export type FileNode = { path: string; module: string; lines: number; lastChangedAt?: string; activeSessionId?: string; summary?: string };
export type Edge = { from: string; to: string };
export type ProjectMap = { root: string; files: FileNode[]; edges: Edge[]; modules: { id: string; summary?: string }[] };
export type Snapshot = { ts: string; map: ProjectMap };
export type AskRequest = { question: string; stepId?: string; filePath?: string; root?: string };
export type AskResponse = { answer: string; model: string; tokensIn: number; tokensOut: number; costUsd: number; fallback: boolean };
export type WsMessage =
  | { type: "session"; session: Session }
  | { type: "step"; step: Step }
  | { type: "step-update"; id: string; label?: string; risk?: string[] }
  | { type: "file"; file: FileNode }
  | { type: "map"; map: ProjectMap }
  | { type: "agent"; agent: AgentPresence }
  | { type: "setup"; status: SetupStatus };

/** Workspace setup (local app). GET /api/workspace, GET /api/workspace/suggestions, POST /api/workspace {root}. */
export type SetupStepState = "pending" | "running" | "done" | "warn" | "error";
export type SetupStep = {
  id: "scan" | "imports" | "claude" | "nemotron" | "anthropic" | "summaries";
  label: string; state: SetupStepState;
  detail?: string;            // e.g. "412 files", "Claude Code 2.1.3 · 6 sessions found", "offline: labels will be plain"
  done?: number; total?: number; // progress, e.g. summaries 120 / 412
};
export type SetupStatus = {
  root: string | null;        // null = no workspace chosen yet → the web shows the setup screen
  name: string | null;        // folder name
  ready: boolean;             // map built + Claude Code log folder resolved (summaries may still be running)
  steps: SetupStep[];
};
export type WorkspaceSuggestion = { root: string; name: string; lastActiveAt?: string; sessions: number; exists: boolean };

/** Live agents on the map. GET /api/agents + ws "agent". One per main session thread and per subagent. */
export type AgentMove = { file: string; action: string; ts: string }; // action: "edit" | "read" | "search" | "run" | ...
export type AgentPresence = {
  id: string;                 // sessionId for the main thread, agentId for a subagent
  sessionId: string;
  name: string;               // session title, or "Subagent · <short label>"
  isSubagent: boolean;
  file?: string;              // absolute path of the file it is on now
  action?: string;
  ts: string;                 // last activity
  active: boolean;            // false after 2 minutes without activity
  trail: AgentMove[];         // newest last, at most 12
};

/** Recurring failures in agent tool calls, grouped (GET /api/failures). Added 15:35 for the "Find the Hidden Failures" award. */
export type FailureEvidence = {
  stepId: string;          // the failing tool_result step
  callStepId?: string;     // the tool_call it answers
  sessionId: string; ts: string;
  tool: string; filePath?: string;
  input?: string;          // short summary of the call input (command, pattern, path)
  error: string;           // first lines of the error text
};
export type FailureGroup = {
  key: string;             // tool + normalized error
  tool: string;
  error: string;           // normalized error
  title: string;           // Nemotron, at most 8 words (fallback "<tool>: <error>")
  advice: string;          // Nemotron, one line: why it matters / what to fix
  count: number; firstSeen: string; lastSeen: string;
  sessions: string[];
  retried: boolean;        // same failure repeated inside one session
  touchesEdits: boolean;
  priority: number;        // higher = needs attention first
  evidence: FailureEvidence[]; // newest first, at most 12
};

/** Static export for the hosted demo (GET /api/replay). The web loads it with ?replay=/replay.json */
export type Replay = {
  exportedAt: string;
  sessions: Session[];
  steps: Step[];
  map: ProjectMap | null;
  answers: { request: AskRequest; response: AskResponse }[];
  failures?: FailureGroup[];
};
