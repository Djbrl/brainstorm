<img src="brand/rundown-logo.svg" alt="Rundown" height="48">

# Rundown

**Keep up with your agents: where they go, what they touch, where they break.**

Rundown was called Brainstorm until October 2026 (the plugin was renamed in 0.5; the GitHub repo keeps the old name for now).

🥉 **3rd place** at [GOMYCODE × NVIDIA "Come Build with AI" 2026](https://hackathon.gomycode.com/onboarding/winners) (as "Brainstorm", listed as "Brainstorm.ap").

AI agents make it easy to stop understanding your own work. Rundown runs next to Claude Code and shows what the agents did, where, and why, so a human stays in the loop. Every session becomes a replay you can watch live or catch up on later, for code and for work that isn't code.

Rundown is a prototype (0.3). The full release is planned for late October 2026.

## Install (Claude Code plugin, preview)

In Claude Code:

```
/plugin install rundown --marketplace Djbrl/brainstorm
```

On Claude Code older than 2.1.275, use two commands instead:

```
/plugin marketplace add Djbrl/brainstorm
/plugin install rundown@rundown
```

Then start a new session in your project and run `/rundown:open`: the map opens in your browser. You need Node.js 22.13 or later. Everything runs on your machine. Settings, updates and uninstall: [plugin/README.md](plugin/README.md). Had the plugin when it was called Brainstorm? See [moving from Brainstorm](plugin/README.md#moving-from-brainstorm-04-and-older).

## Try the live demo

- **[brainstorm-next.vercel.app](https://brainstorm-next.vercel.app)**: a real recording of Claude Code agents (one lead and four subagents) building Rundown itself, played back. Open the thread to see what it touched, then its steps or its replay. Nothing to install.
- **[brainstorm-landing.vercel.app](https://brainstorm-landing.vercel.app)**: what Rundown does, the roadmap, and the waitlist for the full release.

![Map: a thread replaying, the agent's numbered path across the project's files, its steps in the sidebar](docs/screenshots/replay.jpg)

## Run it from source

For development, or to run it without the plugin. Needs Node 24, Claude Code and git. Nemotron and a Claude key are optional (without them: plain labels, no summaries, no Ask).

```bash
git clone https://github.com/Djbrl/brainstorm.git && cd brainstorm
cp app/.env.example app/.env   # set MAP_ROOT, SESSION_FILTER, ANTHROPIC_API_KEY, NEMOTRON_*
(cd app/server && npm install) && (cd app/web && npm install)
cd app/server && npm run dev    # terminal 1: http://localhost:4000
cd app/web && npm run dev       # terminal 2, from the repo root: http://localhost:5173
```

Full guide, Brev setup and troubleshooting: [docs/run-locally.md](docs/run-locally.md). To build the plugin bundle yourself: `node app/scripts/build-plugin.mjs` from the repo root (details in [plugin/README.md](plugin/README.md)).

## What it does

- **Three levels, one at a time**: the project (the map at rest, live agents as dots, and what changed since you last looked), a thread (first its footprint: what you asked, the files it changed, lit on the map; then its steps or its replay), and a step (its diff or output and a question box, in a side panel). Each has its own link (`/thread/<id>`, `/thread/<id>/step/<id>`), and Back or Esc goes up one level.
- **Map**: the project's modules and files as a graph. Files changed since you last looked stand out. Each agent is a marker that moves to the file it writes; an open thread adds its trail and its reads as short lines of sight. Replay any thread on the map, step by step. Hover or select a file to see what it imports and what uses it; click it for its summary, the steps that touched it, and a question box.
- **Places**: where a thread went outside the code: websites, the apps you run on this computer, services (GitHub, Vercel, connectors, cloud CLIs), and what it changed there, from deploys and pushes to sent forms. Same screen as the Map; click a place to read the step in a side panel.
- **Track**: the open thread's steps in the sidebar, next to the map, grouped by what you asked. Scrolling them moves the agent along the map; open a step for its diff, its output or the screenshots it took.
- **Errors**: a failed tool call turns the agent's marker red with one red ring, and shows red in the steps (with the first line of the error), on the replay bar and in the Track. (At the hackathon, a separate Failures view grouped and ranked them.)
- **Share**: Share on the replay player (or `/rundown:share`) saves a thread as one `.html` file anyone can open in a browser, with nothing to install, and as a Markdown report for a review or a pull request. Secrets and emails are masked, your home folder and computer name hidden, and screenshots never included.
- **Ask**: questions go to Claude with a small, grounded context (the step, its diff, the steps before it, the file and module summaries, at most 150 lines of the file). Every answer shows its model, tokens and cost.


## AI models

- **Nemotron 3 Nano on NVIDIA Brev** (vLLM, one L40S) does the bulk work: a two-sentence summary of every file and module, and a label of at most 8 words for every agent step. See [docs/brev-setup.md](docs/brev-setup.md).
- **Claude** answers questions, about $0.03 each. If Claude is unreachable, Nemotron answers instead.
- Most features need no AI at all: the timeline, the graph, imports, git history and recency.

Measured numbers: [docs/numbers.md](docs/numbers.md). Nemotron stress test: 81k lines of Hono summarized in 73 seconds for $0.02 of GPU time.

That was the hackathon setup. The Brev instance is shut down now, so the plugin ships with summaries off; they'll move to the Claude Code you already have (see the [roadmap](docs/roadmap.md)).

## Privacy

Local-first. Session logs are read from `~/.claude/projects` on your machine and stored in a local SQLite file. API keys, tokens and passwords are masked before anything is stored or sent. Only small, masked context packages go to a model.

### Usage stats

To know how many people use Rundown, roughly where, and which parts matter, the plugin sends one anonymous report a day. It never contains code, file paths, prompts, thread titles, names or anything you typed. Exactly what it sends:

| Field | What it is |
| --- | --- |
| `id` | A random install id, made on your machine the first time (not derived from anything about it) |
| `kind` | `new` the first time, then `day` |
| `v`, `os` | Rundown's version, and `darwin`, `linux` or `win32` |
| `tm` | The map theme in use |
| `c` | Counts since the last report: app opened, threads opened, replays played, live follows, threads shared, questions asked, projects opened, agent sessions seen working, agent steps seen |

The landing site that receives it adds the country from the request (two letters) and keeps no IP address. Reports are kept as empty files whose names hold the fields above, in a private store only the maintainer can read.

**To turn it off:** Settings → Usage stats, or set `DO_NOT_TRACK=1` or `RUNDOWN_USAGE=off` in your environment (that also locks the setting off). Turned off, nothing is counted or sent. A development build (`npm run dev`) never sends anything. The code: [`app/server/src/usage/`](app/server/src/usage/) and [`site/api/usage.js`](site/api/usage.js).

## Documentation

| | |
| --- | --- |
| [Technical documentation](docs/technical.md) | Architecture, modules, contract, API, storage, how each model is used, Failures algorithm, privacy |
| [Run it on your machine](docs/run-locally.md) | Running from source, configuring, Nemotron on Brev, troubleshooting |
| [How we built it](docs/how-we-built-it.md) | One human and several AI agents in parallel: who did what, timeline, problems and fixes |
| [Roadmap](docs/roadmap.md) | Product vision, packaging as a plugin, pricing ideas, decisions |
| [Tasks and the Track](docs/tasks.md) | Following agents beyond code: how the Track is built, privacy |
| [Plugin](plugin/README.md) | Install, updates, settings, what it stores, uninstall |
| [What's next](docs/next-steps.md) | What we cut at the hackathon and how we'd build it, with size estimates |
| [Measured numbers](docs/numbers.md) · [Brev setup log](docs/brev-setup.md) · [Build log](docs/build-log.md) | The raw record |

## The hackathon

Rundown, then called Brainstorm, was built in about three hours on 27 September 2026 at GOMYCODE × NVIDIA "Come Build with AI", by one human and several AI agents working in parallel ([how we built it](docs/how-we-built-it.md)). The repo exactly as it stood at the 16:30 deadline is tagged [`hackathon-submission`](https://github.com/Djbrl/brainstorm/tree/hackathon-submission); everything after it is labeled `[post-deadline]` in the history.

## Known limits

Claude Code only today (Codex is next). No file summaries or model-written step labels in the plugin yet. The history slider and pause/steer are not built yet; see the [to-do list](docs/todo.md) and the [roadmap](docs/roadmap.md).

## License

[Functional Source License 1.1, Apache 2.0 future license](LICENSE.md) (`FSL-1.1-ALv2`). You can use, read, change and self-host Rundown, including at work. You can't offer it, or something built from it, as a competing product or service. Two years after each release, that release is also available under the Apache License 2.0.
