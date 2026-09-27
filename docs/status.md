# Live status (updated by the human's planning session)

Newest first.

- 15:40 Submission form partly filled in the app's browser pane (not submitted). Backup of every answer: `submission-answers.md`. Lead agent building the Failures panel for SupplyzPro (ETA 16:10). Judging audit: `judging-audit.md`.

- 14:58 Coding agents are now committing on branch `claude/other-agents-progress-b2e6fe` (B: mapper, Nemotron client, reader labels, summaries and risk flags; D: Ask with Claude). A test merge of that branch and the landing page branch into main shows **no conflicts**. Plan: merge both into main at 15:40.
- 14:58 Waiting on the Anthropic API key. When it's in, run the summary quality check (Claude grades 10 Nemotron summaries).

- 14:50 Nemotron stress test done: 81k lines of Hono in 73 s for $0.02, labels in 0.14 s. See `numbers.md`.

- 14:45 Measuring Nemotron on the GPU: summarizing every file of a real open-source TypeScript project. Results go in `numbers.md`.
- 14:41 Coding agents work in `.claude/worktrees/other-agents-progress-b2e6fe` (NestJS server + React web), **nothing committed yet**. `docs/nemotron.md` and `app/.env` are present there.
- 14:41 Anthropic API key still a placeholder; the human is getting one.
- 14:20 Nemotron live at localhost:8000 (see `brev-setup.md`).

## Open risks

| Risk | Action |
| --- | --- |
| App code uncommitted in a worktree | Agents commit on their branch now; merge into main before 15:40 |
| No Claude key yet | Paste into both `app/.env` files, or Ask falls back to Nemotron |
| Landing page session (`site/`) in another worktree | Bonus only; merge at the end if it's ready |
