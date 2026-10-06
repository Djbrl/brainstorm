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

## Tier 2: the plugin's identity and internal names (done in plugin 0.5.0, 6 Oct 2026)

- [x] Plugin and marketplace id `rundown`; commands `/rundown:open`, `/rundown:share`, `/rundown:stop`; install lines in
      the READMEs, the launcher and the landing page. "Moving from Brainstorm" in `plugin/README.md`
- [x] Environment variables `RUNDOWN_*` (server `core/local.ts` `env()`, the launcher, tests)
- [x] Data: `rundown.db` (an old `brainstorm.db` is renamed on start); the launcher takes over the old plugin's data folder
      once and stops its server; `~/.rundown` fallback dir
- [x] Hook header `x-rundown-hook`
- [x] Shared files: `<!--rundown:replay-->`, `#rundown-replay`, `rundown-<title>-<date>.html`
- [x] Browser storage keys `rundown-*` (copied from `brainstorm-*` once, `lib/storage-migrate.ts`)

Kept for one release, remove in 0.6: the `BRAINSTORM_*` fallback in `env()`, the `x-brainstorm-hook` header, the old
share marker and id, `brainstorm.db` renaming, `adoptOldData()` in the launcher, `lib/storage-migrate.ts`.

## Tier 3: names outside the repo (when the domain is secured)

- [ ] GitHub repo `Djbrl/brainstorm` (GitHub redirects old links; test the plugin install and update check)
- [ ] Vercel: `brainstorm-landing` and `brainstorm-next` (new domains; old links in the jury submission and waitlist
      emails keep pointing at the old ones, so keep them up or redirect)
- [ ] The usage stats endpoint (`ENDPOINT` in `app/server/src/usage/usage.service.ts`, on the landing project): move it
      with the domain, and keep the old one answering until no release points at it
- [ ] The update check URL in `plugin/scripts/launch.mjs`, links in the app (`App.tsx`), landing (`site/index.html`),
      READMEs and the Markdown export

## Stays "Brainstorm" (history)

The hackathon docs (`docs/submission-*`, `docs/how-we-built-it.md`, `docs/judging-audit.md`, `docs/project-card.md`),
`docs/build-log.md`, `video/`, the judged demo (`brainstorm-demo`, never redeployed without approval) and the
`hackathon-submission` tag.
