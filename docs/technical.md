# Technical documentation

Rundown is a local web app that runs next to Claude Code (and Codex). It reads the agents' session logs as they are written, maps the project they are editing, and shows both live and as a replay. One model is used, and only if you give it a key: Claude, for Ask.

- Server: `app/server/`, NestJS 11, TypeScript, Node 22.13 or later (it uses `node:sqlite` and `process.loadEnvFile`)
- Web: `app/web/`, Vite 7, React 19, TypeScript
- Shared contract: `app/server/src/shared/contract.ts`, imported by the web as `@contract`
- The plugin (`plugin/`) starts the built server with `plugin/scripts/launch.mjs`; see `plugin/README.md`

## Architecture

```
~/.claude/projects, ~/.codex/sessions ──▶ Listener ──▶ SQLite ──▶ REST + WebSocket ──▶ Web (Map, Places, the Track)
                                     │                          ▲
                                     ▼ bus: step, file-touched  │
project folder (git ls-files) ──▶ Mapper ───────────────────────┤
                                     │ bus: file-content         │
                                     ▼                          │
                         command edits, Reader (risk flags) ────┤
                                                                │
Plugin hooks ──▶ POST /api/hooks ──▶ Attention ─────────────────┤
Web "Ask" ──▶ POST /api/ask ──▶ Claude (only with a key) ───────┘
```

Everything runs on the person's machine and the server listens on 127.0.0.1 only. What leaves it: a question to Claude when Ask is used (small, masked context), the once-a-day usage report when the person said yes, the launcher's daily update check (Settings can turn it off), and a replay the person chooses to share.

## Server modules (`app/server/src/`)

| Module | Files | What it does |
| --- | --- | --- |
| Core | `core/` | `DbService` (one `node:sqlite` file, `rundown.db`, in the data folder: `RUNDOWN_DATA_DIR`, else `app/server/data/`; a `brainstorm.db` from before the rename is taken over), `BusService` (in-process events), `EventsGateway` (push-only WebSocket at `/ws`), `ConfigService` (environment), health and the live token, git safety (`git-safety.ts`) |
| Listener | `listener/` | Reads the agents' session logs through log sources (`source.ts`): Claude Code's (`claude.source.ts`) and Codex's (`codex.source.ts`). Watches the folders the sources point to, remembers a byte offset per file, stores the `Step`s and `Session`s, emits them on the bus and broadcasts them over the socket. Files are read 4 MB at a time and stored about 1 MB per transaction; history is read after the server listens, the last two weeks first, then older threads, without broadcasting it. Also works out files changed through commands (below). `listener.service.ts` wires it: `tailer.ts` reads each log from its saved offset (inode and first-line hash, 4 MB reads, lines handed over in batches), `step-store.ts` stores and numbers the steps (`StepsStore` is what other modules read), `scope.ts` says which threads the open project shows (its root, its repo, the folders it lived in before a move, threads from elsewhere that touched its files) |
| Mapper | `mapper/` | Lists the project's files (`git ls-files` in a git repo, so `.gitignore` decides; else a walk that skips dependency, build and dot folders: `ignore.ts`), keeps at most 3,000 (`RUNDOWN_MAX_FILES`; `select.ts` picks them across folders), counts lines, resolves imports into edges (JS/TS and Vue/Svelte/Astro, Python, Go, Rust, Java, C-family includes), takes `lastChangedAt` from a bounded, streamed `git log` plus file mtimes, watches the project with one recursive watch (changes batched every 100 ms), and marks a file an agent is editing (`activeSessionId`, cleared after 60 s). Keeps each mapped file's content compressed, so a change can say what it was before. `mapper.service.ts` builds the map from `list-files.ts`, `select.ts`, `read-file.ts` (bounded reads), `git-times.ts` and `imports.ts` (parsing and resolving imports); `live.ts` keeps it live (`watch.ts` events applied in batches, the pages told); `presence.ts` marks the files agents are editing |
| Reader | `reader/` | Rule-based risk flags on each edit (an `.env` file, auth, payment, a deleted test, a big deletion, a possible secret), set before the step is sent. No model |
| Agents | `agents/` | Where each agent is: its file on the map (or an island for a file off it), its trail, what it's doing in words (`away`). `GET /api/agents`, ws `agent` |
| Attention | `attention/` | Whether a thread needs you (below). `GET /api/attention`, `POST /api/hooks`, ws `attention` |
| Ask | `ask/`, `llm/` | `POST /api/ask`: builds a small grounded context, calls Claude (`ClaudeService`, `@anthropic-ai/sdk`, 30 s timeout), computes the cost, caches answers. Without `ANTHROPIC_API_KEY`, Ask is off |
| Shared | `shared/` | Small pure helpers the web imports too (`@shared/*`): whether a tool result failed (`failed.ts`), step labels (`labels.ts`) |
| Privacy | `privacy/mask.ts` | `maskSecrets()`: redacts keys and tokens before anything is stored or sent |
| Places | `cowork/` | `GET /api/cowork?sessionId=`: where a thread worked outside the code (below) |
| Shots | `shots/` | `GET /api/tasks/shot/:stepId/:idx`: screenshots tools returned, read from the logs into the database, for the step panel. Never part of a replay |
| Image | `image/` | `GET /api/image`: a picture an agent read (Codex logs only its path), loaded from disk when the person asks; pictures only, and every refusal is the same 404 |
| Replay | `replay/` | `GET /api/replay` (a JSON replay for the hosted demo), `GET /api/share` (a shared replay: one HTML file, masked and redacted), `GET /api/export.md` (a thread as Markdown: `markdown.ts` collects the turns, adds them up and renders them) |
| Elsewhere | `elsewhere/` | `GET /api/elsewhere`: threads at work in your other projects, for the header's "1 agent in skindiff" and Find a thread. Doesn't read their logs: each log's last change, the first few KB of a live one, and the last thing the hooks said. Working = written in the last 2 minutes; Needs you = a permission or question hook with nothing written since (kept 2 hours); Your turn = a Stop hook within those 2 minutes |
| Workspace | `workspace/` | The open project: `GET /api/workspace`, `GET /api/workspace/suggestions`, `POST /api/workspace` (switch), `POST /api/workspace/choose` (the system folder picker); ws `setup` |
| Open | `open/` | `POST /api/open` opens a file in the app the computer uses for it; `POST /api/reveal` shows it in Finder. JSON from a local origin only; text and code files inside the project or a thread's folder; never a file a default app would run |
| Onboarding | `onboarding/` | `GET/PUT /api/onboarding`: whether the first-run tour was done, once per install |
| Usage | `usage/` | Opt-in usage stats: `GET/PUT /api/usage`, `POST /api/usage/forget`, `POST /api/usage/event`. Off until the person says yes |
| Updates | `updates/` | `GET/PUT /api/updates`: whether the launcher checks for a new version once a day (on by default, `settings.json` in the data folder) |

