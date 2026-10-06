# Brainstorm → Rundown

The product was renamed Rundown on 6 October 2026. The rename goes in three tiers, so nothing breaks at once.
This file is the list of what still says "brainstorm" and when it changes. Cross items off as they go; when the
list is empty, delete this file. `git grep -i brainstorm` finds anything missed (history stays, see the end).

## Tier 1: what people see (done, 6 Oct 2026)

- [x] App: header logo, tab title and favicon, project picker, welcome card, banners, default theme name
- [x] Server text: shared replay title, Markdown export, Ask's name, startup and localhost messages
- [x] Plugin text: skill descriptions, launcher messages, the API key description
- [x] Landing page, deck, READMEs; the logo files in `brand/`
- [x] The repo folder: `~/brainstorm` → `~/rundown` (links left at `~/brainstorm` and `~/Documents/brainstorm`;
      the app finds the old threads through them, `listener/moved.ts`)

## Tier 2: the plugin's identity and internal names (with plugin 0.4.0, after analytics)

Breaks existing installs (only the author has one). Do it in one release, with a "reinstall as rundown" note.

- [ ] Plugin and marketplace id `brainstorm` → `rundown` (`plugin/.claude-plugin/plugin.json`,
      `.claude-plugin/marketplace.json`); commands become `/rundown:open`, `/rundown:share`, `/rundown:stop`;
      every mention of `/brainstorm:…` and `brainstorm@brainstorm` (plugin README, launcher, landing install section)
- [ ] Environment variables `BRAINSTORM_*` → `RUNDOWN_*` (server `main.ts`, `core/config.service.ts`, `core/local.ts`,
      `core/health.controller.ts`, `mapper/ignore.ts`, `mapper/watch.ts`, `replay/share.controller.ts`,
      `workspace/workspace.service.ts`, the launcher, tests, bench). Read the old name as a fallback for one release.
- [ ] Data: `brainstorm.db` → `rundown.db`, `~/.brainstorm` fallback dir → `~/.rundown`; copy the old ones on first run
- [ ] Hook header `x-brainstorm-hook` (server `attention.controller.ts`, plugin `signal.mjs`)
- [ ] Shared files: `<!--brainstorm:replay-->`, `#brainstorm-replay`, `brainstorm-<title>-<date>.html`
      (keep reading the old id so files shared before still open)
- [ ] Browser storage keys `brainstorm-*` (theme, editor, notify, last seen, welcomed, baseline, hidden agents, reads,
      map fold, git, window, camera lock, peek, sidebar tab and collapsed): read the old key once, write the new one
- [ ] Multiprise and dev hostnames (`web.brainstorm.localhost` in a comment in `core/local.ts`)

## Tier 3: names outside the repo (when the domain is secured)

- [ ] GitHub repo `Djbrl/brainstorm` (GitHub redirects old links; test the plugin install and update check)
- [ ] Vercel: `brainstorm-landing` and `brainstorm-next` (new domains; old links in the jury submission and waitlist
      emails keep pointing at the old ones, so keep them up or redirect)
- [ ] The update check URL in `plugin/scripts/launch.mjs`, links in the app (`App.tsx`), landing (`site/index.html`),
      READMEs and the Markdown export

## Stays "Brainstorm" (history)

The hackathon docs (`docs/submission-*`, `docs/how-we-built-it.md`, `docs/judging-audit.md`, `docs/project-card.md`),
`docs/build-log.md`, `video/`, the judged demo (`brainstorm-demo`, never redeployed without approval) and the
`hackathon-submission` tag.
