# Cleanup handoff (11 Oct 2026)

A code audit of Rundown, then a phased cleanup. This file is for the next session: where things stand and what to do next. Local branches only; nothing here is pushed or merged to `main`.

## Where to read first

- **The audit and the to-do list:** the Claude Doc "Rundown code audit", https://claude.ai/code/artifact/767fb401-b9b7-4bfb-936c-03fc5129868a. Main tab: findings, numbered 1 to 49 in "Fix before announcing". "To-do" tab: about 220 tasks by phase, ticked as they land (Phase 1 ticked; Phase 2 not yet).
- **Full reports and probe scripts:** branch `claude/review` (worktree `.claude/worktrees/review`): `docs/review/2026-10-11/` (first pass), `docs/review/2026-10-11-second-pass/` (second pass, with `probes/` that reproduce each finding). Keep this branch local: it documents unfixed holes and the computer name.
- **Brief given to every fixer agent:** `docs/cleanup-fix-brief.md` (this branch). Reuse it for new agents.

## Decisions the maintainer made

1. One project per server stays (option A). Make every switch safe: the page reloads when the server's project changes, "Needs you" survives switches and restarts, a restart keeps the saved project. No per-page redesign.
2. Nemotron removed. 3. Failures feature removed. 4. Git view ("git rings") removed. (All done on `cleanup/p2-rules`.)
5. Ask uses only the key the user enters in the plugin setting (empty by default = Ask off); never a shell `ANTHROPIC_API_KEY`.
6. Shared files carry no Ask answers at all. (Done.)
7. An older launcher never restarts a newer server.
8. A corrupt database is moved aside, never deleted.
9. Hosted-demo code (`lib/preview.ts`, `/api/replay` recording params): keep for now; later trim it into a demo-only build.
10. Windows: out of scope.

## Branches

| Branch | State |
| --- | --- |
| `cleanup/phase-1` | Done. 17 commits on `main` 56eb7a5, 184/184 tests, reviewed (four review findings fixed). Waiting for the maintainer to merge (`git merge --ff-only cleanup/phase-1`) and release. |
| `cleanup/phase-2` | Integration branch for Phases 2 and 3, on top of `cleanup/phase-1`. Has p2-privacy (8 commits) and p2-rules (6 commits) cherry-picked. 214/214 tests, both typechecks clean (after `rm -rf app/server/dist`). Not reviewed yet. |
| `cleanup/p2-privacy` | Merged into phase-2. Masking (45/45 secrets caught, 40/40 must-stay lines kept), masking at every boundary, shares without Ask answers, shots allowlist, `/api/open` realpath, data folder 0700/0600. |
| `cleanup/p2-rules` | Merged into phase-2. One "failed" rule (`shared/failed.ts`), Failures/Nemotron/git view removed, Places classification, command-edit attribution, Codex fixes. `app/server/package-lock.json` still lists `openai`: run `npm install` in `app/server`. Docs (`technical.md`, `run-locally.md`, `roadmap.md`) still mention Nemotron, Failures and git. |
| `cleanup/p2-listener` | NOT merged. 6 commits: per-thread step ids, Claude Code folder naming (200-char cut, siblings, NFC/NFD), titles masked, harness 'claude', future times, NULs, command edits kept on stop, history in time order, replaced logs re-read, page catch-up (`afterSeq`), replay cursor anchored to its step. The agent was stopped right after; its last commits are not verified (it suspected a stale `tsconfig.tsbuildinfo` skipping emit). Unknown whether `SESSION_FILTER` was deleted. |
| `cleanup/p2-launcher` | NOT merged. One WIP commit `ffc46c4`, 19 files, unfinished and untested: launcher (env allowlist, kill verification, version compare, lock, port, logging), project guards (attention, workspace, live.tsx, SetupView), shutdown, corrupt db, build-plugin temp folder and notices. |

Worktrees: `.claude/worktrees/{phase-1,phase-2,p2-privacy,p2-rules,p2-listener,p2-launcher}`, `node_modules` symlinked from the main checkout.

## Next steps, in order

1. **p2-listener:** in its worktree, `rm -rf app/server/dist app/server/tsconfig.tsbuildinfo`, typecheck both sides, `npm test`. Check its task list (in its agent prompt, reproduced in the To-do tab, Phase 2 "Data flow and identity") against the commits; finish what's missing (likely `SESSION_FILTER` deletion and its doc lines). Then cherry-pick onto `cleanup/phase-2`. Expect conflicts in `lib/live.tsx` (also edited by p2-privacy and p2-launcher), `listener.service.ts` (one line from p2-rules), `codex.source.ts`, `types.ts`.
2. **p2-launcher:** review the WIP diff against its task list (To-do tab, Phase 2 "The project model" and "Launcher" and "Build", plus "Map and server" items 404 assets, corrupt DB, shutdown hooks, don't map before a project is chosen). Finish, split into commits by task, test (launcher experiments only on ports 4991-4999 with a scratch copy of `plugin/`; never 4747/4748), cherry-pick onto phase-2. Conflicts likely in `live.tsx`, `attention.service.ts`, `db.service.ts` (p2-privacy set file modes there).
3. **Review pass** on `cleanup/phase-2` (one fresh reviewer agent on `git diff cleanup/phase-1...cleanup/phase-2`), fix what it finds, re-run its probes.
4. **Second wave**, then the rest of Phase 3 (all in the To-do tab):
   - Map and server: presence-timer cancel, ignore by `.gitignore` in git repos, import resolution (`.js`→`.ts`, tsconfig paths, Python), project folder deleted/renamed, async share map + delete the sync twin, `/api/history` and dead fields.
   - Web: visible Play at every width and in shared files, dark-theme failure contrast, Places error handling, `editorLink`, keyboard skip link, islands expiry, `%` links, delete the `"footprint"` mode, dead CSS.
   - Site: double opt-in for the waitlist, O(1) usage-forget, security headers.
   - Phase 3 cleanup: sunset shims (`BRAINSTORM_*`, `x-brainstorm-hook`, storage migration), `@nestjs/cli`, `noUnusedLocals`/`noUnusedParameters`, `// Owner:` lines (do last, by script, after all merges), docs rewrite (`technical.md`, `run-locally.md`).
5. Tick the To-do tab, add a build-log line, hand the maintainer the merge and release commands.

## Working rules that held up

- One worktree per agent from the integration branch; agents commit there; the integrator cherry-picks (drop anything that writes personal data, as with the `.mailmap` in Phase 1).
- At most four agents at once (the audit hit rate limits with 13). Opus for judgment-heavy work, Sonnet for well-specified work.
- Verify browser-visible changes in the running app on a scratch port with scratch data (`scratchpad/work/runtime/` had the harness: `start.sh`, `page.mjs`, `verify-thinking.mjs`; copies in `claude/review` probes).
- One reviewer per phase on the whole diff; it found four real defects in Phase 1.
- Pushes, merges to `main`, plugin version bumps and rebuilds are the maintainer's.

## Maintainer's own to-dos (outside the code)

Merge Phase 1 and release; delete remote branches `feature/map-labels`, `feature/tasks`, `post-deadline`; Vercel Firewall rate limits on `/api/*`; run `site/tools/delete-old-usage.mjs` and note the date; GitHub description and homepage; a new README screenshot; delete the stray `hello-world.md`; confirm the facts listed in the To-do tab's first section.
