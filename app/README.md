# Brainstorm: app (agent briefing)

**Every agent: read this whole file before writing code.** Deadline: submission 16:30. Code freeze 15:40.

Brainstorm is a live map of your code and of the AI agents writing it. It runs locally, next to Claude Code, and has three views:

- **Follow**: a live timeline of one Claude Code session (messages, actions, code edits), each step with a short label. Click a step to ask "why?".
- **Map**: the project's modules and files as a graph. Lines are imports. Nodes glow by how recently they changed and pulse where an agent is editing right now. Click a node to see its summary, its recent steps and to ask about it.
- **History**: map snapshots over time, with a slider.

Full pitch and features: `../docs/plan.md`. Judges score on working features, purposeful AI use (NVIDIA Brev), reliability, demo clarity and privacy.

## Hard rules

1. **Stay in your folder** (ownership table below). Need something from another agent? Add a line under "Requests" in `../docs/build-log.md` and keep going with a stub.
2. **Types in `server/src/types.ts` are the contract.** Agent A writes it first (by 13:50). Change it only by adding fields, and note the change in the build log.
3. **Commit small and often** from the repo root, message prefixed with your agent letter: `[A] listener tails jsonl files`.
4. **No fake data in the demo.** Mocks are fine while building; everything shown in the video must be real.
5. **Blocked for more than 10 minutes?** Stub it, log it, move on.
6. **Secrets live in `.env`** (copy `.env.example`). Never commit `.env`.
7. **Log to `../docs/build-log.md`**: one line per milestone, with the time.

## Stack (decided, don't debate)

| Piece | Choice |
| --- | --- |
| Language | TypeScript, Node 20+ |
| Server | `server/`: express + ws, run with `tsx watch` |
| Storage | better-sqlite3, one file: `server/data/brainstorm.db` (gitignored) |
| File watching | chokidar |
| Web | `web/`: Vite + React + TypeScript |
| Graph | react-force-graph-2d |
| Diffs | react-diff-viewer-continued |
| Nemotron | `openai` npm package pointed at `NEMOTRON_URL` (vLLM on Brev) |
| Claude | `@anthropic-ai/sdk` |

**Ports:** server `4000` (REST under `/api`, websocket at `/ws`). Web `5173`, whose Vite config proxies `/api` and `/ws` to 4000. Nemotron runs at `http://localhost:8000/v1` through `brev port-forward`.

**Nemotron is live** (14:20). Read `../docs/nemotron.md` before calling it: connection, rules, code snippet and prompts.

## Architecture

```
~/.claude/projects/**/*.jsonl ─▶ listener (A) ─▶ db (A) ─▶ ws + REST (A) ─▶ web (C)
project folder + git ──────────▶ mapper (B) ──▶ db ──────────────────────────▲
mapper ─▶ reader (B) ─▶ Nemotron on Brev (labels, summaries, risk flags)     │
web "Ask" ─▶ /api/ask (D) ─▶ Claude API (fallback: Nemotron) ─────────────────┘
```

## Claude Code log format (verified on this machine)

- Location: `~/.claude/projects/<project path with / and spaces replaced by ->/<sessionId>.jsonl`. One JSON object per line, appended live.
- Useful top-level fields: `type`, `sessionId`, `cwd`, `timestamp`, `uuid`, `parentUuid`, `isSidechain` (true means a subagent), `message`, `toolUseResult`.
- `type: "assistant"`: `message.content` is a list of blocks:
  - `{type:"text", text}`
  - `{type:"thinking", thinking}` (the text is often empty on newer models, so skip empty ones)
  - `{type:"tool_use", id, name, input}`
- Edits are `tool_use` with `name` of `Edit` (`input.file_path`, `old_string`, `new_string`), `MultiEdit` (`input.edits[]`) or `Write` (`input.file_path`, `content`).
- `type: "user"`: `message.content` is a string (the human prompt) or a list with `{type:"tool_result", tool_use_id, content}`.
- Ignore other line types (`attachment`, `system`, `custom-title`, `queue-operation`, `file-history-snapshot`, and so on).
- Open one real file to double-check before relying on this.

## Contract (A writes `server/src/types.ts` exactly like this first)

