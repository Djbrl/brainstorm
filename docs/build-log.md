# Build log

One line per milestone: `HH:MM [agent] what happened`. Newest at the bottom.

- 13:25 [human] Workspace created: app/, docs/, video/ with briefings.

- 13:56 [Video/Codex] Drafted 90-second script (143 words) and rendered a 24-second, 720p motion mockup. Concept UI/data labeled illustrative; no voice/music yet. Outputs: video/script-v1.md and video/out/opening-v1.mp4.

- 14:43 [lead] App foundation committed: NestJS 11 server (node:sqlite, chokidar, ws gateway) + Vite/React 19 web, contract in `app/server/src/types.ts` (+ `Replay` type). Stack changed from express to NestJS at the human's request. 4 agents launched in parallel: A listener, B map + Nemotron reader, C web Follow + Ask UI, D web Map + Ask server. Target end-to-end 15:10.

- 15:02 [lead] All 4 agents done. End to end works on real data: A listener streams live Claude Code sessions (incl. subagents), B maps the repo (68 files, 7 modules) with Nemotron summaries on every file + module and live step labels, C Follow timeline + AskBox, D Map (recency colors, agent pulse, file sheet) + /api/ask (grounded context, secret masking, sqlite cache, Nemotron fallback). Replay export + static build ready. Blocker: Anthropic key needs a workspace ID (asked human). Brev tunnel dropped once around 14:55; reopened.

- 15:05 [lead] Human swapped in a workspace-scoped Anthropic key: Ask now answers with claude-opus-5, about $0.03 per question. B fixed Nemotron echoing its own prompt (0/631 bad labels, 0/76 bad summaries after cleanup). Live pulse checked with a real Edit (made bolder for the video).

- 15:25 [lead] Hosted replay demo live at https://brainstorm-demo-black.vercel.app (build session + landing session, 1,152 steps, secrets scanned). Public repo https://github.com/Djbrl/brainstorm with README + screenshots; full history scanned for secrets first. Landing page branch merged into main.

## Requests

Format: `HH:MM [from → to] what you need`. Mark `DONE` when handled.
- 15:25 [lead → site] Demo link: https://brainstorm-demo-black.vercel.app, repo: https://github.com/Djbrl/brainstorm. Screenshots (1920×1200, from the demo): `docs/screenshots/follow.png`, `docs/screenshots/map.png`. History view was cut, so no history.png. Numbers in `docs/numbers.md`.
