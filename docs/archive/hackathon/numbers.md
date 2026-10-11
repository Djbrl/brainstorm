# Measured numbers

Only real measurements. Leave `TODO` rather than guess.

## Nemotron on Brev: stress test (14:48)

We summarized every source file of [Hono](https://github.com/honojs/hono) (`src/`, commit 52f6c7e), a popular TypeScript web framework. Nemotron 3 Nano on one L40S via vLLM, 16 requests in parallel, reasoning off, 2-sentence summaries. The script ran on the GPU machine.

| Measure | Value |
| --- | --- |
| Files summarized | 311 of 311 (0 errors) |
| Lines of code | 80,983 |
| Tokens read | 646,453 in, 20,460 out |
| Time | 73 seconds |
| Speed | 255 files per minute, about 8,800 tokens per second read |
| GPU cost of the whole read | **$0.02** (73 s at $1.06/hour) |
| Step label latency | 0.14 s median, 0.61 s worst (20 sequential labels) |

**For comparison (list prices, not measured):** reading the same 646k tokens with Claude Haiku 4.5 ($1 in / $5 out per million tokens) would cost about $0.75. Nemotron on our own GPU was about 35× cheaper for this bulk job, while the GPU was already on.

**Sample output** (`hono-base.ts`): "This file defines the base Hono framework class (`HonoBase`) that provides the core structure for building HTTP applications. It sets up routing methods (`get`, `post`, etc.), middleware handling, error handling, and foundational utilities for path management."

**Seen in samples:** test files are sometimes described as the code they test. The fix is a prompt tweak: tell the model when a path contains `.test.`.

## Inside the app (15:00–15:15, on the Brainstorm repo itself)

| Measure | Value | How |
| --- | --- | --- |
| Files summarized per minute (Nemotron on Brev) | 180–215 files/min, 6 requests in flight | reader timing |
| Time to map the repo (69 files, 7 modules) | 40–72 ms for structure and imports | mapper log |
| Average cost per question (Ask, Claude) | **$0.031** over 6 questions (range $0.025–$0.037, about 3,200 tokens in / 600 out) | cost meter, claude-opus-5 at $5 / $25 per million tokens |
| Failures found in Brainstorm's own build | 22 failing tool calls in 13 groups across 5 sessions; the top group (retried shell failures) named by Nemotron | /api/failures at 15:40 |
| Brainstorm's own build | 4 sessions, 1515 steps, 69 edits, followed live | from its own db, 15:15 |

## Still to measure

| Measure | Value | How |
| --- | --- | --- |
| Summary quality vs Claude (1–5) | TODO | Claude grades 10 Nemotron summaries |
| Hallway test | TODO | 3 questions, raw log vs Brainstorm, timed |
