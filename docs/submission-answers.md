# Submission form answers (backup: paste from here if the form loses them)

Form: https://docs.google.com/forms/d/e/1FAIpQLSebmyKeBPv2mrmy4T_wI2_z9SBjjSTZ-O-_ewiWs6PBEikRjw/viewform
Deadline: 17:30 Tunis = **16:30 Dakar**. `[FILL]` = needs the human.

**Country:** Senegal
**Hackerspace / ONLINE:** [FILL: Point E Hackerspace or ONLINE]
**Team name:** [FILL: same as confirmed roster]
**Team leader full name:** [FILL]
**Team leader email:** sydjbrl@gmail.com [check it matches the roster]
**Project title:** Brainstorm
**Team members:** [FILL: one per line]

## Project summary (max 150 words)

AI coding agents now write code faster than we can understand it. Studies show developers lose track without noticing, while those who ask questions keep their understanding. Brainstorm is a live map of your code and of the AI agents writing it. It runs locally next to Claude Code and reads each session's log as it's written: every agent step appears in a live timeline with a short AI label, and every edit can be opened and questioned ("why did you change this?"). Zoom out and the whole codebase becomes a map of modules and imports that glows where agents recently worked and pulses where they are editing now. A Failures view groups recurring tool-call errors and ranks them with evidence. Bulk reading (file summaries, step labels, risk flags) runs on NVIDIA Nemotron 3 Nano on our own Brev GPU. Questions are answered by Claude from a small, grounded context.

## Problem solved

Developers increasingly let AI agents write most of their code, often several agents at once. The work arrives as a long chat log and a wall of diffs ("Done! Updated 47 files"), so people click "Accept all" and lose understanding of their own codebase: comprehension debt. Research backs this up. METR (2025) found experienced developers were 19% slower with AI tools but believed they were 20% faster. Anthropic (2026) found developers learning with AI scored 50% vs 67% on comprehension, except those who used AI to ask questions. Students, anyone building with AI, and tech leads reviewing AI work all need a way to see and question what agents did, without reading every line.

## Solution and key features

(1) Works now, on real data:
- Live Follow timeline of every Claude Code session on the machine, including subagents; each step gets a short Nemotron label within about 0.2 s; click an edit to see its diff.
- Ask: question any step or file; Claude answers from a small grounded package (the step, its diff, the steps before it, file and module summaries). Secrets are masked first. Cached, with cost shown (about $0.03 per question); falls back to Nemotron.
- Map: modules and import links of the project; nodes colored by edit recency and pulsing where an agent is working; click a file for its Nemotron summary and recent steps.
- Failures: recurring tool-call errors grouped and ranked with evidence steps [verify it shipped].
- Replay export: a recorded session with its map and answers, viewable in a static build.

(2) Not built or simulated: pause and steer, Codex sessions, keyboard shortcut and Markdown export are not built. [If the video still shows illustrative UI, say so here.]

(3) Built today: all product code (NestJS server, React web, listener, mapper, reader, Ask, replay), the landing page and the video, written by parallel Claude Code agents directed by the team. Reused: open-source libraries only (NestJS, React, Vite, react-force-graph, Remotion) and the open Nemotron model. See `docs/build-log.md` for the timeline.

## Technologies used

TypeScript; NestJS 11 server (node:sqlite, chokidar, WebSocket); React 19 + Vite web; react-force-graph; NVIDIA Nemotron 3 Nano 30B-A3B (FP8) served by vLLM 0.30 on an NVIDIA Brev L40S GPU; Claude API (claude-opus-5) through the Anthropic SDK; Claude Code (multi-agent build); Remotion (video); Vercel (landing page and hosted replay).

**Source code URL:** [FILL: public GitHub repo]
**Presentation URL:** https://brainstorm-landing.vercel.app
**90-second demo video URL:** [FILL: unlisted YouTube / Drive / Loom]

## Project next step

Support Codex and other agents next to Claude Code; ship pause and steer through Claude Code hooks; package it as a desktop app with a global shortcut; add a private mode where answers also run on your own GPU; pilot it with GOMYCODE students to measure whether asking-while-building improves their comprehension.

## Partner awards to tick

Thunders, Guepard, SupplyzPro, EY Studio+, CompTIA, Brightest, Artefact.

**Primary prize application:** Thunders — Engineering Excellence Award

## Award application (fit and eligibility)

**Thunders (Engineering Excellence):** Brainstorm is a working, tested prototype, not a mockup. It streams real Claude Code sessions, maps a real repo, and answers questions with measured cost and latency. Evidence: 311 files (81k lines) summarized in 73 s with 0 errors; labels in 0.14 s median; retries and Nemotron fallback when Claude or the GPU tunnel fails; content-hash caching (`docs/numbers.md`, `docs/brev-setup.md`). Senegal, open to all countries.

