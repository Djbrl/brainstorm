# How we built it

Brainstorm was built in one afternoon: workspace set up at 13:25, code freeze at 15:40, submission at 16:30. One human directed several AI coding agents working in parallel. This matches the product's thesis: agents did the typing, and the human stayed in the loop by reading a map of what they did. The git history and [build-log.md](build-log.md) are the primary record. This page summarizes them.

## Who did what

| Worker | Tool | Area | Result |
| --- | --- | --- | --- |
| Human | | Idea, briefings, decisions, API keys, Brev account | Workspace and agent briefings (13:32), stack choice, approvals |
| Planning and GPU session | Claude Code | `docs/` | NVIDIA Brev GPU + vLLM + Nemotron setup with a full command log, the agent guide `nemotron.md`, the Hono stress test, the judging audit, the submission form |
| Landing page session | Claude Code | `site/` | https://brainstorm-landing.vercel.app, redesigned twice |
| Video session | Codex | `video/` | Script and a 90-second animatic made with Remotion (React components rendered to video) |
| Lead app session | Claude Code | `app/` | Plan, scaffold, contract, integration, replay, deploys, Failures server, docs |
| Agent A: Live | Claude Code subagent (Sonnet) | `app/server/src/listener/` | Reads the session logs live, including subagent logs |
| Agent B: Map + Nemotron | Claude Code subagent (Sonnet) | `mapper/`, `reader/`, `llm/nemotron.service.ts` | Project map, Nemotron labels and summaries, risk flags |
| Agent C: Web Follow + Ask | Claude Code subagent (Opus) | `web/src/follow/`, `web/src/ask/`, `web/src/failures/` | Follow timeline, Ask box, Failures view |
| Agent D: Web Map + Ask server | Claude Code subagent (Opus) | `web/src/map/`, `ask/`, `llm/claude.service.ts`, `privacy/` | Map view, `/api/ask`, secret masking |

Models were matched to the work. Sonnet handled the two server pieces with precise specs (log parsing, graph building). Opus handled the two UI pieces that the video shows, where design judgment mattered.

## How parallel work stayed safe

1. **One contract first.** Before any agent started, the lead committed `app/server/src/types.ts` (sessions, steps, map, ask, WebSocket messages). It could only grow by adding fields.
2. **One folder per agent.** Each agent owned specific folders and received stub files with the method names others would call. No two agents edited the same file.
3. **Shared running servers.** The lead started one server and one web dev server that rebuilt on save, so all four agents tested against the same running app and didn't fight over ports.
4. **Dependencies installed once.** The lead installed every package up front, so agents never edited `package.json` at the same time.
5. **Small commits, prefixed by agent** (`[A]`, `[B]`, `[C]`, `[D]`, `[lead]`), committing only their own paths.

## Timeline

| Time | What happened |
| --- | --- |
| 13:25–13:32 | Workspace, briefings and plan written by the human |
| 13:57–14:11 | Landing page drafted, deployed, and redesigned. Video script and first mockup |
| 13:55–14:20 | Brev GPU (1× L40S, $1.06/hour) created. vLLM serving Nemotron 3 Nano; tunnel open |
| 14:17 | Status check: the app folder was still empty, 40 minutes behind the plan |
| 14:19–14:22 | Plan approved; stack switched from express to NestJS at the human's request |
| 14:22–14:43 | Lead scaffolds the NestJS server, the Vite + React web and the contract; installs packages |
| 14:44 | Four agents launched in parallel |
| 14:46–14:58 | Ask box, Follow, Map, secret masking, Ask server, listener, mapper and Nemotron reader all committed |
| 14:57 | Planning session: Nemotron stress test, 81k lines of Hono summarized in 73 s for $0.02 |
| 15:00 | End to end on real data: live sessions, the map with 68 files all summarized, labels, Ask |
| 15:04 | Real Claude answers after the key fix, about $0.03 per question |
| 15:07 | Nemotron prompts fixed so they stop repeating their own instructions |
| 15:17–15:31 | Hosted replay demo deployed; public GitHub repo created after a full-history secret scan |
| 15:35–15:45 | Failures panel added for the "Find the Hidden Failures" award: server by the lead, view by Agent C |
| 15:53 | Submission answers filled in by the planning session |

## Problems we hit, and what we did

| Problem | What we did |
| --- | --- |
| Behind schedule at 14:17 (no app code yet) | Cut scope to four features, scaffolded in about 20 minutes, then ran four agents in parallel |
| `npm install` of the Nest CLI took 9 minutes | Wrote all source files while it installed |
| TypeScript 7 ships no compiler API, so the Nest CLI refused to build | Dropped the Nest CLI: plain `tsc -w` plus `node --watch` |
| The latest `@vitejs/plugin-react` needs Vite 8 | Pinned plugin-react 5 |
| One command read its own log file and grew it to 5 GB | Deleted the file and stopped reading logs with wildcards |
| The Brev tunnel dropped twice (14:55, 15:38) | Reopened it. The app falls back to plain labels, so nothing broke |
| The Anthropic key needed a workspace header | Added optional `ANTHROPIC_WORKSPACE_ID` support; the human then created a workspace-scoped key |
| Nemotron sometimes repeated its prompt when the file it read contained prompt text | Instructions only in the system message, content wrapped as data, outputs checked and retried, bad cached results purged (0 of 631 labels and 0 of 76 summaries bad afterwards) |
| A subagent's brief showed up as the human's words | Briefs are drawn as agent steps, not human prompts |
| The hosted demo would turn grey over time, since colors depend on "now" | The replay clock runs from the export time |
| The replay export picked up the user's email from a tool's output | Masked personal emails in the export and scanned for key values before every deploy |

## What was AI and what was human

All code was written by AI agents: Claude Code sessions and subagents for the app, landing page and docs, and Codex for the video. The human chose the idea and the stack, approved the plan and scope, created accounts and keys, made the decisions agents asked for (which sessions to publish, deploys, the public repo), and reviewed the results. Every model call inside the product is disclosed in [disclosures.md](disclosures.md) and [technical.md](technical.md).
