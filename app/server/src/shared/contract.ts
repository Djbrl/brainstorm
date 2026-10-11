// THE CONTRACT. Shared by server and web. Change only by ADDING fields, and log it in docs/build-log.md.

/** The coding agent a thread ran in (its logs: listener/claude.source.ts, listener/codex.source.ts). */
export type Harness = "claude" | "codex";
/** `harness`: which coding agent the thread ran in. */
/** `home`: the repo the thread works in, its real folder (links followed, a worktree's repo): one name for a repo that
 *  moved or is reached through a link (~/brainstorm, ~/Documents/brainstorm and ~/rundown are one project). */
export type Session = { id: string; cwd: string; title: string; startedAt: string; lastEventAt: string; status: "running" | "idle"; harness: Harness; home?: string };
export type StepKind = "prompt" | "text" | "thinking" | "tool_call" | "tool_result" | "edit";
export type Step = {
  id: string; sessionId: string; seq: number; ts: string; kind: StepKind;
  text?: string; tool?: string; input?: unknown;
  filePath?: string; diff?: { before: string; after: string };
  label?: string;       // short human label, filled by the reader (B)
  risk?: string[];      // e.g. ["deleted test", "touches auth"], filled by the reader (B)
  isSubagent?: boolean;
  agentId?: string;     // subagent id (from its log); absent for the main session thread. Older steps get it from their logs once.
  toolUseId?: string;   // tool_call/edit: the call's tool_use id; tool_result: the id it answers. Absent on steps stored by early versions.
  reads?: string[];     // a shell command (tool_call, Bash): the files it reads by its text (`cat`, `sed -n`, `grep`…), absolute; not stored, worked out when read
};
export type FileNode = { path: string; module: string; lines: number; lastChangedAt?: string; activeSessionId?: string; summary?: string };
export type Edge = { from: string; to: string };
/** `formerRoots`: where the repo lived before it moved, so paths in older threads still land on today's files. */
/** `totalFiles`: how many mappable files the project has; more than `files.length` when the map shows a chosen subset ("800 of 20,312 files"). */
/** `scanStopped`: a folder that isn't a git repo whose walk hit its budget, so the map shows what was found in time.
 *  `unread`: files left out because reading them took too long (a file kept only in the cloud, downloading on open). */
export type ProjectMap = { root: string; files: FileNode[]; edges: Edge[]; modules: { id: string; summary?: string }[]; formerRoots?: string[]; totalFiles?: number; scanStopped?: boolean; unread?: number };
/** What a question is about: a step or a file. */
export type AskRequest = { question: string; stepId?: string; filePath?: string };
export type AskResponse = { answer: string; model: string; tokensIn: number; tokensOut: number; costUsd: number; fallback: boolean };
export type WsMessage =
  | { type: "session"; session: Session }
  | { type: "step"; step: Step }
  | { type: "step-update"; id: string; label?: string; risk?: string[] }
  /** History was stored for a thread (read quietly, not sent step by step): a page that has fewer of its steps fetches
   *  the rest (`GET /api/sessions/:id/steps?afterSeq=`). */
  | { type: "steps-stored"; sessionId: string; lastSeq: number }
  | { type: "file"; file: FileNode; edges?: Edge[] } // edges: the file's outgoing imports, when they were recomputed
  | { type: "file-removed"; path: string }
  | { type: "map"; map: ProjectMap }
  | { type: "agent"; agent: AgentPresence }
  | { type: "attention"; attention: Attention }
  | { type: "setup"; status: SetupStatus };

/** Workspace setup (local app). GET /api/workspace, GET /api/workspace/suggestions, POST /api/workspace {root}. */
export type SetupStepState = "pending" | "running" | "done" | "warn" | "error";
export type SetupStep = {
  id: "scan" | "imports" | "claude" | "anthropic";
  label: string; state: SetupStepState;
  detail?: string;            // e.g. "412 files", "Claude Code 2.1.3 · 6 sessions found", "offline: labels will be plain"
  done?: number; total?: number; // progress, e.g. summaries 120 / 412
};
export type SetupStatus = {
  root: string | null;        // null = no workspace chosen yet → the web shows the setup screen
  name: string | null;        // folder name
  ready: boolean;             // map built + Claude Code log folder resolved (summaries may still be running)
  steps: SetupStep[];
  /** The project that was open is gone (renamed, moved or deleted): root is null, and the page says so above the picker. */
  missing?: { root: string; name: string };
};
export type WorkspaceSuggestion = { root: string; name: string; lastActiveAt?: string; sessions: number; exists: boolean };

/**
 * A thread running in another project on this machine (GET /api/elsewhere): working now, waiting on you (permission or
 * a question, from the plugin's hooks), or just finished its turn. The open project's threads are never in it.
 */
export type ElsewhereThread = {
  sessionId: string; harness: Harness; title?: string;
  root: string; project: string;        // the repo (a worktree counts as its repo) and its folder name
  lastEventAt: string;
  state: "working" | "needs-you" | "your-turn";
};

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
  away?: string;              // what it does now that the map can't show (a command, a file outside every project), in words
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
 * (area → site → page) and actions (reads vs changes). See docs/technical.md, "Places".
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
 * Does a thread need you? (GET /api/attention, ws "attention").
 * permission: a tool call waits for your OK. question: the agent asked you something (AskUserQuestion, an MCP form).
 * plan: a plan waits for approval. stuck: the same tool failed 3 times in a row. done: the agent finished and it's your turn.
 * `sure` is false when it's inferred from the log alone (a call with no result and no activity for a while); the plugin's
 * PermissionRequest and Notification hooks make it sure.
 */
/** "thinking": mid-turn with nothing written for a while (the model is working on its next step; Claude Code logs nothing meanwhile). */
export type AttentionState = "working" | "thinking" | "permission" | "question" | "plan" | "stuck" | "done" | "idle";
export type Attention = {
  sessionId: string; state: AttentionState; since: string; sure: boolean;
  tool?: string;      // the tool waiting or failing
  detail?: string;    // the command, file, question or error, one line
  stepId?: string;    // the call it's about
  agentId?: string;   // set when a subagent is the one waiting
};
