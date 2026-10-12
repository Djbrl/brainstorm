# Run Rundown from a clone

Most people install the Claude Code plugin (see the main README). This page is for working on Rundown itself.

The recorded hackathon demo needs no install: https://brainstorm-demo-black.vercel.app (the judged state; it predates most of what's below).

## What you need

| | Required? | Notes |
| --- | --- | --- |
| Node.js 22.13 or later | Yes | The server uses Node's built-in `node:sqlite` and `process.loadEnvFile`. `.nvmrc` names the version (`nvm use`, `fnm use`) |
| Claude Code (or Codex) | Yes | Rundown reads their session logs in `~/.claude/projects` and `~/.codex/sessions` |
| git | Recommended | In a git repo the map follows `.gitignore` and shows when each file was last committed |
| Anthropic API key | Only for Ask | Without one, Ask is off and the rest works. Set `ANTHROPIC_WORKSPACE_ID` if the key isn't scoped to a workspace |

## 1. Get the code and install

```bash
git clone https://github.com/Djbrl/brainstorm.git
cd brainstorm/app/server && npm install
cd ../web && npm install
```

## 2. Configure `app/.env` (optional)

```bash
cp app/.env.example app/.env
```

Everything in it is optional. A server run from a clone reads it at startup, also with a scratch data folder (`RUNDOWN_DATA_DIR`); a variable already set in the shell wins over the file. The plugin's server never reads a `.env`: its settings come from Claude Code.

| Variable | Example | Meaning |
| --- | --- | --- |
| `RUNDOWN_PORT` (or `PORT`) | `4000` | Server port (127.0.0.1 only). The web dev server proxies to `API_PORT`, 4000 by default |
| `RUNDOWN_ROOT` | `/Users/you/code/my-project` | The project to open at start (an absolute path). Otherwise the last one picked in the app. `MAP_ROOT` does the same and wins over it |
| `ANTHROPIC_API_KEY` | `sk-ant-…` | Claude key for Ask |
| `ANTHROPIC_WORKSPACE_ID` | `wrkspc_…` | Only if your key isn't scoped to a workspace |
| `CLAUDE_MODEL` | `claude-opus-5` | Any Claude model. Prices per model family for the cost meter are in `app/server/src/ask/ask.service.ts` |
| `RUNDOWN_DATA_DIR` | `/tmp/rundown-data` | Where `rundown.db` and the server's private files live. Default: `app/server/data/`. Set, the server also behaves as the plugin's does: it looks for a free port upwards from its own and writes `server.json` there |
| `RUNDOWN_MAX_FILES` | `3000` | At most this many files on the map |
| `CLAUDE_PROJECTS_DIR`, `CODEX_HOME` | `~/.claude/projects`, `~/.codex` | Only if the agents keep their logs somewhere else |

## 3. Start it

Two terminals:

```bash
cd app/server && npm run dev    # builds with tsc, then rebuilds and restarts on save
```

```bash
cd app/web && npm run dev       # http://localhost:5173
```

Open http://localhost:5173, pick your project, then start or continue a Claude Code session in it. Steps appear live, and the agent moves on the map as it reads and edits.

On the first start the server maps the project and reads all of its threads in the background, the last two weeks first.

`npm run dev` in `app/server` runs `tsc -w` and the server together (`app/scripts/dev-server.mjs`); Ctrl-C stops both.

### A second copy beside another one

Several checkouts (git worktrees, other agents' sessions) can run at once if each has its own ports and data folder. Three variables do it:

| Variable | Where | Meaning |
| --- | --- | --- |
| `RUNDOWN_PORT` | `app/server` | The server's port. Pick a free one |
| `RUNDOWN_DATA_DIR` | `app/server` | A data folder of its own (any empty folder), so the copies don't share a database |
| `RUNDOWN_ROOT` | `app/server` | The project it opens, so it doesn't start on the last one the other copy picked |
| `API_PORT` | `app/web` | The server port the web dev server sends `/api` and `/ws` to (4000 by default) |

```bash
cd app/server && RUNDOWN_PORT=4976 RUNDOWN_DATA_DIR=/tmp/rd RUNDOWN_ROOT=/path/to/project node dist/main.js
cd app/web && API_PORT=4976 npx vite --port 5176
```

`app/.env` is still read by such a copy (for the Anthropic key); the variables on the command line win over it.

## 4. Checks

```bash
cd app/server && npm test             # build (with the tests) and run the full test suite
cd app/server && npm run typecheck    # the server's code and tests, no build
cd app/web && npm run typecheck       # the web
```

## 5. (Optional) Make your own hosted replay

```bash
# with your server running on <port>; --session takes one or more comma-separated ids from /api/sessions
RUNDOWN_DATA_DIR=<the server's data folder> node app/scripts/record-demo.mjs --server http://127.0.0.1:<port> --session <id1>,<id2>
cd app/web && npm run build:demo
# deploy app/web/dist-demo to any static host
```

Check the recording for anything private before publishing. Secrets are masked, but the file holds your prompts, the agents' messages and diffs. To share one thread with someone, use Share in the app instead: it makes one redacted HTML file. The details, and the private redaction list: [demo.md](demo.md).

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Ask answers say "fallback" | Claude failed. The server's output says why. "API key is not scoped to a workspace" means you need `ANTHROPIC_WORKSPACE_ID` |
| No threads | The open project isn't the folder the threads ran in: pick it in the app |
| The map shows the wrong project | Pick the project in the app, or set `RUNDOWN_ROOT` to an absolute path and restart the server |
| `npm run dev` in `app/server` fails with a Nest CLI error | Don't use `nest start`. The server builds with plain `tsc` (TypeScript 7 has no compiler API for the Nest CLI) |
| `.env` changes are ignored | The server reads `.env` only at startup: restart it. A variable set in the shell wins over the file |
