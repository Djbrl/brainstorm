# Cleanup change record

This file lists every fix of the code cleanup, so you can question each decision later. Later phases append here, below the last one.

How to use it: find the behaviour you are curious about, read why it changed, then look up the commit (`git show <hash>`). Each entry says what changed, why (the audit finding number from the "Fix before announcing" table, or the maintainer's decision), what a person using the app might notice, and the commit hashes. "Nothing" means no visible change.

Decisions the maintainer made along the way, which explain several entries:

- Update notifications are their own setting, separate from usage stats, on by default, and not tied to DO_NOT_TRACK.
- Sharing never falls back to another thread.
- The old Brainstorm data folder is deleted once everything has been copied.
- Skills may only run the launcher. This is not tested live yet: verify before release.
- A server started by a skill is marked, and restarted with the Ask key at the next session.
- The phone layout starts at 440 px instead of 600 px; from there to 1100 px the sidebar folds into a strip on the left.
- One project per server stays (not one per page).
- Nemotron, Failures and the git view are removed.
- The hosted-demo code is kept for now.
- Windows is out of scope.
- Merge only after all phases are done.

Review passes: Phase 1's review fixed four findings. Phase 2's review fixed three plausible ones (the database handle closed before the move-aside, the moved copy and notices.json set to owner-only, renumbered steps refetched) plus the Ask-key marker. Phase 3's review fixed four (tsconfig lookup bounded to the project and 1 MB, exact aliases, a 10 s limit on git's ignored-folder listing, a returning folder's spelling saved). Phase 4's review found nothing blocking: it ran the database upgrade on a database made by the previous code (nothing lost, failed results flagged, each step rolled back on error), and checked that every write route is still guarded. One fix: a server answer with no body (opening a file, showing it in Finder, a usage event) no longer counts as a failure (`16e54db`). Its other two notes needed no change: after a downgrade to 0.8.x and back, failed results still show as failed because every reader also checks the older flag stored with the step; and Esc's order is unchanged in practice.

## Phase 1: stop the bleeding

Branch `cleanup/phase-1`, 17 commits on top of `main`. These make the server hard to freeze or crash and fix what a visitor reads first.

### What you might notice

- A long or odd file, e-mail address or line of text no longer freezes the server.
- A busy or full database no longer takes the server down.
- An over-long e-mail address in a shared replay is hidden whole.
- The map settles and stops redrawing after an agent stops.
- A project folder that links to a folder outside itself shows nothing from that link.
- The README, plugin README, landing page and docs say the current things (version, Node 22.13, data folder).

### Safety against copied repos and odd files

- **A copied repo can't make the server run a program through git.** Git settings inside a repo someone else made could name helper programs; the server's git calls now ignore them. If the repo's settings can't be read, git is not used at all. Git-lfs and git-crypt keep working when set up the normal way. A branch switch is still noticed. Finding 1. Nothing visible. Commits `be33935`, `653dda3`, `b383a16`.
- **A link to a folder outside the project maps nothing from it.** A shortcut inside the project pointing elsewhere used to pull outside files onto the map. Finding 3. A file may disappear from the map if it was only reachable that way. Commit `d022c45`.
- **A listed file is checked before reading and never read whole.** The mapper looks at the file kind and size first, skips anything that isn't a normal file or is too large, and reads in pieces. Finding 3. Huge files no longer slow the map. Commit `79e98b7`.

### Things that froze the server

- **Import lines are read in a straight pass.** A file full of export lines could freeze the server for a long time. Finding 4. Commit `621833a`.
- **Secret and long-text masking is linear.** The rules for `sk-` keys, long texts without a break, e-mail names, brace lists and patch headers no longer slow down on long input. Timing tests added. Finding 4. Commit `28da1f4`.
- **A very long e-mail address is masked whole in shares**, and a stale link to the archived numbers is fixed. Finding 4. Commit `2122942`.

### The database

- **A busy or full database no longer stops the server or drops steps.** It waits a few seconds when busy, timers that write to it log a problem instead of crashing, a crash is written to the log, and a failed chunk is retried soon rather than when the log next grows. Finding 2. Nothing visible, except fewer lost steps. Commit `e86fc44`.

### The map

- **The map rests again after an agent stops.** Marker colour eases in fractions (so it truly ends), and thinking frames are requested only when the ring is drawn. Finding 6. Less fan noise and battery use. Commit `3d25428`.

### Docs, licence and site

- **The first things a visitor reads were wrong.** The README lost the Nemotron fallback, "Codex is next" and post-deadline claims and the old screenshot; Node 22.13 or later; `.env.example` has only optional commented settings. Findings 44-46. Commits `1db4d5f`, `5a739a9`.
- **Hackathon papers archived** in `docs/archive/hackathon` with a short README; the organiser's form link and the sponsor-prize pitches dropped; links fixed. Finding 45. Commit `047e6fc`.
- **Plugin README and the contributor guide for `app/`** say the current version, the honest "local server" wording (other programs on your computer could still reach it), the `~/.rundown` folder and the `rundown@brainstorm` commands. Findings 40, 44, 46. Commit `5a739a9`.
- **Licence holder's full name, "source-available" wording, and ignore rules for local and secret files.** Finding 48. Commit `73c624d`.
- **Landing page: current version strings, no Vercel team name in its README, the unused deck and five unused images removed.** Findings 44, 45. Commit `6247264`.
- **The landing page's usage and waitlist endpoints refuse posts from other sites** and non-JSON bodies. Finding 42. Commit `2c30799`.
- Build log for the phase: `81e4d6f`.

### Left open (Phase 1)

- Deleting the old remote branches, setting the GitHub description and homepage: the maintainer's pushes. Finding 49.
- The `.mailmap` line was dropped: the file itself would have to contain the address.
- Vercel Firewall rate limits: set in Vercel by the maintainer.

## Phase 2: privacy and the must-fix bugs

Branch `cleanup/phase-2`. Privacy first, then the project model, data flow, launcher, "meaning from text", Codex and the web.

### What you might notice

- Shared files hide more (permission prompts, other projects' titles, the git user name, keys) and show less (no Ask answers).
- The data folder is private to your account.
- Opening a file from the app opens the real file; `.env`-style names and README-like names open.
- Screenshots: only png, jpeg, gif and webp are kept.
- Switching projects reloads the page cleanly; a restart keeps your saved project; a renamed or deleted project folder shows the picker with a sentence saying which folder went missing.
- "Needs you" survives a restart.
- Threads from sibling folders no longer appear; resumed or forked threads keep their own steps.
- Play and Pause exist at every width; the failure words and grey text are readable in all four themes; the Track has a "Skip past the steps" link.
- The map follows `.gitignore` in git repos, so committed `.github`, `vendor`, `build` and `.idea` folders now show.
- More import lines (TypeScript aliases, Python packages) show on the map.
- A new setting, Updates, controls the new-version message.
- Old hooks (0.4-era) are refused and pages use `127.0.0.1` rather than `localhost`.
- A damaged database is moved aside with a date and a fresh one starts with a notice.

### Secrets and sharing

- **Masking rewritten against realistic cases.** The secret word must end the key name, quoted values are checked as well as plain ones, and the missing secret shapes were added. Finding 33. Fewer false hits, fewer leaks. Commit `32be92c`.
- **Thread titles, permission prompts and other projects' titles are masked before they reach the page.** Finding 32. Commit `2261c8a` (prompts and elsewhere), titles in `508e050`.
- **Shares mask names only by exact case and only when distinctive, mask the git user name and keys.** Finding 32/33. A common word is no longer blotted out. Commit `d497171`.
- **The shared file's name is built from the masked shared title.** Finding 32. Commit `5129554`.
- **Shared files carry no Ask answers**; a recording answers the exact question only. Finding 38. Maintainer: ask answers are not shared. Commit `bded656`.
- **The share page's title is inserted safely**, so a thread title with `$&` can't splice the template. Finding 27. Commit `c645f92`.
- **`/rundown:share` never falls back to another thread.** With no or unfilled session id it says so and points to Share in the app; a thread not read yet is waited for up to 8 s, then reported. Finding 38. Maintainer decision. Commit `0a9944e`.
- **Share, export and the hosted-demo replay build the map without blocking**; the synchronous twin (getMap, buildSync and six listing/reading functions) is deleted. Commit `b5ff5b7`.
- **Licence notices inside share.html** and a LICENSE in the plugin. Finding 48. Commit `fc3e919`.

### Files, screenshots, opening

- **The data folder is 0700 and the database files 0600.** Finding 35. Commit `480ae1e`. Review follow-up: the moved-aside copy and notices.json are owner-only too (`1b098a1`).
- **Open checks and opens the real file, not the link**; dotfiles and README-like names open. Finding 36. Commit `26de4b5`.
- **Screenshots**: only png, jpeg, gif and webp are kept and served as inert images. Finding 39. Commit `e73c4cb`.
- **Editor links encode each path segment**, so `#` or `?` in a file name opens the right file. Commit `d9d05ec`.

### Project model and data flow

- **Nothing is mapped or watched before a project is chosen** (the plugin starts on a placeholder that doesn't exist). Finding 34. Commit `dc07bf2`.
- **A restart keeps the saved project**; the starting session's project counts only when none was ever chosen. Finding 9. Commit `8c74fa4`.
- **The page reloads when the server's project differs**, stale `loadAll` answers are dropped, the picker stays mounted through its checklist, and a reconnect to another server version reloads. Findings 7, 25. Maintainer: one project per server. Commits `52a6046`, `6364b36` (lockfile).
- **Hook knowledge survives a project switch**, and the last hook per thread is stored so "Needs you" survives a restart unless the log moved on. Finding 8. Commit `f2130aa`.
- **A renamed, moved or deleted project folder is noticed** (checked every 5 s and at boot); the picker says which folder went missing, and the project reopens if it returns. A case-only rename on macOS opens under the disk's spelling. Commit `3078e21`.
- **A loaded thread catches up**: history stored after its fetch, steps during it, and after a reconnect. Finding 10. Commit `6cd9c77`.
- **History in time order, replaced logs read again**, and pages told when history lands. Finding 14. Commit `5f2d024`.
- **Titles masked, Claude rows marked `claude`, times ahead of the clock handled, NUL kept, command edits kept on stop.** Findings 14, 32. Commit `508e050`.
- **Claude Code's folder naming mirrored** (long paths found, siblings left out, either Unicode form). Findings 11, 13. Commit `04ab1a3`.
- **Step ids are per thread**, so a resumed or forked thread no longer takes copied steps. Finding 12. Commit `95906c5`.
- **The replay cursor stays on its step** when a growing thread renumbers its moments. Finding 15. Commit `3d8825b`.
- **A thread whose steps the server renumbered (fresh database) is fetched again** instead of freezing. Review fix. Commit `952267e`.
- **The map's "working on it" mark (60 s) is cancelled** on delete or project switch, and only reported for a file still on the map. Finding 16. Commit `7de5782`.
- **The map follows `.gitignore` in a git repo**: only `.git` and true caches are skipped by name; ignored folders come from git. A folder that is not a git repo keeps the name list. Finding 17. Maintainer: rely on `.gitignore` in git repos. Commit `a826ede`.
- **More import lines**: `./x.js` finds `x.ts`; aliases from the nearest tsconfig/jsconfig; Python absolute and package imports; imports inside comments no longer count. Finding 22. Commit `e160d6c`.
- **Islands** on the project overview come only from agents still on the map. Commit `564b74c`.
- **Dead contract removed**: `GET /api/history`, the Snapshot type, unused cache fields, `AskRequest.root`. Commit `9ca52b9`.

### Launcher, server start and database

- **Only a newer launcher restarts the server**; a downgrade is never announced as updated; the lock is taken before stopping and held through start; an unverified pid is never killed; the server picks its port starting from the previous one; failures go to server.log and, once a day, notices.json; loops are time-bounded; the environment is an allowlist (a shell `ANTHROPIC_API_KEY` never reaches the server); `RUNDOWN_PORT` is read. Findings 9, 23, 24, 37. Maintainer: a shell key does not power Ask; older launcher never restarts a newer server. Commit `66dc02a`.
- **The server serves 404 for missing `/assets/*`**, picks its port and writes it to server.json, and on SIGTERM/SIGINT closes cleanly. Findings 24, 25. Commit `3f2d0a1`.
- **A damaged database is moved aside with a date (never deleted)** and a fresh one starts with a notice; read-only gets one log line; the database closes on shutdown. Finding 26. Maintainer: never delete a corrupt database. Commit `650e389`; handle closed before the move: `1b098a1`.
- **Taking over the old Brainstorm data**: once every file is copied, the old copies are removed; if a copy fails, the partial new ones go and the old folder stays. Maintainer: delete the old folder after a full copy. Commit `e303753`.
- **Update notifications are their own setting** (Settings > Updates, "Tell me when there's a new version"), kept in settings.json in the data folder; off or `RUNDOWN_UPDATE_CHECK=0` means no request at all. One sentence on the privacy page. Maintainer decision: separate from stats, on by default, not tied to DO_NOT_TRACK. Commit `b3e59a9`.
- **Skills may run only the launcher** (`open`, `share`, `stop`). Finding 41. Not tested live: if a skill stops loading, revert this commit. Commit `d8e70b6`.
- **A server a skill started is marked** and restarted with the key by the next hook, keeping its port and project; Ask says it needs a restart meanwhile. Commit `02a981d`.
- **Build into a temp folder and swap only on success**, stop on web type errors, third-party notices from the bundles' real inputs. Findings 31, 48. Commit `fc3e919`.

### Meaning from text

- **One rule for a failed tool call** (flag first, text only for shell, edits and navigation); the Failures feature removed. Finding 18. Commit `d943184`.
- **Places splits shell commands quote-aware**; a push rehearsal or delete is not a push; `curl -X DELETE`, `gh api` writes and connector verbs match whole words; "not found" in a push no longer fails it. Finding 19. Commit `2eb745c`.
- **Command edits** match by whole words, never credit another thread's edit, drop no-change writes live, ignore ignored folders and folder deletes; shell option fixes. Finding 20. Commit `14f91fd`.
- **Codex**: commands keep their folder; interrupted turns end; `spawn_agent` shows as an Agent call linked to its subagent; subagents named from `agent_nickname`. Finding 21. Commit `cb40ba9`.

### Web

- **Play and Pause at every width**, in the thread bar and in shared replays; the shared replay's first crumb is "The whole map". Finding 29. Maintainer: no Space-only playback. Commit `f4e5cc5`.
- **Contrast**: failure words, agent initials and secondary grey text meet AA in all four themes. Finding 30. Commit `32d7d8a`.
- **Keyboard**: a "Skip past the steps" link; opening a step moves focus into its panel. Commit `839c115`.
- **Places** says when places couldn't load and stops polling while the tab is hidden. Finding 28. Commit `0042f20`.
- **A link with a stray `%` no longer crashes the page.** Commit `dde0376`.

### Landing site

- **Waitlist takes JSON only**; **double opt-in** with a confirm link by e-mail, release e-mail to confirmed addresses only, unsubscribed addresses stay unsubscribed, unconfirmed signups forgotten after 30 days. Finding 42. Commits `1bfcf64`, `53b101c`.
- **Deleting an install's usage reports is fast** through a per-install index. Finding 42. Commit `0ec99fd`.
- **Security headers**, admin token in sessionStorage, Resend's 30-day retention on the privacy page. Finding 42. Commit `f9a2ff3`.

### Left open (Phase 2)

- Hook proof: the server doesn't yet check an HMAC from the hook (the hook checks the server). Finding 40 partly done.
- Release tags (finding 31): the maintainer's release step.
- Reader rework (risk computed in the listener's sink).
- `ListenerService.updateStep` and the `step-update` message are never sent.
- Audit items not done: peek and diff line-number colours, the nav trailing-slash case.
- Windows: out of scope.
- Moving `site/` and `video/` out of the repo is not done.

## Phase 3: delete what the decisions retire

Mostly deletions. Same branch, then reviewed.

### What you might notice

- No Failures page or section, no git rings or git filter, no Nemotron setup steps or labels.
- Fewer setup steps in the checklist.
- 0.4-era hooks are refused, the old storage migration is gone.
- The project's docs are rewritten to match the code.

### Removed features

- **Nemotron removed**: model client, reader labels, summaries, retries, metrics (risk flags stay), Ask's fallback, setup steps, the `openai` dependency, the web's label guess. Maintainer decision. Commits `3761aab`, `6364b36`.
- **The hidden git view removed**: the server's git module (`/api/git`, periodic refresh, socket message), the web's filter, rings and file git line. `core/git-safety.ts` stays for the mapper. Maintainer decision. Commit `a1c6891`.
- **Failures feature removed** (see Phase 2 `d943184`), its Markdown section grouped from the thread itself.
- **The "footprint" thread mode deleted.** Nothing opened it. Commit `9d48395`.

### Dead code

- **Map**: `redraw.ticked()`, four theme keys, settle timers (the layout is final from the first frame), the one-off perf script. Commit `a774592`.
- **CSS**: dead rules deleted, overridden declarations folded. Commit `db96d94`.
- **Pre-rename shims**: no `BRAINSTORM_*` env, no `x-brainstorm-hook`, no browser storage migration, old placeholders. The `brainstorm.db` rename, adoptOldData and the brainstorm marketplace name stay for old installs. A 0.4-era hook is now refused. Commit `0d534be`.
- **Dependencies**: `@nestjs/cli` dropped, `@types/d3-hierarchy` to dev, no `legacy-peer-deps`. Commit `911b6f2`.
- **Strict TypeScript** (`noUnusedLocals`, `noUnusedParameters`, `noImplicitOverride`) and what it flagged removed; command edits use the map's own `.gitignore`-aware rules; `.mts` and `.cts` files are on the map. Commit `6ae26f2`.

### Docs and comments

- **technical.md rewritten** against the code, with attention, tasks and cowork folded in; run-locally and performance docs updated. Commit `d43a9e0`.
- **"Owner:" lines removed** and dated comments made timeless. Comments only. Commit `4a426a7`.
- Build log and handoff: `9cf0535`, `bdf312b`, `1b20485`.

### Review fixes

- **tsconfig alias lookup** stops at the project, reads only a regular file under 1 MB, and an alias without `*` matches that name only; tests. Commit `dd75b3b`.
- **The ignored-folders listing** gives up after 10 s with what it found. Commit `39d68de`.
- **A returning project folder under another spelling** is saved under it. Commit `fdf2fb6`.

### Left open (Phase 3)

- Hosted-demo code kept for now (maintainer decision), so recording code and `lib/preview.ts` remain.
- Moving `site/` and `video/` to their own repos: not done.
- `app/README.md` still mentions Nemotron and `brainstorm.db`.
- Thread titles: attached context next to typed words is no longer in the title; typed HTML stays.
- `test/regex-timing.test.cjs` is timing-based and flaked once.

## Phase 4: one copy of each rule

Behaviour should be the same. This puts rules that existed in several copies in one place. Phase 4 was reviewed (see the review notes at the top).

### What you might notice

- Phone layout starts at 440 px, not 600 px; between 440 and 1100 px the sidebar folds into a strip on the left.
- Picker's Back works.
- Failed steps are now stored with the step itself; old threads are filled in on first start.
- A character split at a read boundary is no longer garbled in some Codex lookups.
- Markdown export names a file relative to the project only if truly inside it.

### Shared between server and web

- **Contract moved into the shared folder**, plus new fields (`Step.isError`, command-edit input, 409 body, token, usage and updates status, hook signal), one store action name for the setup payload. Commits `af13e5e`, `7e327bb`.
- **One call pairer, one prompt parser, one failure text rule, one set of tool-name lists, one worktree/path module, small text helpers.** Several differently written copies became one each. Commits `005ea9d`, `d2c0f23`, `7d7c2ec`, `375a120`, `9f135fc`, `b441ffd`. Nothing visible; thread titles come from the one prompt parser.

### Server

- **One "inside the root" check** (`core/paths.ts`). Kept on purpose: the either-Unicode-form version in `moved.ts` and the relative-path one in `ignore.ts`. Commit `f67acf1`.
- **One config reader** (`core/config.ts`), the only reader of the environment; `.env.example` is generated. Commit `40b6da0`.
- **All tables in `core/schema.ts`** with ordered migrations under `PRAGMA user_version`; one settings service. Existing databases migrate as before. Commit `2a4276e`.
- **The open project's folder in one provider** instead of a mutable setting. Commit `3e7c833`.
- **The setup checklist asks the mapper for stats** instead of reaching into its cache. Commit `5c65ae9`.
- **One line reader**; fixes a character cut by a 4 MB read boundary. Commit `fdc935b`.
- **One local-write guard** (a refused write was already a 403). Commit `06e2c48`.
- **Prepared statements kept per database.** Commit `30965d5`.
- **`Step.isError` stored** (migration 2, backfilled), kept in old input for older builds. Commit `4a180c9`.
- **Markdown export** says a file is inside the project only when it is (`/a/bc` is not inside `/a/b`). Commit `9a06971`.

### Web

- **One way to call the server** (`lib/api.ts`) with one error type the setup view, Ask and crash screen show. Commit `861862d`.
- **`usePoll`**, **`createAtom`** for small stores, **breakpoints module** (1100 and 440 px) with one clock and one size hook. Commits `e94799b`, `63fe90f`, `ace7618`.
- **Store migration finished**: views read only the slices they draw. Commit `01eb17f`.
- **One shortcuts registry**; the thread bar's Play and Center call the action directly. Commit `cec706f`.
- **The step at the replay cursor and the Places step live in the nav store.** Commit `087e636`.
- **Map helpers once** (ease, id hash, colour parsing). Commit `b7ff45c`.
- **Phone layout at 440 px; folded strip up to 1100 px.** Maintainer decision. Commit `e157044`.
- **Picker's Back fixed**: the boot screen waits while the checklist runs, and Back stops picking. Commit `f8a3ba6`.
- Build log and handoff: `5cb5c81`.

### Left open (Phase 4)

- Copies whose behaviour differs were kept on purpose (named in the commits above).
- Phase 5 (split the large files, renames) and Phase 6 (tests, release process) followed; see below.
- Merge to `main` happens only after all phases; pushes and release are the maintainer's.

## Phase 5: split the large files and rename

Behaviour should be the same. The audit found files too big to change safely (the listener at about 1130 lines, the mapper at about 930, the command parser at about 925, MapView at 622, the replay layer at 618, the themes at 405), and later fixes kept colliding in them. This phase cuts each into parts that do one job, and renames what was misnamed. Phase 5 was reviewed (below).

### What you might notice

- Almost nothing. Screens are identical at rest in light, Prism and Hologram, at 1440, 800 and 420 px.
- In the dark themes, hovers now follow the light ones: the current row keeps its highlight under the pointer, the current breadcrumb shows no hover, and the Places ‹ › buttons no longer flash grey.
- In the light theme, a row hover is one shade different (#f4f4f7).
- In Places, the step panel keeps its step while it slides closed, as on the Map.
- Place names in Places are drawn the way the map draws its names; an edge may differ by a fraction of a pixel.
- The map costs no more per frame, and about 30% fewer frame callbacks run, because the Readmap no longer has its own loop.
- Old links and shared files still open: an old-style `/thread/<id>/step/<id>` link opens and plays, and a share file exported after the renames opens, plays and shows no errors.

### Server

- **Listener split** into the log reader (`tailer.ts`), the stored threads and steps (`step-store.ts`) and the open project's scope (`scope.ts`); the other modules now ask the step store instead of the listener. Answers to `/api/sessions`, a thread's steps and `/api/map` are byte for byte the same on the same logs. Nothing visible. Commit `89496d9`.
- **Mapper split** into imports (`imports.ts`), the live map and its watch (`live.ts`) and the "working on it" marks (`presence.ts`); the long live-batch step now reads as named phases. `/api/map` is byte for byte the same on the same project. Nothing visible. Commit `161adc2`.
- **Command parser split** into the shell reader (`shell-tokens.ts`), what each command does (`command-writes.ts`) and the inline-script scanner (`script-writes.ts`), with one option parser instead of five. The old and new builds give the same writes, reads and argv on about 172,000 commands. Nothing visible. Commit `ec0daff`.
- **Markdown export** is three steps (collect, aggregate, render) instead of one long function. The report is byte for byte the same on two threads of about 5 MB each. Commit `e3efda5`.
- **Launcher** reads its flags once and has one function per command. It printed the same lines in every case re-run: a fresh start, an older launcher leaving a newer server running, share with and without a session id, and stop twice. Commit `a464b51`.
- **Skipped on purpose**: merging the `-c`/`-e` script-finding loop into the shared parser (it would change results), and edits carrying the parser that found them (no review finding asks for it).

### Map

- **Frame, pointer, redraw, open folders and node lookup** moved out of MapView into hooks of their own, replacing about fifteen mirrored refs. Nothing visible. Commit `199b291`.
- **Camera** has one typed state and an explicit contract with the replay layer; the camera keys have their own hook and still use the shortcuts registry. Nothing visible. Commit `fd9e70f`.
- **Replay layer** split into focus, follow and playback, and the glide, trail, pulse and ring drawing shared by the map, the replay and Places in one tracer. Nothing visible. Commit `1ffb98b`.
- **Readmap** is drawn on the map's own frames and uses the camera's view maths, so at rest it does no work. Coming out of rest, its glide takes one frame's step, as before. Commit `426a810`.
- **Themes**: the theme data stays in `themes.ts`; the drawing went to `marks.ts` and `routes.ts`; landings moved from a global into the map's frame caches. Nothing visible. Commit `3a9faba`.
- **Places map** uses the map's label space and name drawing instead of its own copy. Place names may differ by a fraction of a pixel at the edges. Commit `de8bb1c`.

### Shell and sidebar

- **The shell decides first, then draws**: what kind of app it is and which screen to show are worked out once (`screen.ts`), and following an open thread moved to `LiveFollow.tsx`. A shared replay counts as shared even if its file carried preview extras; shares are made without them. Nothing visible. Commit `72d158b`.
- **One row, one row window and one cursor scroll** for the Track, the folded card and Places' list. The Track draws up to 80 rows around the cursor at a chapter's end instead of fewer: more rows off screen, none visible. Commit `67357fc`.
- **Sidebar**: whether it is open and the phone sheet are hooks of their own; opening it has one call instead of two spellings. Nothing visible. Commit `c210657`.
- **Places uses the Map's step panel**, with a slot for its place header. The panel keeps its step while sliding closed and is inert while closed, which also helps keyboard and screen-reader users. Commit `1711a81`.
- **CSS**: the footer's rules live in one file (`dock.css`), the panel and sidebar widths are tokens, and the greys are theme tokens, replacing 20-odd dark-theme overrides. Every token resolves to the old value in each theme except the hover changes listed above. Commit `fe5c7bf`.

### Renames

- **Web folders** say what they hold: `map/thread`, `step` and `places` (the server's `cowork/` folder keeps its name). Commit `49e4f34`.
- **`nav.thread` and `isRecording()`** replace the three meanings of "replay". Commit `0ef66dd`.
- **Packages** are `rundown-server` and `rundown-web`; the GitHub and landing addresses are one constant per side. The addresses themselves are unchanged. Commit `27f9f53`.
- **URLs, routes, share files and stored settings keep their names**, so old links and shared files keep working.
- The phone layout breakpoint lives in `lib/breakpoints.ts` (see Phase 4).
- `technical.md` and the build log describe the new layout. Commit `50e8f32`.

### Tests

246 of 246 pass. Two timing tests in `regex-timing.test.cjs` fail under heavy machine load; they fail the same way on the code from before Phase 5, so this is not a regression. Phase 6 makes them sturdier.

### Left open (Phase 5)

- Places' list draws every row; the list is short.
- The cowork view still passes 440 as the panel width.
- An older bug, not new: opening Places with no step leaves its list at the top with a gap, instead of scrolling to the thread's row.
- Phase 6 (tests, release process) followed; see below.
- On a fresh install, the first-run tour closes a thread that was opened from a link. This is how the tour already behaved.
- The live store's `replay` flag still has its old name, though its check is now `isRecording()`.

Review: no confirmed defects. The reviewer checked that stored settings keys, every server route and every CSS class are unchanged; that the server gets one shared steps store (no duplicate copies); that the launcher reads its options exactly as before; and that every new listener and timer is removed when its view closes. One possible issue, fixed: after a theme switch the Readmap could keep the old theme's colours for a few seconds, because it now draws only when the map does; it now reads the colours again as soon as the theme changes (`49e8069`). Noted as intended: a shared replay no longer shows the demo's preview banner or opens the setup screen.

## Phase 6: tests, release process and performance

Behaviour should be the same, only faster and lighter. This phase made the tests quicker and wider, wrote down how to release, and measured and trimmed the server and the web page where the audit found waste. Phase 6 is not reviewed yet (below).

### What you might notice

- Opening a project is faster. Threads from other places that touched the project's files appear about half a second later than before, instead of the whole server waiting for them.
- The server log is quieter: about 11 lines at start instead of about 75. The start line shows the version and the build it came from.
- Lower memory, on the server and in the page, most of all with big threads and big bursts of file changes.
- Nothing else visible. Screens, links and shared files are the same.

### Tests

- **Server tests** went from 246 to 312 and run in parallel: about 9 seconds instead of 28. The old CommonJS tests are now TypeScript, and modules that had no tests got some (Ask's context, the Places classifier, usage, opening files, line diffs, the Markdown export). Commits `c86b546`, `06686d9`, `6a6c3bf`, `36b9c6a`.
- **Golden tests** read invented Claude Code and Codex sessions into stored steps and compare the result. They use invented sessions only, no real people or projects. Commit `9628a31`.
- **Privacy and map tests** run on an invented person and a scratch data folder, and the **security tests boot the real server** to check the guards. Commits `9d3452f`, `fab1bf1`.
- **The audit's reproductions** were kept as tests wherever a fix landed with nothing guarding it. Commit `2dffd47`.
- **Timing tests** now compare a quarter-size run and a full-size run in the same pass. They still catch the old slow e-mail pattern and hold when the machine is busy (this closes the Phase 5 note about two of them failing under load). The attention tests use a pretend clock, and fixed sleeps became waits for a condition where one exists. Commits `36b9c6a`, `6a6c3bf`.
- **The web's first test suite** (vitest, 42 tests) covers the live store, the layout, the thread builder, the switcher, navigation and breakpoints. A randomized test found a real bug: when a file was removed and added again in one batch, other files kept their links to it. Fixed. Commit `bf43c76`.
- What a user might notice: nothing, except the one fix above (stale links to a re-added file).

### Tooling and release

- **Node 22.13** is named as the version (`engines`, `.nvmrc`), both sides have a typecheck script, and a dev server leaves nothing behind. A dev server can read `app/.env` for a scratch data folder; the folder, data and port settings are documented. Commits `6bd6985`, `cac5e72`.
- **Quieter log**: about 75 lines at start became about 11. Route lists and other detail appear only with `RUNDOWN_DEBUG`. No colour codes in files or with `NO_COLOR`. The start line shows the version and the commit it came from. The plugin's `server.js` is cut into lines of 500 characters so it reads and reviews well. Commits `2a185e7`, `4a556bb`.
- **`build-plugin.mjs --check`** builds into a temporary folder and says whether `plugin/build` is up to date, without writing anything. Commit `b07f3b7`.
- **`docs/release.md`** is the release checklist. It starts with `npm install` on both sides (vitest is new) and includes the web's tests. Commits `6da30e2`, `06627ee`.
- What a user might notice: a shorter, calmer log.

### Web speed

Numbers are from a thread of 5,918 steps.

- **Result pairing and islands**: pairing a tool result with its call, per live step, went from 1.9 ms to 0.09 ms. Rescanning for islands took 3.0 ms each time; now only new steps are read. The step panel finds its step by id. Commit `7fced19`.
- **Memory**: after opening and closing 10 threads, the page's memory grew from 33 to 55 MB before; it now settles at 22 MB. The page lets go of closed threads' steps, of agents the server dropped, and of forgotten attention marks. Commit `99e6b99`.
- **Redraws**: on a quiet project the map redrew 12 times in 30 seconds; now 0. It redraws for fading colours only while a file is recent. Commit `9fc6a53`.
- **Allocations**: the label pass and the agents' drawing make nothing new on a frame that changes nothing. Over 10 seconds, 469 KB became 277 KB. Placement of labels is unchanged. Commit `372984b`.
- **First download**: the same total, split into a smaller main part plus React. The graph library has its own file, so a change to the app no longer makes the browser fetch it again. Commit `f8eb566`.
- **Trimmed edits**: edit views work without the edit's text in the step. Only an edit with no diff asks the server for the whole step. Commit `cd1f5c1`.
- What a user might notice: a smoother map at rest, less memory over a long session, and quicker updates after a new version.

### Server speed

- **Steps list**: an edit's old and new texts are no longer sent twice. The list leaves them out when the diff already holds them, and `GET /api/steps/:id/input` returns the full text. On a 10,000-step bench thread that is mostly reads, the download went from 12.8 to 11.3 MB; edit-heavy threads save more. Shares, the Markdown export and Ask still use the full inputs. Commit `d6ef3fa`.
- **File changes**: a change now carries its path, and the old and new texts are read only for a command that wrote the file. Memory for a burst of 2,000 changed files went from 151 to 43 MB, and what is kept is capped at 16 MB. Commit `b9193c7`.
- **Stalls**: the map's first build, its live updates and the history import hand control back every 15 to 40 ms. On a burst of 4,000 changed files the longest stall went from 144 ms to under 50. The first map build stalled 487 ms; now under 50. Commit `ef06790`.
- **Opening a project** no longer blocks 300 to 1,200 ms looking for visitor threads. They are found a page at a time just after, so they appear about half a second later. Commit `fa9df37`.
- **Other projects' list** is read off the main loop, with a cache that is refreshed only when a folder changes. Commit `aab0e23`.
- **Screenshots**: a 207 MB log is read 4 MB at a time. Memory for a thread with one screenshot at its end went from 501 MB to between 82 and 128 MB. Commit `5bb035e`.
- **Attention check**: it ran every 2 seconds; it now runs when a thread's state can change. At rest that is 6 times a minute instead of 30. Its query went from 0.78 to 0.00 ms, and threads are indexed by their last step's time. Commit `f5c36f1`.
- **Memory run**: a 30-minute run under a live writer found no leak. The notes are in the performance document. Commit `e8fac1a`.
- What a user might notice: a faster start, no short freezes during big bursts of file changes, less memory.

### Putting the work together

- Two conflicts were resolved when the branches met: the trimmed steps list and the deferred visitors in the converted tests, and the attention tests, which now trigger the deadline-driven check instead of a 2-second timer. Commit `1bceded`.
- The web's fetch for a trimmed edit pointed at a route that did not exist; it now uses the server's real one, and only for an edit with no diff, which the server never trims. Checked: a trimmed edit's diff shows in full. Commit `b7bfb7e`.

### Left open (Phase 6)

- Audit findings not fixed: a custom title marks a thread as active "now"; one thread's hook signal stops guessing for all threads; an unreadable log folder is skipped for good; shell calls inside comments count as edits.
- Gaps the golden tests found: an image in a tool result leaves no note, and a resumed thread is not linked to the one it came from.
- A few map tests still use fixed waits.
- The server address is not yet the last line printed at start.
- The graph library's own animation loop still runs at rest (a later `useCanvasZoom` branch).
- The server does not check the hook's signature (from Phase 2).

Review: pending
