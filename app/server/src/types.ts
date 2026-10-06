// THE CONTRACT. Shared by server and web. Change only by ADDING fields, and log it in docs/build-log.md.

/** The coding agent a thread ran in (its logs: listener/claude.source.ts, listener/codex.source.ts). */
export type Harness = "claude" | "codex";
/** `harness`: added 6 Oct 2026 ("claude" for every thread stored before). */
export type Session = { id: string; cwd: string; title: string; startedAt: string; lastEventAt: string; status: "running" | "idle"; harness: Harness };
export type StepKind = "prompt" | "text" | "thinking" | "tool_call" | "tool_result" | "edit";
export type Step = {
  id: string; sessionId: string; seq: number; ts: string; kind: StepKind;
  text?: string; tool?: string; input?: unknown;
  filePath?: string; diff?: { before: string; after: string };
  label?: string;       // short human label, filled by the reader (B)
  risk?: string[];      // e.g. ["deleted test", "touches auth"], filled by the reader (B)
  isSubagent?: boolean;
  agentId?: string;     // subagent id (from its log); absent for the main session thread. Stored since 5 Oct 2026; older steps filled from their logs once.
  toolUseId?: string;   // tool_call/edit: the call's tool_use id; tool_result: the id it answers. Absent on steps stored before 30 Sep 2026.
};
export type FileNode = { path: string; module: string; lines: number; lastChangedAt?: string; activeSessionId?: string; summary?: string };
export type Edge = { from: string; to: string };
/** `formerRoots`: where the repo lived before it moved, so paths in older threads still land on today's files. */
/** `totalFiles`: how many mappable files the project has; more than `files.length` when the map shows a chosen subset ("800 of 20,312 files"). */
export type ProjectMap = { root: string; files: FileNode[]; edges: Edge[]; modules: { id: string; summary?: string }[]; formerRoots?: string[]; totalFiles?: number };
export type Snapshot = { ts: string; map: ProjectMap };
/** What a question is about: a step or a file. */
export type AskRequest = { question: string; stepId?: string; filePath?: string; root?: string };
export type AskResponse = { answer: string; model: string; tokensIn: number; tokensOut: number; costUsd: number; fallback: boolean };
export type WsMessage =
  | { type: "session"; session: Session }
  | { type: "step"; step: Step }
  | { type: "step-update"; id: string; label?: string; risk?: string[] }
  | { type: "file"; file: FileNode; edges?: Edge[] } // edges: the file's outgoing imports, when they were recomputed
  | { type: "file-removed"; path: string }
  | { type: "map"; map: ProjectMap }
  | { type: "agent"; agent: AgentPresence }
  | { type: "attention"; attention: Attention }
  | { type: "setup"; status: SetupStatus }
  | { type: "git"; git: GitState | null };

/**
 * The project's git state (GET /api/git + ws "git"); null when the project isn't in a git repo. Paths are relative to
 * the map's root, "/"-separated.
 * - `uncommitted`: files changed and not committed in the project's checkout (staged or not), and untracked new files.
 * - `unpushed`: files changed by commits not on the upstream branch yet (`ahead` of them); null with no upstream.
 * - `worktrees`: the repo's other checkouts (where agents usually work), each on its branch: what it committed that the
 *   checkout's branch doesn't have (`committed`, `ahead` commits; `merged` once there are none) and what it hasn't
 *   committed yet; `threads`, the threads working in it (newest first).
 */
