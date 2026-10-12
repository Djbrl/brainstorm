# Cleanup handoff (12 Oct 2026)

All six phases of the audit's plan are done on `cleanup/phase-2` (181 commits on `main` 56eb7a5, which it fast-forwards). Each phase was reviewed and its findings fixed. Nothing is pushed or merged.

- **Every change, with its why and what you might notice:** `docs/cleanup-changes.md`.
- **The audit and the to-do list:** the Claude Doc "Rundown code audit", https://claude.ai/code/artifact/767fb401-b9b7-4bfb-936c-03fc5129868a (Phases 2 to 4 ticked).
- **Full reports and probes:** branch `claude/review` (keep it local: it documents the holes and the computer name).
- **Fixer brief:** `docs/cleanup-fix-brief.md`. **Release checklist:** `docs/release.md`.

Checks at the end: server 314/314 tests, web 42/42 (vitest), both typechecks clean, `build-plugin.mjs --check` builds and reports `plugin/build` as out of date (expected until the release rebuild).

## Merge and release (maintainer)

1. `git -C ~/rundown merge --ff-only cleanup/phase-2`
2. `npm install` in `app/server` and `app/web` (the web tests add vitest), then follow `docs/release.md`: bump the version, rebuild `plugin/build`, `--check`, tag.
3. Before tagging, with the new build installed, run `/rundown:open`, `/rundown:share` and `/rundown:stop` once: their `allowed-tools` were narrowed to the launcher and never tested live. If one stops loading, revert `d8e70b6`.
4. Site deploy steps (email settings, the one-time usage index, the old waitlist): see the Phase 3 site section of `docs/cleanup-changes.md`.

## Left open

See each phase's "Left open" in `docs/cleanup-changes.md`. The main ones: the server doesn't check the hook's signature; release tags; the reader rework; the hosted-demo code (kept by decision); four audit findings in the listener and attention (listed under Phase 6); the graph library's own animation loop at rest (a later useCanvasZoom branch).

Worktrees `.claude/worktrees/{phase-1,phase-2,p2-*,p3-*,p4-*,p5-*,p6-*}` can be removed after the merge (`phase-2`'s `app/web/node_modules` link points into `p6-web`).
