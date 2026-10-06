# Technical documentation

Brainstorm is a local web app that runs next to Claude Code. It reads Claude Code's session logs as they are written, maps the project the agents are editing, and uses two models: Nemotron for bulk reading and Claude for questions.

- Server: `app/server/`, NestJS 11, TypeScript, Node 24
- Web: `app/web/`, Vite 7, React 19, TypeScript
- Shared contract: `app/server/src/types.ts`, imported by the web as `@contract`

## Architecture

```
~/.claude/projects/**/*.jsonl ──▶ Listener ──▶ SQLite ──▶ REST + WebSocket ──▶ Web (Follow, Map, Failures)
                                     │                          ▲
                                     ▼ bus: step, file-touched  │
project folder + git ───────────▶ Mapper ──────────────────────┤
                                     │                          │
                                     ▼                          │
                                  Reader ──▶ Nemotron on Brev ──┤  labels, summaries, risk flags
                                                                │
Web "Ask" ──▶ /api/ask ──▶ Claude (fallback: Nemotron) ─────────┘
tool_result errors ──▶ Failures ──▶ Nemotron names each group ──▶ /api/failures
```

Everything runs on the user's machine. The only network calls are to the two models, and they only receive small, masked context.

## Server modules (`app/server/src/`)

| Module | Files | What it does |
| --- | --- | --- |
| Core | `core/` | `DbService` (one `node:sqlite` file at `server/data/brainstorm.db`), `BusService` (in-process events `session`, `step`, `file-touched`), `EventsGateway` (push-only WebSocket at `/ws`), `ConfigService` (env) |
| Listener | `listener/` | Watches the workspace's folders in `~/.claude/projects/` with chokidar, remembers a byte offset per file, parses appended lines into `Step`s and `Session`s, stores them, emits them on the bus and broadcasts them over the socket. Files are read 4 MB at a time and stored about 1 MB per transaction; history is read after the server listens, newest first, without broadcasting it (what a file gains after it was listed is live) |
| Mapper | `mapper/` | Walks the project root, counts lines, resolves imports (TS/JS `import`/`require`, Python `import`/`from`) into edges, takes `lastChangedAt` from one `git log` call plus file mtimes, watches for changes, and marks files an agent is editing (`activeSessionId`, cleared after 60 s) |
| Reader | `reader/` | Nemotron step labels (at most 8 words), two-sentence file summaries cached by content hash, module summaries, and rule-based risk flags |
| LLM | `llm/` | `NemotronService` (OpenAI-compatible client, 6 requests in flight, 20 s timeout, 2 retries, output validation) and `ClaudeService` (`@anthropic-ai/sdk`, 30 s timeout) |
| Ask | `ask/` | `POST /api/ask`: builds a small grounded context, calls Claude, falls back to Nemotron, computes cost, caches answers |
| Privacy | `privacy/mask.ts` | `maskSecrets()`: redacts keys and tokens before anything is stored or sent |
| Failures | `failures/` | `GET /api/failures`: finds failing tool calls, groups them, ranks them, has Nemotron name each group |
| Replay | `replay/` | `GET /api/replay`: exports sessions, steps, the map, saved answers and failures as one JSON file for the hosted demo |
| Shots | `shots/` | `GET /api/tasks/shot/:stepId/:idx`: screenshots that tools returned, read from the session logs into the database, for the step panel. Never part of a replay |
| Git | `git/` | `GET /api/git` + ws `git`: the project's branch, ahead/behind its upstream, files not committed and not pushed, and the repo's other checkouts (worktrees) with what each has committed that your branch doesn't, what it hasn't committed, and the threads working there. Plain git commands (a status is 20–40 ms), worked out again a moment after the mapper sees files change, a step arrives or the repo's refs change; `git status` runs without optional locks so it never wakes its own watch |
| Open | `open/` | `POST /api/open`: opens a file in the app the computer uses for it (Settings, "Open files in"). JSON from a local origin only; text and code files inside the project or a thread's folder; never a file a default app would run |

Modules talk through the bus and a few public service methods, such as `ListenerService.getStep`, `stepsBefore`, `updateStep` and `unlabeledSteps`, and `ReaderService.getFileSummary`. That split let four agents build them in parallel.

## Reading Claude Code logs

Claude Code writes one JSON object per line to `~/.claude/projects/<project path with / replaced by ->/<sessionId>.jsonl`. Subagent transcripts live one level deeper, in `<sessionId>/subagents/agent-*.jsonl`, and share the parent's `sessionId`.

| Log line | Becomes |
| --- | --- |
| `user`, string content or text blocks | `prompt` (harness notices such as "[Request interrupted by user]" are dropped) |
| `assistant` text block | `text` |
| `assistant` thinking block (non-empty) | `thinking` |
| `assistant` `tool_use` named Edit / MultiEdit / Write | `edit`, with `filePath` and `diff: {before, after}` |
| other `tool_use` | `tool_call`, with `tool`, `input`, `filePath` if present |
| `user` `tool_result` block | `tool_result`, text cut to 2,000 characters; `is_error` kept |

