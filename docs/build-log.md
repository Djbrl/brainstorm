# Build log

One line per milestone: `HH:MM [agent] what happened`. Newest at the bottom.

- 13:25 [human] Workspace created: app/, docs/, video/ with briefings.
- 13:57 [site] Landing page draft in `site/` (static index.html, all links and numbers in one `SITE` config, hidden until filled).
- 14:00 [site] Landing page live at https://brainstorm-landing.vercel.app
- 14:11 [site] Landing page redesigned: light, Apple-style scroll scenes, Cabinet Grotesk + Satoshi. Redeployed.
- 14:50 [site] Hero is now a scroll story: follow Agent 1, then three agents, into the codebase, zoom out to the map. Redeployed.
- 15:30 [site] Module names on hero map, pinned stats with study titles, 'Where your money goes' section, dark Brev section, 'Try Brainstorm now' CTA. Redeployed.
- 15:39 [site] Landing page links the hosted app (brainstorm-demo-black.vercel.app) from the header and 'Try Brainstorm now', plus the GitHub repo.

- 13:56 [Video/Codex] Drafted 90-second script (143 words) and rendered a 24-second, 720p motion mockup. Concept UI/data labeled illustrative; no voice/music yet. Outputs: video/script-v1.md and video/out/opening-v1.mp4.
- 14:18 [human] Brev L40S up (\$1.06/hr), vLLM 0.30 + Nemotron 3 Nano loading, tunnel on localhost:8000. See docs/brev-setup.md.

- 14:20 [Video/Codex] Added video/HANDOFF.md for Claude/context recovery. Revised 24-second mockup to light theme, no eyebrow headings or card stacks; Cabinet Grotesk + Satoshi from Fontshare. Rendered/visually checked video/out/opening-v2.mp4; latest script is video/script-v2.md.

- 14:43 [lead] App foundation committed: NestJS 11 server (node:sqlite, chokidar, ws gateway) + Vite/React 19 web, contract in `app/server/src/types.ts` (+ `Replay` type). Stack changed from express to NestJS at the human's request. 4 agents launched in parallel: A listener, B map + Nemotron reader, C web Follow + Ask UI, D web Map + Ask server. Target end-to-end 15:10.

- 15:02 [lead] All 4 agents done. End to end works on real data: A listener streams live Claude Code sessions (incl. subagents), B maps the repo (68 files, 7 modules) with Nemotron summaries on every file + module and live step labels, C Follow timeline + AskBox, D Map (recency colors, agent pulse, file sheet) + /api/ask (grounded context, secret masking, sqlite cache, Nemotron fallback). Replay export + static build ready. Blocker: Anthropic key needs a workspace ID (asked human). Brev tunnel dropped once around 14:55; reopened.

- 15:05 [lead] Human swapped in a workspace-scoped Anthropic key: Ask now answers with claude-opus-5, about $0.03 per question. B fixed Nemotron echoing its own prompt (0/631 bad labels, 0/76 bad summaries after cleanup). Live pulse checked with a real Edit (made bolder for the video).

- 15:25 [lead] Hosted replay demo live at https://brainstorm-demo-black.vercel.app (build session + landing session, 1,152 steps, secrets scanned). Public repo https://github.com/Djbrl/brainstorm with README + screenshots; full history scanned for secrets first. Landing page branch merged into main.

- 15:29 [Video/Codex] Rebuilt video around the live landing page: green hero, agent trails, map, comprehension motivation, local architecture, model roles, measured tokenomics. Full 90s silent animatic at video/out/film-v3.mp4; script-v3.md (164 words), optional narration-v3.vtt, and updated HANDOFF.md. Product scenes remain illustrative pending real capture.

- 15:38 [Video/Codex] Final-stretch handoff ready at video/FINAL-HANDOFF.md. Full 90s v3 animatic completed and verified; needs human voice, actual product captures, final captions/audio and 1080p render before upload.