export type GitFileState = "modified" | "added" | "deleted" | "renamed" | "untracked" | "conflict";
export type GitWorktree = { path: string; branch: string; ahead: number; merged: boolean; committed: string[]; uncommitted: Record<string, GitFileState>; threads: string[]; lastCommitAt?: string };
export type GitState = { root: string; branch: string | null; upstream?: string; ahead: number; behind: number; uncommitted: Record<string, GitFileState>; unpushed: string[] | null; worktrees: GitWorktree[]; at: string };

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
  errorAt?: string;           // last failed tool call (the map flashes the marker red)
  error?: string;             // its first line
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
  /** Places per thread (sessionId → summary), so the hosted demo can show the Places view without a server. */
  cowork?: Record<string, CoworkSummary>;
  exportedAt: string;
  sessions: Session[];
  steps: Step[];
  map: ProjectMap | null;
  answers: { request: AskRequest; response: AskResponse }[];
  failures?: FailureGroup[];
  /** Post-deadline preview: recorded agent moves (chronological), played back on the Map. */
  agentMoves?: { id: string; name: string; isSubagent: boolean; sessionId: string; file: string; action: string; ts: string }[];
  /** Post-deadline preview: a recorded setup run, played back by the setup screen. */
  setupPreview?: { status: SetupStatus; suggestions: WorkspaceSuggestion[] };
  /** A replay someone shared from their local Rundown (GET /api/share): one self-contained file, secrets masked. */
  shared?: { title: string; createdAt: string; version: string };
};

/**
 * Cowork prototype (GET /api/cowork). Agent work outside the code: websites, apps running locally,
 * connected services and command-line tools that reach the outside world. Sorted into places
 * (area → site → page) and actions (reads vs changes). See docs/cowork.md.
 */
export type CoworkArea = "web" | "local" | "services" | "apps";
export type CoworkAction = "visit" | "read" | "search" | "input" | "click" | "write";
export type CoworkVerb = "sent" | "submitted" | "published" | "deployed" | "pushed" | "created" | "updated" | "deleted" | "typed" | "clicked";
/** How sure we are that a change happened: sure = the tool itself changes something (API call, deploy); likely = a click on "Send" and similar; maybe = a click or typing we can't read. */
export type CoworkConfidence = "sure" | "likely" | "maybe";
export type CoworkEvent = {
  id: string;              // step id, or "<step id>#<n>" for one action inside a browser batch
  stepId: string; sessionId: string; ts: string;
  area: CoworkArea;
  site: string;            // host ("docs.google.com"), app ("iOS Simulator") or service ("GitHub")
  page: string;            // page id inside the site: host + path without query, or a service item
  title?: string;          // page title when the browser reported one
  tool: string;            // short tool name, e.g. "navigate", "WebFetch", "git push"
  action: CoworkAction;
  what: string;            // one short line: 'Clicked "Envoyer"', "Read the page"
  change?: { verb: CoworkVerb; confidence: CoworkConfidence };
  failed?: boolean;
};
export type CoworkPage = { id: string; site: string; area: CoworkArea; url?: string; title?: string; events: number; reads: number; changes: number; failed: number; lastTs: string; sessions: string[] };
export type CoworkSite = { id: string; area: CoworkArea; name: string; pages: number; events: number; changes: number; failed: number; lastTs: string };
export type CoworkSummary = {
  areas: Record<CoworkArea, number>;  // events per area
  codeSteps: number;                   // tool calls that stay in the code (for scale)
  sites: CoworkSite[]; pages: CoworkPage[];
  events: CoworkEvent[];               // chronological
};

/**
 * Does a thread need you? (GET /api/attention, ws "attention"). Added 5 Oct 2026.
 * permission: a tool call waits for your OK. question: the agent asked you something (AskUserQuestion, an MCP form).
 * plan: a plan waits for approval. stuck: the same tool failed 3 times in a row. done: the agent finished and it's your turn.
 * `sure` is false when it's inferred from the log alone (a call with no result and no activity for a while); the plugin's
 * PermissionRequest and Notification hooks make it sure.
 */
export type AttentionState = "working" | "permission" | "question" | "plan" | "stuck" | "done" | "idle";
export type Attention = {
  sessionId: string; state: AttentionState; since: string; sure: boolean;
  tool?: string;      // the tool waiting or failing
  detail?: string;    // the command, file, question or error, one line
  stepId?: string;    // the call it's about
  agentId?: string;   // set when a subagent is the one waiting
};