- **Step ids:** `<line uuid>:<block index>`.
- **Order:** `seq` increases per session.
- **Status:** a session is `running` while its last event is under 2 minutes old.
- **Which logs are read:** only project folders whose name contains `SESSION_FILTER`, and only files changed in the last 24 hours.

## Contract

```ts
Session  { id, cwd, title, startedAt, lastEventAt, status: "running" | "idle" }
Step     { id, sessionId, seq, ts, kind, text?, tool?, input?, filePath?, diff?, label?, risk?, isSubagent? }
FileNode { path /* absolute */, module /* top two folders */, lines, lastChangedAt?, activeSessionId?, summary? }
ProjectMap { root, files, edges: {from, to}[], modules: {id, summary?}[] }
AskRequest  { question, stepId?, filePath?, root? }
AskResponse { answer, model, tokensIn, tokensOut, costUsd, fallback }
FailureGroup { key, tool, error, title, advice, count, firstSeen, lastSeen, sessions, retried, touchesEdits, priority, evidence[] }
Replay   { exportedAt, sessions, steps, map, answers, failures? }
```

WebSocket messages: `session`, `step`, `step-update` (a label or risk flags arrived), `file`, `map`.

## HTTP API (port 4000, prefix `/api`)

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/sessions` | Sessions, most recent first |
| GET | `/sessions/:id/steps?afterSeq=` | Steps of one session, in order; with `afterSeq`, only the steps after that seq |
| GET | `/map?root=` | The project map (default root: `MAP_ROOT`) |
| POST | `/ask` | `AskResponse` |
| GET | `/failures?sessionId=a,b` | Failure groups, most urgent first |
| GET | `/replay?sessionId=a,b&root=` | A `Replay` file for the hosted demo |
| GET | `/tasks/shot/:stepId/:idx` | One screenshot a tool returned (image bytes) |
| GET | `/history?root=` | Empty for now (history is not built yet) |

## Storage

One SQLite file, `app/server/data/brainstorm.db`, ignored by git. Each module creates its own tables at startup.

| Table | Owner | Content |
| --- | --- | --- |
| `sessions`, `steps`, `listener_offsets` | Listener | Parsed logs and the byte offset reached in each file |
| `summaries` | Reader | File and module summaries keyed by content hash |
| `ask_answers` | Ask | Questions and Claude answers, reused while the file is unchanged |
| `failure_names` | Failures | Nemotron's title and advice per failure group |

A `steps` row is one `Step` (`app/server/src/types.ts`): `id` (`<line uuid>:<block index>`), `session_id`, `seq`, `ts`, `kind`, `text`, `tool`, `input`, `file_path`, `diff`, `label`, `risk` (JSON where structured), `is_subagent`, `tool_use_id` (pairs a result with its call, since 30 Sep 2026) and `agent_id` (the subagent the step comes from, null on the main thread, since 5 Oct 2026). Columns added later come with a guarded `ALTER TABLE` at startup. Subagent steps stored before `agent_id` existed get it once, in the background after the server listens (`listener/agent-ids.ts`): it re-reads the stored part of those threads' `subagents/agent-*.jsonl` logs, only sets `agent_id` where it is missing, skips logs that are gone, and records `agent_ids_backfilled` in `settings` so it never runs again. With it, a reloaded thread keeps parallel subagents apart as the live one does.

## How the models are used

**Nemotron 3 Nano (30B, FP8) on NVIDIA Brev.**
- Setup: served by vLLM on one L40S, reached at `http://localhost:8000/v1` through `brev port-forward`. See [brev-setup.md](brev-setup.md) and [nemotron.md](nemotron.md).
- Every request sends `chat_template_kwargs: {enable_thinking: false}`.
- Prompt design: instructions go in the system message only. Content is wrapped as data (`<file>`, `<step>`, `<module>`, `<failure_group>`).
- Output checks: outputs that repeat instruction phrases, labels with several lines, and labels over 10 words are rejected and retried once.
- On failure, the app falls back to a plain label (`Edit mapper.service.ts`, `Run: npm test`), so it never waits on the model.

| Job | When | Output |
| --- | --- | --- |
| Step label | Every new edit, tool call and prompt, plus a backfill of the 150 newest unlabeled steps at startup | At most 8 words |
| File summary | After the map is built, most recently changed files first | Two sentences, cached by content hash |
| Module summary | After its files are summarized | One or two sentences |
| Failure group name | When a new group appears | Title of at most 8 words and a one-line fix |
| Ask fallback | When Claude fails | An answer, cost 0 |

**Claude (`claude-opus-5` by default).** It answers Ask questions from a small context:
- the question
- the step and its diff
- the 3 steps before it
- the file summary and module summary
- at most 150 lines of the file, centered on the edit

