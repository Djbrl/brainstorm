# Brainstorm

**A live map of your code and of the AI agents writing it.**

AI coding agents make it easy to stop understanding your own code. Brainstorm runs next to Claude Code and shows what the agents did, where, and why, so a human stays in the loop.

**Try the recorded demo:** https://brainstorm-demo-black.vercel.app (Brainstorm following its own build: one lead agent and four subagents, plus the landing page session)

![Map: the repo's modules and files, glowing by how recently they changed](docs/screenshots/map.png)

## What it does

- **Follow**: a live timeline of a Claude Code session: prompts, messages, tool calls and edits, each with a short label. Click a step to see its diff and ask "why?".
- **Map**: the project's modules and files as a graph, with imports as lines. Files glow by how recently they changed and pulse where an agent is editing right now. Click a file for its summary, the steps that touched it, and a question box.
- **Ask**: questions go to Claude with a small, grounded context (the step, its diff, the steps before it, the file and module summaries, at most 150 lines of the file). Every answer shows its model, tokens and cost.

![Follow: a live session timeline with Nemotron step labels](docs/screenshots/follow.png)

## The right model for each job

- **Nemotron 3 Nano on NVIDIA Brev** (vLLM, one L40S) does the bulk work: a two-sentence summary of every file and module, and a label of at most 8 words for every agent step. See [docs/brev-setup.md](docs/brev-setup.md).
- **Claude** answers questions, about $0.03 each. If Claude is unreachable, Nemotron answers instead.
- Most features need no AI at all: the timeline, the graph, imports, git history and recency.

Measured numbers: [docs/numbers.md](docs/numbers.md).

## Privacy

Local-first. Session logs are read from `~/.claude/projects` on your machine and stored in a local SQLite file. API keys, tokens and passwords are masked before anything is stored or sent. Only small, masked context packages go to a model.

## Run it

Needs Node 24 and Claude Code sessions in the folder you want to map.

```bash
cp app/.env.example app/.env   # add NEMOTRON_URL/KEY and ANTHROPIC_API_KEY
cd app/server && npm install && npm run dev    # http://localhost:4000
cd app/web && npm install && npm run dev       # http://localhost:5173
```

Stack: NestJS 11 + `node:sqlite` + chokidar + WebSocket on the server, Vite + React 19 + react-force-graph on the web. Details in [app/README.md](app/README.md).

## Known limits

Claude Code only today (Codex is next). The history slider and pause/steer are not built yet.