**Guepard (AI Automation):** Brainstorm automates the review work that follows every agent run: labeling each step, summarizing every file, flagging risky edits and grouping failures. The productivity gain is understanding what several agents did in minutes instead of reading dozens of diffs. See the Follow and Map views in the video and `app/server/src/reader/`. Open to all countries.

**SupplyzPro (Find the Hidden Failures):** Brainstorm reads every AI-agent conversation and tool call as it happens. Its Failures view detects failed tool calls, groups them by tool and normalized error, and ranks the groups by frequency, recency and retries, each with its evidence steps and a Nemotron one-line title. Demonstrated on Brainstorm's own multi-agent build logs (`app/server/src/failures/`, video). [Verify it shipped.] Senegal; no country restriction stated.

**EY Studio+ (Human-Centred Innovation):** A clear problem backed by research (comprehension debt), a user who feels it daily (anyone coding with AI agents), and an experience built around seeing rather than reading. Route to adoption: it sits beside the tools developers already use, needs no workflow change, and is local-first. See `docs/plan.md` and the video. Open to all countries.

**CompTIA (Skills & Technical Readiness):** Solid technical foundations: typed contract shared by server and web, a self-hosted open model on a GPU, secret masking and fallbacks. The project itself is a skills tool: it helps developers keep learning while AI writes code, based on Anthropic's 2026 finding that asking questions protects comprehension. Open to all countries.

**Brightest (Skills & Employability):** Developers and students who rely on AI agents risk losing job-relevant skills such as reading and debugging code. Brainstorm keeps them engaged by making agent work visible and questionable, the pattern linked to higher comprehension in Anthropic's study. Open to all countries.

**Artefact (Data & AI):** Brainstorm turns raw agent log data (thousands of steps) into insights you can act on: what changed where, which failures recur, what to review first, with measured cost (about $0.02 to read 81k lines, about $0.03 per question). Open to all participating countries.

## AI/tool disclosure

**AI inside the product:**
- **NVIDIA Nemotron 3 Nano 30B-A3B FP8** (open model), served by vLLM 0.30 on our own NVIDIA Brev L40S GPU ($1.06/hour, own account; the voucher was not received because we arrived late), reached through an encrypted `brev port-forward` tunnel. Used for bulk work where a flat hourly cost beats per-token pricing: file and module summaries, a label for every agent step, risk flags and failure-group titles, and as the fallback for Ask. Example: input is the file `hono-base.ts`; Nemotron summarizes it; output: "This file defines the base Hono framework class (`HonoBase`) that provides the core structure for building HTTP applications…" Stress test: 311 files in 73 s for $0.02.
- **Claude API (claude-opus-5)** answers questions about a step or file from a small grounded context (secrets masked). Example: "Why did the agent change reader.service.ts?" returns an answer citing the step and diff; cost about $0.03 per question.
- No simulated AI output in the product.

**AI used to build it:** Claude Code (several parallel agents, directed and reviewed by the team: stack choice, contract, live testing on real sessions; we caught and fixed Nemotron echoing its prompt), Codex (video drafts), Claude chat (planning, research lookup; every study checked against its source). Video built with Remotion; fonts Cabinet Grotesk and Satoshi (Fontshare).

**Data:** No datasets. The demo runs on our own Claude Code sessions and code. Benchmark on the open-source Hono repo (MIT license). Research cited: METR 2025, Anthropic 2026, MIT Media Lab 2025.

**Fallbacks:** Claude fails → Nemotron answers (labeled). Nemotron or the tunnel down → raw steps shown, summaries retried. Both down → timeline and map still work, since they need no AI.

## Project cover / screenshot URL (optional)

[FILL: e.g. https://brainstorm-landing.vercel.app/img/map.png once real screenshots are deployed]

## Live demo URL (optional)

[FILL: hosted replay URL]

## Testing, results and known limitations (optional)

- Stress test: summarize all 311 source files of Hono (81k lines) → 311/311 in 73 s, $0.02 of GPU time, 0 errors (`docs/numbers.md`, `docs/bench/`). Limitation: each file capped at 60,000 characters.
- Live use on our own build: 4 Claude Code sessions, 1,515 steps, 69 edits followed live; labels in 0.14 s median; Ask about $0.031 per question over 6 questions (`docs/numbers.md`).
- Failure seen: Nemotron sometimes echoed its prompt instructions instead of answering; fixed with output cleanup and prompt changes (0 of 631 labels bad afterwards). The GPU tunnel dropped once; summaries retry automatically. Summary quality vs Claude not formally measured.

## Responsible AI and data (optional)

All data is the user's own local Claude Code logs and code; Brainstorm stores everything on the user's machine and has no server of its own. Secrets (API keys, tokens, passwords) are masked before anything is stored or sent, and Ask sends only a small context package to the model provider the user already uses, while bulk reading stays on a GPU we control. AI summaries and labels can be wrong, so every one links back to the exact source step and diff, and a human stays in control. Open questions: summaries are not yet evaluated for accuracy at scale, and Brainstorm reads every session on the machine, so a future version should let users exclude projects.