Everything is masked first. Cost is tokens × price ($5 in, $25 out per million tokens), about $0.03 per question in practice. Answers are cached by question, step, file and file hash.

## Failures

1. **Detect.** A `tool_result` is a failure if its log line has `is_error`, or its text starts with `<tool_use_error>`, `Error`, or `Exit code N` (N not 0), or mentions "File has not been read yet", "String to replace not found", or a blocked permission.
2. **Pair.** Results come back in call order, even for parallel calls, so each result is matched to the oldest unanswered call. This is done separately for the main thread and for subagents.
3. **Group.** The key is the tool name plus a normalized error. The error is normalized like this:
   - The `<tool_use_error>` tags are removed.
   - For shell errors, the most error-like line of the output is used.
   - Paths, ids, numbers and quoted strings are replaced with placeholders.
   - The result is cut to 80 characters.
4. **Rank.** `priority = count × (0.3 + 0.7 × e^(−hours since last seen / 6)) × 1.5 if the same failure repeats in one session × 1.3 if it touches edits`.
5. **Name.** Nemotron gives each group a title and a one-line fix, cached by key. If Nemotron is unavailable, the title is `<tool>: <normalized error>`.

## Web (`app/web/src/`)

| Part | What it does |
| --- | --- |
| `lib/live.tsx` | One external store. Loads the workspace, threads, map, agents and attention, then applies WebSocket messages in batches, one per animation frame, with indexes so a message touches one file or one thread. `structureVersion` changes only when the set of files (or a module, or the root) does. Read it with `useLiveSelector(sel, eq?)`; `useLive()` (everything, every change) still works. In replay mode it loads a static JSON file instead, and `clock()` runs from the export time so "just now" and the recency colors look as they did when recorded |
| `lib/nav.tsx` | Where you are (thread, step, file, lens) and the links for it, in a small external store. `useNavActions()` never re-renders, `useNavState()` ignores the replay cursor, `useReplayCursor(sel?)` reads it; `useNav()` is all of it in one object |
| `lib/store.ts` | The selector hook both stores use (`useSyncExternalStore`) and `shallowEqual` |
| `follow/` | Sessions list, timeline, step detail with the diff and the Ask box |
| `map/` | The project as a map of folders: every folder is a circle with its files and subfolders packed inside (`graph.ts`, d3-hierarchy circle packing: the same files always give the same map, and nothing is simulated, so nothing moves on its own). Files are sized by line count and coloured by recency, with a ring where an agent is working. Folders open as you zoom (`fold.ts`): small on screen, a folder is one circle with its name and file count; bigger, its files fade in where they always are. The selected file, an open thread's files and where agents work show their folders open at any zoom. Clicking a closed folder zooms into it. Clicking a file (or picking it in the sidebar's tree, from a link or from a step's file) selects it and shows it in the sidebar's Files tab in place of the tree (`sidebar/FileView.tsx`): its summary, imports and the files that use it, recent steps and Ask. "All files" or Esc goes back to the tree and lets go of the file. The selection is in the link (`useSelectedFile.ts`); the right-hand panel is only for a step. react-force-graph-2d is only the canvas, zoom and hit-testing (no forces). `MapView.tsx` wires it; `drawNode.ts` draws a frame, `labels.ts` places names, `useMapCamera.ts` frames the camera, `useLiveAgents.ts` holds the agents |
| `map/` on big projects | The canvas redraws only while something moves (`redraw.ts`): at rest it does no work. A frame draws only what's on screen and inside open folders; themed marks and every name are stamped from small cached pictures (`sprites.ts`, `labels.ts`); import lines are drawn only around the hovered or selected file (Metro keeps all of its lines; a line into a closed folder ends on its circle). The layout is computed in milliseconds, so nothing is saved between visits; it's redone only when files come or go, and the circles that move glide to their new places |
| `failures/` | Ranked groups; each piece of evidence opens its step in Follow |
| `ask/` | Question box with suggestion chips, markdown answers, and model, tokens and cost |

## Privacy

- **Local storage:** logs and summaries stay in a local SQLite file.
- **Masking:** `maskSecrets()` runs on every step before it is stored and on every context before it is sent. It redacts:
  - API keys: Anthropic, NVIDIA, GitHub, AWS, Slack, Google
  - JWTs, bearer tokens and PEM private keys
  - passwords inside URLs, `--password=` flags
  - `KEY=value` or `"password": "…"` style assignments
- **Published export:** before the hosted demo was published, the replay file was scanned for the real key values in `.env` and for personal email addresses.

## Hosted demo

`GET /api/replay` writes a `Replay` JSON. The web is built with `VITE_REPLAY_URL=/replay.json` and deployed as static files to Vercel. The same UI then runs without a server and says "Recorded demo". Ask returns the saved answers.