Modules talk through the bus and a few public service methods (`ListenerService.getStep`, `stepsBefore` and the like).

Bus events (`core/bus.service.ts`): `session`, `step`, `file-touched` (an agent edited a file), `workspace` (the open project changed), `files-changed` (the mapper saw files change), `turn-ended` (an agent finished its turn, from its log), `file-content` (a mapped file changed on disk: what it was and is), `map-rules` (the folders a git repo's `.gitignore` excludes, so command edits follow the map's rules).

## Reading Claude Code logs

Claude Code writes one JSON object per line to `~/.claude/projects/<project path with / replaced by ->/<sessionId>.jsonl`. Subagent transcripts live one level deeper, in `<sessionId>/subagents/agent-*.jsonl`, and share the parent's `sessionId`. The project folder's name is the path with every character but a letter or digit replaced by `-`, cut at 200 characters with `-` and a hash of the path after it (`listener/moved.ts` `claudeProjectDir`, as Claude Code names it). A folder whose name only starts like the project's (a subfolder, a worktree, or a sibling: `app-backend` next to `app`) is read only for the logs whose thread ran inside the project (their `cwd`). Both Unicode forms of the project's path are tried (macOS records the decomposed one).

| Log line | Becomes |
| --- | --- |
| `user`, string content or text blocks | `prompt` (harness notices such as "[Request interrupted by user]" are dropped) |
| `assistant` text block | `text` |
| `assistant` thinking block (non-empty) | `thinking` |
| `assistant` `tool_use` named Edit / MultiEdit / Write | `edit`, with `filePath` and `diff: {before, after}` |
| other `tool_use` | `tool_call`, with `tool`, `input`, `filePath` if present |
| `user` `tool_result` block | `tool_result`, text cut to 2,000 characters; `is_error` kept |

