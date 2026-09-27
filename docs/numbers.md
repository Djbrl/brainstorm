# Measured numbers

Only real measurements. Leave `TODO` rather than guess.

| Measure | Value | How measured |
| --- | --- | --- |
| Files summarized per minute (Nemotron on Brev) | 180–215 files/min (6 requests in flight) | reader timing on the Brainstorm repo itself, 15:00 |
| Time to map the demo repo (68 files) | 40–72 ms structure; all 66 file summaries in about 20 s | mapper log + reader timing, 15:00 |
| GPU cost of that read | TODO | minutes × $/hour |
| Average cost per question (Claude) | $0.030 (file question $0.035, 3,622 in / 675 out; step question $0.025, 2,905 in / 418 out) | cost meter, claude-opus-5 at $5/$25 per M tokens, 2 questions at 15:04 |
| Step label latency | TODO | step arrival → label arrival |
| Summary quality vs Claude (1–5) | TODO | Claude grades 10 Nemotron summaries |
| Hallway test | TODO | 3 questions, raw log vs Brainstorm, timed |
| Failures found in Brainstorm's own build | 22 failing tool calls in 13 groups across 5 sessions; top group (4–8 retried shell failures) named by Nemotron | /api/failures at 15:40 |
| Brainstorm's own build | TODO sessions, TODO steps, TODO files | from its own db |