```ts
export type Session = { id: string; cwd: string; title: string; startedAt: string; lastEventAt: string; status: "running" | "idle" };
export type StepKind = "prompt" | "text" | "thinking" | "tool_call" | "tool_result" | "edit";
export type Step = {
  id: string; sessionId: string; seq: number; ts: string; kind: StepKind;
  text?: string; tool?: string; input?: unknown;
  filePath?: string; diff?: { before: string; after: string };
  label?: string;       // short human label, filled by the reader (B)
  risk?: string[];      // e.g. ["deleted test", "touches auth"], filled by the reader (B)
  isSubagent?: boolean;
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
  | { type: "map"; map: ProjectMap };
```

**REST:**
- `GET /api/sessions`
- `GET /api/sessions/:id/steps`
- `GET /api/map?root=<abs path>`
- `GET /api/history?root=`
- `POST /api/ask`
- `GET /api/replay?sessionId=` (exports a session, its map and its saved answers as JSON for the hosted demo)
- `GET /api/export.md?root=` (stretch)

## Ownership and tasks

Each agent exports an express `Router` from its folder. A mounts them all in `server/src/index.ts`.

| Agent | Owns | Tasks, in order | Done when |
| --- | --- | --- | --- |
| **A: Live** | `server/` scaffold, `server/src/{index,types,db,ws}.ts`, `server/src/listener/` | 1. Scaffold server, types, stub routers for B and D. 2. Tail all jsonl files (chokidar, remember byte offsets), parse lines into Steps, store them, broadcast over ws. 3. Sessions and steps REST. 4. `/api/replay` export. 5. Map snapshot after each finished turn (`history` table). | A live Claude Code session streams steps to `ws://localhost:4000/ws` |
| **B: Map + Reader** | `server/src/mapper/`, `server/src/reader/`, `server/src/llm/nemotron.ts` | 1. Mapper: walk the project (skip node_modules, .git, dist), count lines, parse imports (TS/JS `import`/`require`, Python `import`/`from`) into edges. Module = top two folder levels. `lastChangedAt` from git log plus file mtime. Watch for changes and push `file` messages. 2. Nemotron client (`enable_thinking: false`, 20s timeout, 2 retries). 3. Step labels: at most 8 words per edit or tool_call; send `step-update`. 4. File summaries (2 sentences), cached by content hash in the db, then module summaries. 5. Risk flags on edits: deleted tests, auth/payment/env files, more than 50 lines deleted, secrets. | The map shows real summaries, and new steps get labels within seconds |
| **C: Web** | `web/` | 1. Vite scaffold, ws client, mock data in the contract's shape. 2. Sessions list plus Follow timeline (label, kind icon, time, diff viewer on click). 3. Map with react-force-graph-2d: color by recency, pulse when `activeSessionId` is set, size by lines, side panel on click. 4. Ask box (on a step or a node) showing answer, model and cost. 5. History slider. 6. Replay mode: `?replay=/replay.json` loads a static file, so the same UI works on Vercel. | All three views run on real data from localhost:4000 |
| **D: Ask + Brev** | `server/src/ask/`, `server/src/llm/claude.ts`, `server/src/privacy/`, `../docs/brev-setup.md` | 1. Get Nemotron running on Brev with the human (see `../docs/brev-setup.md`) and log every command. 2. `/api/ask`: build a small context (question, the step and its diff, 3 steps before it, the file summary and module summary, at most 150 lines of the file) and call Claude. Fall back to Nemotron if Claude fails. Save Q&A in the db and reuse the saved answer when the file hash is unchanged. 3. Cost meter (tokens times price). 4. Secret masking: redact API keys, tokens and passwords before anything is stored or sent. 5. Measure numbers for `../docs/numbers.md`. | Asking about a real step returns a grounded answer with its cost |

**Claude model:** `claude-opus-5` by default (Opus 5: $5 input / $25 output per million tokens). Use `claude-sonnet-5` ($2 / $10) if cost matters. Record the choice in the build log.

## Priorities (cut from the bottom)

1. Listener, then Follow view on real sessions
2. Map (structure, recency, live pulse)
3. Nemotron summaries and step labels (**never cut**: this is the Brev score)
4. Ask with the cost meter
5. Replay export and static web build (for the hosted demo)
6. Secret masking
7. History slider
8. Risk flags
9. Pause and steer through a Claude Code PreToolUse hook (stretch)
10. Markdown export (stretch)

## Checkpoints

| Time | What must be true |
| --- | --- |
| 13:50 | Types committed; server and web both boot |
| 14:30 | Each agent's piece works on its own |
| 15:10 | End to end: live session, map, labels, ask |
| 15:40 | **Code freeze.** Only fixes after this. Export replay, deploy `web/` to Vercel. |
| 16:15 | Submitted (buffer until 16:30) |