- **Step ids:** `<line uuid>:<block index>`. Claude Code copies earlier lines, uuids and all, into a resumed or forked thread's log: a line a thread already has is skipped (it keeps its first place), and a copy of another thread's line is stored as `<line uuid>:<block index>@<thread id>`. A step line without a uuid is skipped.
- **Order:** `seq` increases per session. History reads a thread's own log and its subagents' together, their lines merged by time, so the order is what happened, not which file was read first; a thread starts with its earliest step, and a subagent's brief never titles it.
- **Replaced logs:** each offset is kept with the file's inode and a hash of its first line. A log cut short or replaced drops its thread's steps and is read again from the start; steps that come back keep their seq, so a re-read never renumbers what a page has.
- **Status:** a session is `running` while its last event is under 2 minutes old.

## Files changed through commands

Agents often change files by running a command instead of their edit tool: `sed -i`, `cat > f <<EOF`, a Python or Node script that writes the file, `mv`, `rm`, `git checkout -- f`. Those become edits of the thread too (Claude Code and Codex alike), so the map, the Track and the counts see them (`listener/command-edits.ts`):

- **Which files:** what the command says it writes, read from the command itself (`listener/command-writes.ts`, reading words and redirections with `listener/shell-tokens.ts` and inline scripts with `listener/script-writes.ts`: redirects, `tee`, in-place `sed`/`perl`/`ruby`, file commands, git restores, Codex's `apply_patch`, and the file calls inside Python, Node, Ruby and Perl scripts, with `cd` followed). Live, also any file that changed on disk while the command ran and that the command names (a formatter given the file). Only files inside the project count.
- **What changed:** live, the mapper keeps each mapped file's content (compressed, a few MB for 3,000 files) and puts every change on the bus with what the file was before (`file-content`); the edit gets the changed hunks (`listener/line-diff.ts`). In history only the command is known: the edit says what ran, not what changed.
- Each such edit has `input.byCommand`, the command, and a result (so attention never sees it waiting); the step panel says the agent used a command and shows it.

## Reading Codex logs

Codex writes one file per thread: `~/.codex/sessions/YYYY/MM/DD/rollout-<time>-<uuid>.jsonl` (older ones in `archived_sessions/`). Lines are `{timestamp, type, payload}` and don't carry the thread id: it's in the first line (`session_meta`: id, cwd, cli version, git remote) and in the file name, so reading can resume mid-file. A thread belongs to the open project when its starting folder (or a `runtime_workspace_roots` entry) is inside it; the first line of each file is read once and cached. Codex Desktop's own worktrees (`~/.codex/worktrees/<id>/<repo>`) count as their repo: the main checkout comes from the worktree's `.git` file (or the git remote once it's gone), and every path is rewritten onto the main checkout so the map places it.

Codex's actions are stored under Claude Code's tool names, so every view works unchanged (`codex.source.ts`, shapes in `codex.map.ts`):

| Codex | Becomes |
| --- | --- |
| `UserMessage` item | `prompt` (injected turns: environment context, AGENTS.md, instructions are skipped; Codex Desktop's "files mentioned" context becomes a chip) |
| `AgentMessage` / `Reasoning` with a summary / `ContextCompaction` | `text` / `thinking` / a short `text` |
| `CommandExecution` | Codex labels each command: reads → `Read` {file_path}, searches → `Grep`, listings → `Glob`, one step per part; anything else → `Bash` {command}. Result: the output, failed when the exit code isn't 0 |
| `FileChange` (or an older `apply_patch`) | `edit` per file: `Edit` with before/after per hunk (joined by `---`, like MultiEdit), `Write` for a new file; a rename lands on the new path |
| `McpToolCall` | `mcp__<server>__<tool>` and its result |
| web search | `WebSearch` / `WebFetch` |
| `update_plan` | `TodoWrite` |
| `request_user_input` | `AskUserQuestion` (open until answered: "Your turn") |
| `view_image` / `ImageView` | `Read` of the image |
| `event_msg task_complete` | not a step: a live "turn-ended" on the bus, which attention reads like Claude Code's Stop hook |

Codex logs each finished item once (`event_msg item_completed`); before 0.149 commands were only in the model's records (`response_item` function calls, or `tools.exec_command(...)` inside `exec` scripts), so those fill in what no item covers, without duplicates. Codex's approval-reviewer threads ("guardian") are left out. A subagent Codex starts (`thread_source: "subagent"`, `parent_thread_id`) is part of its parent's thread: its steps are stored there as a subagent's (`isSubagent`, `agentId` = its own thread id), like Claude Code's, and its task never titles the thread. A file read from the middle after a restart finds a call made before by one scan of the file when its answer arrives. Each source has a `version`: when what a line becomes changes, the threads stored from that source are dropped and its logs read again (`source_versions`). The workspace picker lists Codex's projects too (`CodexSource.projects`).

## Contract

```ts
Session  { id, cwd, title, startedAt, lastEventAt, status: "running" | "idle", harness: "claude" | "codex", home? }
Step     { id, sessionId, seq, ts, kind, text?, tool?, input?, filePath?, diff?, label?, risk?, isSubagent?, agentId?, toolUseId?, reads? }
FileNode { path /* absolute */, module /* top two folders */, lines, lastChangedAt?, activeSessionId?, summary? }
ProjectMap { root, files, edges: {from, to}[], modules: {id, summary?}[], formerRoots?, totalFiles?, scanStopped?, unread? }
AskRequest  { question, stepId?, filePath? }
AskResponse { answer, model, tokensIn, tokensOut, costUsd, fallback }
Replay   { exportedAt, sessions, steps, map, answers, cowork?, agentMoves?, setupPreview?, shared? }
```

WebSocket messages (`WsMessage`): `session`, `step`, `step-update` (a step's label or risk flags changed; nothing sends it today, risk flags ride on the first `step`), `steps-stored` (history was stored for a thread, with its last seq: a page that has fewer of its steps fetches the rest with `afterSeq`, as it does for every loaded thread when it reconnects), `file` (a file changed, with its imports when they were recomputed), `file-removed`, `map`, `agent`, `attention`, `setup`. The socket needs the per-start token from `GET /api/live-token`.

## HTTP API (port 4000 by default, prefix `/api`)

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/health?challenge=` | Version and status; with a challenge, an HMAC with the server's secret (the launcher's proof) |
| GET | `/live-token` | The token the WebSocket needs |
| GET | `/workspace`, `/workspace/suggestions` | The open project and its setup state; projects to pick from |
| POST | `/workspace`, `/workspace/choose` | Switch the project; open the system folder picker |
| GET | `/sessions` | Threads, most recent first |
| GET | `/sessions/:id/steps?afterSeq=` | A thread's steps, in order; with `afterSeq`, only the later ones |
| GET | `/map` | The open project's map |
| GET | `/agents` | Where each agent is |
| GET | `/attention` | Threads that need you |
| POST | `/hooks` | A plugin hook's event (needs the `x-rundown-hook: 1` header) |
| POST | `/ask` | `AskResponse` |
| GET | `/cowork?sessionId=` | A thread's places |
| GET | `/elsewhere` | Threads at work in other projects |
| GET | `/tasks/shot/:stepId/:idx` | One screenshot a tool returned (image bytes) |
| GET | `/image?…` | A picture an agent read, from disk |
| GET | `/replay?sessionId=a,b&root=` | A `Replay` JSON for the hosted demo |
| GET | `/share?sessionId=&format=` | A shared replay: one HTML file (or `format=json`) |
| GET | `/export.md?sessionId=` | A thread as Markdown |
| POST | `/open`, `/reveal` | Open a file in its app; show it in Finder |
| GET, PUT | `/onboarding`, `/usage`, `/updates` | First-run tour done; usage stats on or off; update check on or off |
| POST | `/usage/forget`, `/usage/event` | Delete what was sent; count one event |

## Storage

One SQLite file, `rundown.db`, in the data folder (`RUNDOWN_DATA_DIR`; the plugin uses Claude Code's plugin data folder, else `~/.rundown`; from a clone, `app/server/data/`, ignored by git). Each module creates its own tables at startup.

| Table | Module | Content |
| --- | --- | --- |
| `sessions`, `steps`, `listener_offsets`, `source_versions` | Listener | Parsed logs, the byte offset reached in each file (with its inode and first line's hash), each log source's version |
| `ask_answers` | Ask | Questions and Claude's answers, reused while the file is unchanged |
| `attention_hooks` | Attention | The last hook events per thread |
| `task_shots`, `task_shot_files` | Shots | Screenshots from tool results, and how far each log was read for them |
| `settings` | several | Small flags: the open project, onboarding, usage stats, one-time passes |

A `steps` row is one `Step`: `id` (`<line uuid>:<block index>`, `…@<thread id>` for a copy of another thread's line), `session_id`, `seq`, `ts`, `kind`, `text`, `tool`, `input`, `file_path`, `diff`, `label`, `risk` (JSON where structured), `is_subagent`, `tool_use_id` (pairs a result with its call) and `agent_id` (the subagent the step comes from, null on the main thread). Columns added later come with a guarded `ALTER TABLE` at startup. Subagent steps stored before `agent_id` existed get it once, in the background (`listener/agent-ids.ts`), recorded in `settings` so it never runs again. The web uses it to show one agent of a thread on its own (`lib/agentFocus.ts`), to mark a subagent's moments in the Track with its letter and colour, and to name a subagent after the `description` of the `Task`/`Agent` call that started it. An agent's presence (`agents/agents.service.ts`) starts with its first tool call: a call the map can't show (a command, a search) is said in words in `away`, and the marker stays where it was.

## Ask

Claude (`claude-opus-5` unless `CLAUDE_MODEL` says otherwise) answers from a small context:
- the question
- the step and its diff
- the 3 steps before it
- at most 150 lines of the file, centred on the edit

Everything is masked first. Cost is tokens × the model family's price (Opus $5 in and $25 out per million tokens). Answers are cached by question, step, file and the file's hash.

## Waiting for you (attention)

Rundown shows when a thread can't go on without you, and when it's your turn (`attention/`).

| State | When | Sure? |
| --- | --- | --- |
| Needs you: permission | A tool call waits for your OK | Sure with the plugin's hooks. Without them, a guess: an instant tool (Edit, Write, Read, Grep, WebFetch…) with no result and no activity for 8 s. Commands, subagents and browsers can take long, so they're never guessed |
| Needs you: question | The agent asked you something (AskUserQuestion, or an MCP form) | Sure |
| Needs you: plan | A plan waits for approval (ExitPlanMode) | Sure |
| Stuck | The same tool failed 3 times in a row on the main thread | Sure; clears on a success or a new message |
| Your turn | The agent finished: its last word was a message and nothing is open | Sure with the Stop hook (or Codex's `task_complete`), else after 4 s of quiet |

After 2 hours without activity a thread stops asking (except for an unanswered question or plan).

- **Where it shows:** a breathing dot and a "Needs you" or "Stuck" badge on the thread in the sidebar; the last row of the open thread says what it waits for; the waiting agent keeps a breathing ring on the map; the tab title counts them; desktop notifications if turned on in Settings (sure states only, fresh ones, only while the tab is in the background).
- **How:** one tracker per thread (calls with no result by tool_use id, failures in a row, the last main-thread step), fed by live steps and caught up from the stored log.
- **Hooks** (`plugin/hooks/hooks.json`): `SessionStart`, `PermissionRequest`, `Notification`, `Stop` and `UserPromptSubmit` run `plugin/scripts/signal.mjs` in the background. It posts the event to `POST /api/hooks` with an `x-rundown-hook` header, which other web pages can't send (no CORS), and drops the transcript path and working directory. A permission signal clears when its call gets a result, or when the main thread does anything new.

## Places (`cowork/`)

Where a thread went outside the code: websites, the apps you're building, connected services and command-line tools that reach the outside world. The Places lens shows the open thread's places, subagents included.

- **Sorting each tool call into a place** (`cowork/classify.ts`, pure functions), in four areas: **Web** (host, then page: host and path, no query or hash; both browsers, WebFetch, WebSearch), **Your apps** (localhost, `*.localhost`, `*.test`, `file://`), **Services** (connectors and other MCP servers, and shell commands that reach out: `git push`, `gh`, `vercel`, `npm publish`, `curl`…), **Apps** (the iOS Simulator, computer use).
- **Pages:** both browsers add a tab footer (title and URL) to every result; the tracker follows each tab through a thread, so a click lands on the page where it happened.
- **Reads and changes, with a confidence:** *sure* when the tool itself changes something (a connector's create, update, delete or send; publishing; a deploy; a push); *likely* for a click on a button named like a commit ("Send", "Submit", "Publish", "Delete", and French equivalents), Enter after typing on a website, a curl POST, an upload; *maybe* for a click on a button we can't name, typing, or a script that clicks. Links, tabs and form fields aren't changes; nothing in your own local apps counts as one.
- **Errors:** failed calls, blocked navigations, timeouts, and error lines from outward shell commands.
- `cowork.service.ts` pairs calls with results per thread and keeps each thread's result until its steps change.

Open problems: Cowork mode and other agents keep no local logs to read; a click by coordinates stays "maybe"; tool results are cut at 2,000 characters, so a long result can lose its tab footer (the tab's last known URL is used); connectors with opaque ids get a guessed name; computer-use failures (CAPTCHAs, login walls, loops) aren't detected; the list of outward CLIs is fixed; a local admin panel pointed at production never counts as a change.

## Screenshots and the Track

The Track is the sidebar's tab of the open thread's steps (`map/sidebar/TrackPanel.tsx` showing `map/thread/Track.tsx`, or `places/PlaceSteps.tsx` on Places; the row, the row window and the scroll that moves the cursor are shared, `map/thread/moments.tsx`): scrolling it moves the thread's cursor on the map, a click opens the step's panel.

Screenshots that tools return (base64 JPEG or PNG in the result, about 30 KB each) are read from the logs by `shots/shots.service.ts`, stored in the database by the result step's id (reading only new bytes of each log), and survive Claude Code's 30-day log cleanup. Asked for one it doesn't have, it reads what's new in that thread's logs and looks again; a miss is remembered for 30 s. The step panel shows them (`step/content/ToolView.tsx`). They're never part of a replay.


## Web (`app/web/src/`)

| Part | What it does |
| --- | --- |
| `lib/live.tsx` | One external store. Loads the workspace, threads, map, agents and attention, then applies WebSocket messages in batches, one per animation frame, with indexes so a message touches one file or one thread. `structureVersion` changes only when the set of files (or a module, or the root) does. Read it with `useLiveSelector(sel, eq?)`; `useLive()` (everything, every change) still works. In replay mode it loads a static JSON file instead, and `clock()` runs from the export time so "just now" and the recency colors look as they did when recorded |
| `lib/nav.tsx` | Where you are (thread, step, file, lens) and the links for it, in a small external store. `useNavActions()` never re-renders, `useNavState()` ignores the replay cursor, `useReplayCursor(sel?)` reads it; `useReplay()` is the open thread with its cursor. The open thread is `thread`; `isRecording()` (`lib/live.tsx`) says the app runs on a recording (the hosted demo or a shared file), with no server |
| `lib/switcher.ts`, `switch/` | Getting from thread to thread: the tab bar under the header (the open thread, those at work or waiting on you, those you opened in the last 12 hours, remembered per project; in the order they started, at most 9), Find a thread (⌘K: this project's threads, then those at work elsewhere), the header's agents-in-other-projects menu (picking one switches the server's project with `POST /api/workspace`, then opens the thread), and the app-wide keys with their list (`switch/shortcuts.ts`, the ? window) |
| `screen.ts` | What the shell shows, worked out before anything is drawn: the kind of app (your own, the hosted demo, its preview, a shared replay, `kindOf`) and the screen (loading, picking a project, the map, Places…, `screenOf`) |
| `lib/store.ts` | The selector hook both stores use (`useSyncExternalStore`) and `shallowEqual` |
| `map/` | The project as a map of folders: every folder is a circle with its files and subfolders packed inside (`graph.ts`, d3-hierarchy circle packing: the same files always give the same map, and nothing is simulated, so nothing moves on its own). Files are sized by line count and coloured by recency, with a ring where an agent is working. Folders open as you zoom (`fold.ts`): small on screen, a folder is one circle with its name and file count; bigger, its files fade in where they always are. The selected file, an open thread's files and where agents work show their folders open at any zoom. Clicking a closed folder zooms into it. Clicking a file (or picking it in the sidebar's tree, from a link or from a step's file) selects it and shows it in the sidebar's Files tab in place of the tree (`sidebar/FileView.tsx`): its summary, imports and the files that use it, recent steps and Ask. "All files" or Esc goes back to the tree and lets go of the file. The selection is in the link (`useSelectedFile.ts`); the right-hand panel is only for a step. react-force-graph-2d is only the canvas, zoom and hit-testing (no forces). `MapView.tsx` wires it, with its parts in hooks: `useMapFrame.ts` (a frame: start, each file, end), `useCanvasPointer.ts` (pointing and clicking), `useRedrawTriggers.ts` (what asks for a frame), `useOpenFolders.ts`, `useNodeResolver.ts` (an agent's file to its node), `useCameraKeys.ts`; `drawNode.ts` draws a file, `labels.ts` places names, `useMapCamera.ts` frames the camera (`camera.ts`: the part no panel covers, and moves that land in it), `themes.ts` is each theme as data and `marks.ts` and `routes.ts` draw it (a file's mark, an agent's marker, the ways agents travel), `tracer.ts` is the one marker the live agents, an open thread and Places all draw, `useLiveAgents.ts` holds the agents. An agent's writes are its solid trail; the last few files it read are dotted lines from its marker (`agents.tsx`). A map under 1100 px wide (`SMALL_MAP`, the Claude app's browser pane) is "small": an open thread followed live has the camera follow its agent at work by itself, framing the folder it works in and moving only when the agent nears the edge (`autoTrack.ts`, `useMapCamera.ts`; picking an agent or moving the camera yourself ends it until the next thread), and the Readmap in the top-right corner is a second camera that follows what the agent reads, by itself: it glides to the file read last, close enough to read its name and its neighbours' (files read together, within 15 s, are framed together when their names still read), an arrow on its edge pointing to the agent; nothing read yet, it shows the whole project with the big camera's frame, the agent's folder named in its colour (its header: "In" the folder). Its buttons pick the agent both cameras watch; a click shows that place on the big map (`Readmap.tsx`; on any map but a phone's, M, its × or the thread bar's M Readmap hides and shows it; on a big map it's as wide as the file window (`thread/FileWindow.tsx`), which sits right under it, the two one column with the same header ("Read" or "Edited", the file, its folder); looking back through a thread it shows what was read at that step, `readsNow` in `thread/ThreadLayer.ts`; A follows the next agent). On a small window Map | Places moves into the thread bar (`LensSwitch inBar`), and the folded sidebar's card (`sidebar/NowCard.tsx`: the Track folded to a few lines, with the Track's own words and dots: the moment it's on as the highlighted row, live its newest, on up to three lines when small, the ones before fading above, the next below when you look back, always four rows of one height; beside them a plain scroller, where you are in the thread, to click or drag; on a small window the footer player is hidden) takes the top of the map up to the Readmap (at most 520 px); scrolling on it steps through the thread, the player opening paused. The sidebar folds by itself only on a small window; on a wide one it's open (‹ or T folds it until reload). On a tablet-sized window the open sheet and a step's panel take turns; on a phone a step opens where the thread's sheet is, with Back. A step opened lands the cursor on it before live-follow resumes (App's `LandStep`). An agent always has a place: its last edit, or before it edits anything the last file it read, else where it stood (a command, a search), else the top of the project (`PARK`, `anchorFile`); scrolling back, the marker follows the same rule (reads place it once per moment until the first edit, `lib/thread.ts place`). A shell command's reads (`cat`, `sed -n`, `grep`, `head`, `wc`…) are worked out from its text by the server (`listener/command-writes.ts commandReads`, a step's `reads`, computed when steps are read so old threads have them too) and count as reads: the Readmap, the trail, the Files tab. Files off the map are on islands named for where they are ("Temporary files", "Claude Code's files", "Library", "Elsewhere on this computer", or another project, `lib/islands.ts`); a place's file shows its full path and Show in Finder (`POST /api/reveal`). T folds and unfolds it |
| `map/thread/` | An open thread on the map: the Track (`Track.tsx`), the file window (`FileWindow.tsx`), the footer player and Share (`Dock.tsx`, placed by `map/dock.css`), and the map layer (`ThreadLayer.ts`: the tracer and its stops) with the focus (`focus.ts`: which files are lit), the camera follow (`follow.ts`) and playback (`playback.ts`) |
| `step/` | A step's panel: the prompt, the tool's input and output, the diff, screenshots, JSON and HTML previews (`content/`) |
| `places/` (Places) | Where an open thread went outside the code (`GET /api/cowork`): in the code map's language (`PlacesMap.tsx`). Your computer (where a thread starts and comes back to while it works in the code; a click opens the Map) beside each kind of work (Web, Services, Your apps, Apps), a circle like a top folder, its sites circles inside, their pages dots, packed with d3-hierarchy (stable, nothing floats); a page coloured by when it was last worked on, ringed orange if something changed there, a red dot if a step failed. The thread's marker stands on its place at the replay's cursor (its newest while live; looking back, faint, with the solid one where it is now), its trail through the places before; the camera follows it from site to site (on a small map, framing the site). Looking back, only its recent places (the step window, counted in places) are lit and named. The places go by the thread's steps in order (full detail, `rows.ts`), synced to the app's moments. The player plays place by place (Space, ‹ ›, ← →). The sidebar's list (`PlaceSteps.tsx`) goes back through the thread as the Track does: scrolling moves the thread to the row at its middle, the list follows the replay. The sidebar's folded card and scroller are the Map's; no Readmap (a visit is the movement itself). A click opens the place's step (`CoworkView.tsx`, `PlaceSteps.tsx`) |
| `map/` on big projects | The canvas redraws only while something moves (`redraw.ts`): at rest it does no work. A frame draws only what's on screen and inside open folders; themed marks and every name are stamped from small cached pictures (`sprites.ts`, `labels.ts`); import lines are drawn only around the hovered or selected file (a line into a closed folder ends on its circle). The layout is computed in milliseconds, so nothing is saved between visits; it's redone only when files come or go, and the circles that move glide to their new places |
| `ask/` | The Ask box: suggestion chips, Markdown answers, the model, tokens and cost |
| `setup/` | Picking a project the first time |
| `settings/` | Settings: the map theme, what the map shows, following a thread, folders, the app files open in, notifications, updates, usage stats, the tour again |

## Privacy

- **Local storage:** logs, answers and screenshots stay in a local SQLite file.
- **Masking:** `maskSecrets()` runs on every step before it is stored and on every context before it is sent. It redacts:
  - API keys: Anthropic, OpenAI, NVIDIA, GitHub, GitLab, AWS, Slack, Google, Stripe, SendGrid, npm, PyPI, Hugging Face, DigitalOcean, Shopify
  - JWTs, bearer tokens, cookies and API-key headers, and PEM private keys
  - passwords inside URLs, tokens in query strings (`?access_token=`, `X-Amz-Signature=`), `--password=` flags, `curl -u`, `mysql -p`
  - `KEY=value` or `"password": "…"` style assignments, and lowercase unquoted ones (`password: …` in YAML, `aws_secret_access_key = …`) when the value looks like a secret rather than code
- **Local only:** requests must name this machine (`Host`, against DNS rebinding); writes need a JSON body from a local page (no form parser, so no CSRF); the live feed (`/ws`) needs a per-start token from `GET /api/live-token`, which other origins can't read; the page is served with a Content Security Policy and can't be framed. Ask, the map and replays stay inside the open project (symlinks resolved). Git runs with `core.fsmonitor=false` and no hooks, so a copied repo's config can't run a program.
- **First run:** a tour (`map/tour/Tour.tsx`, `lib/tour.ts`), once per install (kept by the server, `GET/PUT /api/onboarding`, so the Claude app's pane, Chrome and Safari don't each show it): a card beside each part in turn, driving the app itself, with Skip, Back and Next on every step. Settings and the shortcuts window start it again. The hosted demo keeps its one welcome card (`map/Welcome.tsx`).
- **Usage stats:** off until the person says yes (asked once: the tour's last step, or `map/UsageAsk.tsx` after a skipped tour). With a yes, one report a day (`usage/usage.service.ts`); Settings can turn it off or delete what was sent. The site deletes reports after 13 months.
- **Launcher trust:** `server.json` (0600) holds a per-start secret; the launcher and the hooks send `GET /api/health?challenge=` and trust the port only if the answer's HMAC proves it.
- **Shared replays:** home folder (also JSON-escaped and URL-encoded), account and computer names and emails are replaced; the file carries a hash-pinned Content Security Policy and makes no network requests. Screenshots are never included.

## Hosted demo

`GET /api/replay?sessionId=` writes a `Replay` JSON (redacted with the private `redact.json`). `app/scripts/record-demo.mjs` adds the demo's agent moves and recorded setup run, and `npm run build:demo` builds the web with `VITE_DEMO=1` (which brings in `lib/preview.ts`; other builds leave it out) and `VITE_REPLAY_URL=/replay.json`, as static files. The same UI then runs without a server and says "Recorded demo". Ask returns the saved answers. The judged hackathon demo (brainstorm-demo-black.vercel.app) is never redeployed. How to record and build: [demo.md](demo.md).
