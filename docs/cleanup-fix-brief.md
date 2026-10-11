# Rundown cleanup, Phases 2 and 3: shared brief for fixers

You are fixing findings from a completed audit of the Rundown repo. The findings are verified; you don't need to re-audit. Read /Users/dsy/rundown/CLAUDE.md first (house rules, style for commits and user-facing words).

## Where you work

- ONLY in your own worktree (path in your task). It is on its own branch `cleanup/<slug>`, created from `cleanup/phase-1` at 81e4d6f (Phase 1 of this cleanup: git safety, busy timeout, bounded mapper reads, linear regexes, docs; not yet merged to main). `node_modules` are symlinked in for you where needed.
- Never edit the main checkout /Users/dsy/rundown or any other worktree. Never push. Never rebuild `plugin/build` (that is part of the human's release step). Never touch app/server/data or ~/.claude/plugins/data.
- Other sessions run servers on 4000, 4747/4748, 5173: leave them alone. If you need to run a server, use the ports in your task and a scratch RUNDOWN_DATA_DIR under /private/tmp/claude-501/-Users-dsy-rundown/af77b7dc-9def-4749-a488-236dbe6a0334/scratchpad/work/fix-<slug>/, and stop it before you finish.
- The shell is fish: wrap `$()`, globs and `&&` chains in `bash -c '...'`.

## Evidence you can reuse

- Audit reports (each finding has file:line, evidence and a proposed fix): /Users/dsy/rundown/.claude/worktrees/review/docs/review/2026-10-11-second-pass/*.md and first pass in .../docs/review/2026-10-11/*.md.
- Probe scripts that reproduced each bug: /Users/dsy/rundown/.claude/worktrees/review/docs/review/2026-10-11-second-pass/probes/<auditor>/... Use them to confirm the bug before and gone after. Line numbers in the reports refer to commit 6f216c6; main has moved two commits since, so re-find the code before editing.
- Read only what your tasks need. Do not re-explore the codebase.

## How to work

- Fix the root cause with the smallest change that fully fixes it. No unrelated refactors, renames or reformatting (later phases do those). Keep the existing code style (double quotes, semicolons, 2 spaces).
- Add a test for each fix where the suite can hold one: server tests are `node:test`, either `app/server/src/**/*.test.ts` (compiled) or `app/server/test/*.test.cjs` (requires dist). Follow the neighbouring style.
- Before each commit: `cd app/server && npx tsc -p . --noEmit` (and `cd app/web && npx tsc -b --noEmit` if you touched the web), and `cd app/server && npm test` when you touched the server. The suite is fully green at the base (184 tests); report any failure.
- Commit in small commits on your branch, message prefixed with your area in brackets (e.g. `[git-safety] ...`), plain language saying what changed and why, ending with the line:
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Never commit .env, node_modules, dist, data, tsconfig.tsbuildinfo.
- If a task turns out wrong, unsafe or much bigger than described, skip it and say why. Don't guess.

## Your final reply (keep it short)

- Commits made (hash and one line each).
- Per task: done / skipped (why) / partly (what is left).
- Test and typecheck results (counts).
- Anything the integrator must know (files touched outside your list, behaviour changes, follow-ups).

## Working assumptions for these phases (the audit's recommendations; the maintainer may still reverse any of them, so keep each one in its own commit)

- One project per server stays for now; fixes add guards (the page reloads when the server's project changes, hook knowledge survives switches and restarts, a restart keeps the saved project). No per-page redesign.
- Nemotron is removed. The Failures module is cut to the pure helpers the Markdown export needs.
- The hidden git view ("git rings") is removed from the web; the server's git refresh goes if nothing else needs it.
- A shell ANTHROPIC_API_KEY is not passed to the server; an older launcher never restarts a newer server; shares carry only the thread's own Ask answers; a corrupt database is moved aside, never deleted.
- Not touched in these phases: the hosted-demo code (lib/preview.ts, /api/replay recording params), Windows support, the shell parser's script scanner redesign, renames, big file splits.
- Several fixers work at the same time on disjoint files. Stay inside your file list; if you must touch another file, keep the change minimal and say so in your reply.