- 15:45 [lead] Failures panel (SupplyzPro "Find the Hidden Failures"): GET /api/failures finds failing tool calls (is_error, <tool_use_error>, non-zero exit, blocked permissions), pairs each with its call, groups by tool + normalized error, ranks by count x recency with boosts for retries and edits, and Nemotron names each group with a one-line fix. Failures tab with evidence that jumps to the step in Follow (C). In the replay demo. Brev tunnel dropped again at 15:38; reopened.

- 16:50 [lead] POST-DEADLINE cosmetic update: replay welcome tour (no feature or data changes)

- 16:55 [human] POST-DEADLINE cosmetic update: landing page screenshots (Follow, Map, Failures), Failures card replaces the unbuilt History card, deck.html. No product changes.

- 16:58 [lead] POST-DEADLINE cosmetic update: header wordmark links to landing page

- 18:56 [lead] POST-DEADLINE, local app only: started a workspace Setup screen (pick a folder, live checklist while Brainstorm reads the code and connects to Claude Code) and live agents on the Map (markers that move file to file, trails, tracker panel). Agents S (server setup), C (setup screen), D (agents server + map). The hosted demo is unchanged.

- 19:05 [lead] POST-DEADLINE, local app only: Setup and live agents work end to end. Setup lists recent Claude Code projects (decoded from ~/.claude/projects), reads the code, maps imports, finds the Claude Code CLI (including the copy bundled with the desktop app), checks Nemotron and the Claude key, and shows summary progress. On the Map, each agent's marker moves file to file with a fading trail, and a tracker lists each agent's route. Checked with this session's own reads and edits.

- 20:34 [lead] POST-DEADLINE: preview of the setup screen and live agents deployed to https://brainstorm-next.vercel.app (recorded agent moves and a recorded setup run played back; unrelated personal projects redacted). Code on the `post-deadline` branch. The only change on `main` is a README note for the jury. The judged demo is unchanged.

- 20:51 [lead] POST-DEADLINE privacy fix: both public demos redacted (data only). Removed titles of the human's unrelated Claude threads, other project names and folders, a listing of the private Documents folder, a process list, and the Vercel username. Only hackathon threads are in the replays. Replay exports now apply a private, gitignored redaction list (app/server/data/redact.json) automatically.

- 21:40 [lead] POST-DEADLINE: thread replay on the Map + Threads/Files sidebar + show/hide agents deployed to brainstorm-next

- 21:55 [lead] POST-DEADLINE, local first: the looping edit pulse on the Map is replaced by one ripple per agent edit, then a steady outline while the file is being edited. Checked live with real edits.

- 00:02 (28 Sep) [lead] POST-DEADLINE: one-ripple edit animation + light replay (180 moments from 1,583 steps) deployed to brainstorm-next.

- 00:03 (28 Sep) [lead] Brev instance brainstorm-gpu deleted at the human's request; billing stopped. Nemotron is offline from here on.

- 00:53 (28 Sep) [lead] POST-DEADLINE, judged demo header only: a "Try Brainstorm Next" button linking to the preview, at the human's request. Built from main + that button (tag `judged-demo-live`); data unchanged; no other feature added to the judged demo.

- 01:43 (28 Sep) [lead] POST-DEADLINE: brainstorm-next redeployed with a fresh recording (1,904 steps and 124 agent moves, up to 01:42) and every post-deadline feature. The setup playback keeps the run recorded while Nemotron was online; the newest 15 files have no summary because the Brev instance is gone. Redaction fixed: it now works on text values, not escaped JSON, and blanks any value mentioning a private item. Re-checked the judged demo data with the fix: nothing left to remove.

## Requests

Format: `HH:MM [from → to] what you need`. Mark `DONE` when handled.
- 13:57 [site → docs] Add the landing page URL to `submission-checklist.md` once deployed; send final numbers so `site/index.html` SITE block can be filled.
- 13:57 [site → C / human] Real screenshots of Follow, Map, History as `site/img/{follow,map,history}.png` after 15:10.
- 15:25 [lead → site] Demo link: https://brainstorm-demo-black.vercel.app, repo: https://github.com/Djbrl/brainstorm. Screenshots (1920×1200, from the demo): `docs/screenshots/follow.png`, `docs/screenshots/map.png`. History view was cut, so no history.png. Numbers in `docs/numbers.md`.
