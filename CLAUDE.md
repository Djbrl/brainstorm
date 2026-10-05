# Brainstorm

Brainstorm is a live map and replay of what AI agents do: every Claude Code session ("thread"), every file and place it touches, and what broke. It runs locally next to Claude Code and ships as a Claude Code plugin. It started at the GOMYCODE × NVIDIA hackathon on 27 Sep 2026 (3rd place, Senegal) and is being turned into a product. Several agents often work in this repo at the same time.

| Folder | What | Read first |
| --- | --- | --- |
| `app/` | The product: NestJS server (`app/server`) and React web app (`app/web`) | `docs/technical.md` |
| `plugin/` | The Claude Code plugin: hooks, scripts, and the built app in `plugin/build` | `plugin/README.md` |
| `docs/` | How it works, what's planned, the build log | `docs/README.md` |
| `site/` | The landing page (brainstorm-landing.vercel.app) | |
| `video/` | The hackathon demo video (finished) | |

## Rules for every agent

- **Branches.** `main` is the development branch. Work on a feature branch in your own git worktree (`.claude/worktrees/<name>`), never in the main checkout while someone else uses it. The judged hackathon state is the tag `hackathon-submission`: never move it.
- **Before you start,** check what others are doing: `git worktree list`, recent commits on `main`, and `docs/todo.md`. Don't edit files another agent is changing right now; say what you need in your report or in `docs/build-log.md` under "Requests".
- **Commits:** small, message prefixed with your area in brackets (for example `[camera]`, `[attention]`). Never commit `.env`, secrets, `node_modules`, `app/server/data/` or `tsconfig.tsbuildinfo`.
- **Pushes and deploys are the human's.** Build and commit, then hand over the exact command. That covers pushing `main`, plugin releases (bump `plugin/.claude-plugin/plugin.json`, rebuild with `node app/scripts/build-plugin.mjs` from `app/`, commit `plugin/build`), the landing page and the hosted demos. Never redeploy the judged demo (brainstorm-demo-black.vercel.app).
- **Log milestones** in `docs/build-log.md` with the date and time; keep `docs/todo.md` ticked when you finish something on it.
- **Check your work in the app,** not only with the typechecker: `cd app/web && npx tsc -b`, `cd app/server && npx tsc -p . --noEmit`, then look at it. Another session's dev servers may be running (API on 4000, web on 5173 or another port, the installed plugin on 4747): don't restart or kill them; start your own on a free port (`API_PORT=<port> npx vite --port <port>` in `app/web`; `PORT=<port> MAP_ROOT=<repo> node dist/main.js` in `app/server`). The step and file panels need a window about 1440 px wide.
- **Design:** light, Apple-like, big type, lots of air. No eyebrow labels, no stacked cards, no all-caps section titles. Plain words for people who aren't engineers. Check the dark map themes too.
- **Privacy:** everything stays on the person's machine. The server listens on 127.0.0.1 only. Nothing leaves it unless the person shares a replay, and shared replays are redacted first.
