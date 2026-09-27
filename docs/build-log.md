# Build log

One line per milestone: `HH:MM [agent] what happened`. Newest at the bottom.

- 13:25 [human] Workspace created: app/, docs/, video/ with briefings.
- 13:57 [site] Landing page draft in `site/` (static index.html, all links and numbers in one `SITE` config, hidden until filled).
- 14:00 [site] Landing page live at https://brainstorm-landing.vercel.app
- 14:11 [site] Landing page redesigned: light, Apple-style scroll scenes, Cabinet Grotesk + Satoshi. Redeployed.
- 14:50 [site] Hero is now a scroll story: follow Agent 1, then three agents, into the codebase, zoom out to the map. Redeployed.

- 13:56 [Video/Codex] Drafted 90-second script (143 words) and rendered a 24-second, 720p motion mockup. Concept UI/data labeled illustrative; no voice/music yet. Outputs: video/script-v1.md and video/out/opening-v1.mp4.
- 14:18 [human] Brev L40S up (\$1.06/hr), vLLM 0.30 + Nemotron 3 Nano loading, tunnel on localhost:8000. See docs/brev-setup.md.

- 14:20 [Video/Codex] Added video/HANDOFF.md for Claude/context recovery. Revised 24-second mockup to light theme, no eyebrow headings or card stacks; Cabinet Grotesk + Satoshi from Fontshare. Rendered/visually checked video/out/opening-v2.mp4; latest script is video/script-v2.md.

- 14:43 [lead] App foundation committed: NestJS 11 server (node:sqlite, chokidar, ws gateway) + Vite/React 19 web, contract in `app/server/src/types.ts` (+ `Replay` type). Stack changed from express to NestJS at the human's request. 4 agents launched in parallel: A listener, B map + Nemotron reader, C web Follow + Ask UI, D web Map + Ask server. Target end-to-end 15:10.

- 15:02 [lead] All 4 agents done. End to end works on real data: A listener streams live Claude Code sessions (incl. subagents), B maps the repo (68 files, 7 modules) with Nemotron summaries on every file + module and live step labels, C Follow timeline + AskBox, D Map (recency colors, agent pulse, file sheet) + /api/ask (grounded context, secret masking, sqlite cache, Nemotron fallback). Replay export + static build ready. Blocker: Anthropic key needs a workspace ID (asked human). Brev tunnel dropped once around 14:55; reopened.

- 15:05 [lead] Human swapped in a workspace-scoped Anthropic key: Ask now answers with claude-opus-5, about $0.03 per question. B fixed Nemotron echoing its own prompt (0/631 bad labels, 0/76 bad summaries after cleanup). Live pulse checked with a real Edit (made bolder for the video).

- 15:29 [Video/Codex] Rebuilt video around the live landing page: green hero, agent trails, map, comprehension motivation, local architecture, model roles, measured tokenomics. Full 90s silent animatic at video/out/film-v3.mp4; script-v3.md (164 words), optional narration-v3.vtt, and updated HANDOFF.md. Product scenes remain illustrative pending real capture.

- 15:38 [Video/Codex] Final-stretch handoff ready at video/FINAL-HANDOFF.md. Full 90s v3 animatic completed and verified; needs human voice, actual product captures, final captions/audio and 1080p render before upload.

## Requests

Format: `HH:MM [from → to] what you need`. Mark `DONE` when handled.
- 13:57 [site → docs] Add the landing page URL to `submission-checklist.md` once deployed; send final numbers so `site/index.html` SITE block can be filled.
- 13:57 [site → C / human] Real screenshots of Follow, Map, History as `site/img/{follow,map,history}.png` after 15:10.
