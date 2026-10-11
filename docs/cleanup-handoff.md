# Cleanup handoff (11 Oct 2026, evening)

Phases 1, 2 and 3 of the audit's plan are done on local branches. Nothing is pushed or merged to `main`.

- **The audit and the to-do list:** the Claude Doc "Rundown code audit", https://claude.ai/code/artifact/767fb401-b9b7-4bfb-936c-03fc5129868a.
- **Full reports and probes:** branch `claude/review` (keep it local: it documents the holes and the computer name).
- **Fixer brief:** `docs/cleanup-fix-brief.md`.

## Branches

| Branch | State |
| --- | --- |
| `cleanup/phase-1` | Done, reviewed. 17 commits on `main` 56eb7a5. |
| `cleanup/phase-2` | Phases 2 and 3, on top of `cleanup/phase-1`: 64 commits, 236/236 tests, both typechecks clean. Phases 2 and 3 reviewed; every finding fixed (Phase 3: tsconfig lookup bounded to the project, exact aliases, a 10 s limit on git's ignored-folder listing, a returning folder's spelling saved). The To-do tab is ticked for both phases. |
| `cleanup/p2-*`, `cleanup/p3-*` | All merged into `cleanup/phase-2`; their worktrees can be removed. |

## Before release (maintainer)

1. Run `/rundown:open`, `/rundown:share` and `/rundown:stop` once in a logged-in session with the new build: their `allowed-tools` is now `Bash(node *${CLAUDE_PLUGIN_ROOT}/scripts/launch.mjs*)`, not tested live. If any stops loading, revert `d8e70b6`.
2. Look once at a project folder renamed while Rundown runs (the picker should say which folder went missing), and at a link that opens straight onto a thread (the re-framing timers were removed).
3. The privacy page's date is 11 October (the site branch changed it).
4. Behaviour changes users may notice: in git repos committed `.github`, `vendor`, `build`, `.idea` folders now show on the map; 0.4-era hooks (`x-brainstorm-hook`, `BRAINSTORM_*` env) are refused; pages use `127.0.0.1` instead of `localhost`.

## Site deploy (maintainer, in order)

1. Vercel env: `RESEND_API_KEY`, `RESEND_FROM` (verified Resend domain). `UNSUBSCRIBE_SECRET` now also signs confirm links: never change it. Optional `SITE_URL`.
2. Deploy, then `node --env-file=tools/.env.local tools/index-usage.mjs` (dry run), then with `--yes`.
3. Old waitlist entries count as unconfirmed. `tools/migrate-waitlist.mjs` counts them; `--keep` makes them confirmed (only if their original consent counts).
4. Optional: Vercel Firewall rate limit on `/api/waitlist` and `/api/*`.

## Left for later

- Hooks: the server doesn't yet check an HMAC proof from the hook (the hook checks the server). Release tags. The reader rework (risk in the listener's sink).
- `ListenerService.updateStep` and the `step-update` message are never sent; delete or use.
- `app/README.md` (the hackathon brief) still mentions Nemotron and `brainstorm.db`.
- Audit items not done: peek and diff line-number colours, the nav trailing-slash case.
- `test/regex-timing.test.cjs` is timing-based and flaked once.
- Phase 4 (one copy of each rule, shared contract) in the To-do tab.
