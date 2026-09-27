# Try Brainstorm

## Option 1: the recorded demo (no install)

Open https://brainstorm-demo-black.vercel.app

It replays real sessions from Brainstorm's own build: the lead agent and four subagents building the app, plus the landing page session. All three views work, and Ask shows answers Claude gave during the recording.

- `?view=map` opens the Map directly.
- `?view=failures` opens the Failures panel directly.

## Option 2: run it on your own machine

### What you need

| | Required? | Notes |
| --- | --- | --- |
| Node.js 24 | Yes | The server uses Node's built-in `node:sqlite` and `process.loadEnvFile` |
| Claude Code | Yes | Brainstorm reads its session logs in `~/.claude/projects` |
| git | Yes | Used for "last changed" times on the map |
| Anthropic API key | For Ask | A key scoped to a workspace. Otherwise also set `ANTHROPIC_WORKSPACE_ID` |
| An OpenAI-compatible endpoint serving Nemotron | For labels and summaries | We use NVIDIA Brev + vLLM. Without it, the app still runs, with plain labels and no summaries |

### 1. Get the code and install

```bash
git clone https://github.com/Djbrl/brainstorm.git
cd brainstorm/app/server && npm install
cd ../web && npm install
```

The web uses `legacy-peer-deps` (set in `app/web/.npmrc`) because the diff viewer hasn't declared React 19 support yet.

### 2. Configure `app/.env`

```bash
cp app/.env.example app/.env
```

| Variable | Example | Meaning |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | `sk-ant-…` | Claude key for Ask |
| `ANTHROPIC_WORKSPACE_ID` | `wrkspc_…` | Only if your key isn't scoped to a workspace |
| `CLAUDE_MODEL` | `claude-opus-5` | Any Claude model. Prices per model family for the cost meter are in `app/server/src/ask/ask.service.ts` |
| `NEMOTRON_URL` | `http://localhost:8000/v1` | OpenAI-compatible endpoint |
| `NEMOTRON_KEY` | | The vLLM `--api-key` |
| `NEMOTRON_MODEL` | `nemotron` | The vLLM `--served-model-name` |
| `PORT` | `4000` | Server port (the web dev server proxies to 4000) |
| `MAP_ROOT` | `/Users/you/code/my-project` | **The project to map.** The default is this repo |
| `SESSION_FILTER` | `my-project` | **Which Claude Code sessions to follow.** Any text found in the session's folder name under `~/.claude/projects` (your project path with `/` replaced by `-`). The default is `brainstorm` |
| `CLAUDE_PROJECTS_DIR` | `~/.claude/projects` | Only if Claude Code stores its logs somewhere else |

To follow your own project, set `MAP_ROOT` to its absolute path and `SESSION_FILTER` to its folder name.

### 3. (Optional) Run Nemotron on NVIDIA Brev

The full command log we used is in [brev-setup.md](brev-setup.md). The short version:

```bash
brew install brevdev/homebrew-brev/brev && brev login
# In the Brev console: create a GPU instance with at least 46 GB (we used 1× L40S), name it brainstorm-gpu
brev shell brainstorm-gpu
docker run -d --name vllm --gpus all --ipc=host -p 127.0.0.1:8000:8000 \
  -v ~/.cache/huggingface:/root/.cache/huggingface vllm/vllm-openai:latest \
  --model nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-FP8 --served-model-name nemotron \
  --max-model-len 32768 --trust-remote-code --api-key "$NEMOTRON_KEY"
exit
brev port-forward brainstorm-gpu --port 8000:8000   # keep this running on your machine
```

Check it:

```bash
curl -s http://localhost:8000/v1/models -H "Authorization: Bearer $NEMOTRON_KEY"
```

Any OpenAI-compatible server works (another vLLM host, or a local server) if it serves a model under the name in `NEMOTRON_MODEL`.

### 4. Start it

Two terminals:

```bash
cd app/server && npm run dev    # builds with tsc, then rebuilds and restarts on save
```

```bash
cd app/web && npm run dev       # http://localhost:5173
```

Open http://localhost:5173, then start or continue a Claude Code session in your project.
- **Follow:** steps appear live, and Nemotron labels replace the plain ones within seconds.
- **Map:** a file pulses while an agent edits it.
- **Failures:** failed tool calls are grouped and ranked.

On the first start, the server reads the last 24 hours of matching sessions, maps the project and summarizes files in the background. Expect about 200 files per minute on one L40S.

### 5. (Optional) Make your own hosted replay

```bash
# with the server running; sessionId takes one or more comma-separated ids from /api/sessions
curl -s "http://localhost:4000/api/replay?sessionId=<id1>,<id2>" -o app/web/public/replay.json
cd app/web && VITE_REPLAY_URL=/replay.json npx vite build
# deploy app/web/dist to any static host, e.g. from inside app/web/dist: vercel deploy --prod
```

Check `replay.json` for anything private before publishing. Secrets are masked, but the file contains your prompts, the agents' messages and diffs.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Labels stay like `Run: npm test`, and no summaries appear | Nemotron is unreachable. Check the curl above. Brev tunnels can drop, so rerun `brev port-forward …` |
| Ask answers say "fallback" | Claude failed. The server log (`app/server/data/server.log` if you redirect output there, otherwise the terminal) shows why. A common one: "API key is not scoped to a workspace" means you need to set `ANTHROPIC_WORKSPACE_ID` |
| No sessions in Follow | `SESSION_FILTER` doesn't match the folder under `~/.claude/projects`, or the session is more than 24 hours old |
| Map shows the wrong project | Set `MAP_ROOT` to an absolute path and restart the server |
| `npm run dev` fails in `app/server` with a Nest CLI error | Don't use `nest start`. The project builds with plain `tsc`, because TypeScript 7 doesn't ship the compiler API the Nest CLI needs |
| `.env` changes are ignored | The server reads `.env` only at startup. Restart it |
