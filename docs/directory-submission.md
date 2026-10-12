# Submitting Rundown to Anthropic's plugin directory

Answers to copy into the portal, and what to expect from its review. Prepared 12 Oct 2026 for version 0.9.0.

## Where and how

1. Check locally first: `claude plugin validate --strict ./plugin` (passes as of 0.9.0).
2. Open [claude.ai/directory/manage](https://claude.ai/directory/manage) and choose **Submit new → Plugin bundle**.
3. Repository: `https://github.com/Djbrl/brainstorm`. Plugin path: `plugin`.
4. **Validate**, fix anything marked Blocking, fill in the sections below, then **Submit for review**.

The docs: [submit a plugin](https://claude.com/docs/plugins/submit), [pre-submission checklist](https://claude.com/docs/plugins/pre-submission-checklist), [publishing](https://claude.com/docs/directory/publish). Anthropic doesn't give a review time, and decides "Verified" or "Community" itself.

## Listing

- **Name:** Rundown
- **Short description:** A live map and replay of what your coding agents do: every session, every file and place they touch, and what broke. Runs on your machine.
- **Long description:** Rundown follows your Claude Code (and Codex) sessions as they work. It draws your project as a map and moves each agent to the file it's on, keeps every step so you can replay a session, shows which thread is waiting for you, and lists the places an agent went outside the code (websites, local apps, services like GitHub and Vercel). You can open any step for its diff or output, ask Claude about it with your own API key, and save a session as one HTML file to share. Everything runs locally: a small server on 127.0.0.1 reads Claude Code's own session logs.
- **Category:** Developer tools
- **Homepage:** https://brainstorm-landing.vercel.app
- **Support / contact:** sydjbrl@gmail.com (the address on the privacy page)
- **Privacy policy:** https://brainstorm-landing.vercel.app/privacy
- **Terms:** https://brainstorm-landing.vercel.app/terms
- **License:** FSL-1.1-ALv2 (`LICENSE.md` in the plugin folder)

## Data handling

- **What data the plugin accesses:** Claude Code's and Codex's session logs on the user's computer (`~/.claude/projects`, `~/.codex`), and the files of the project the user opens, to draw the map and the steps. In a git project, read-only git commands (file list, commit times).
- **Where it's stored:** only on the user's computer, in the plugin's data folder (a SQLite database, readable only by the user). Secrets are masked before they're stored. Uninstalling deletes it.
- **What leaves the computer:**
  - A daily version check to `raw.githubusercontent.com` (no user data; can be turned off in Settings → Updates or with `RUNDOWN_UPDATE_CHECK=0`).
  - Anonymous usage stats, off until the user opts in (random install id, version, OS, theme, feature counts; no code, paths, prompts or names), sent to the landing site, kept 13 months, deletable from the app.
  - If the user sets an Anthropic API key: their questions and the step or file they ask about, to Anthropic's API.
- **Third parties:** GitHub (version check), Vercel (hosts the landing site that receives opt-in stats), Anthropic (Ask, with the user's own key).
- **Credentials:** an optional Anthropic API key, declared as a sensitive `userConfig` value (stored by Claude Code in the system's credential store). Rundown never reads a key from the shell environment.
- **Sharing:** the user can save a session as a local HTML file. It is redacted first (secrets, emails, home folder, account and computer names); nothing is uploaded.

## Compliance

- No hidden network calls; every request is listed in `plugin/README.md` → "What it runs, stores and sends".
- No permission changes: the plugin adds hooks and three skills; the skills may only run the plugin's own launcher.
- No obfuscated code: `build/` is a bundle of the TypeScript source in the same repository (`app/server`, `app/web`), rebuilt with `node app/scripts/build-plugin.mjs`; `--check` proves the committed build matches the source.

## Notes for the reviewer (for the items the checklist holds)

Paste into the submission's notes field.

> **Bundled build.** `plugin/build/server.js` and `plugin/build/share.html` are esbuild/Vite bundles of the readable TypeScript source in the same repository (`app/server`, `app/web`), not hand-minified code. `node app/scripts/build-plugin.mjs --check` rebuilds into a temporary folder and confirms the committed build is identical. Two files exceed 256 KiB for that reason.
>
> **Local server.** The SessionStart hook starts a local HTTP server bound to 127.0.0.1 only. It refuses other host names and cross-site writes, requires a token for its live feed, and only accepts hook messages signed with a per-install secret. It serves the map UI the user opens in their browser or the desktop app's browser pane.
>
> **Scripts.** `plugin/scripts/hook.sh` (POSIX sh) checks for Node.js and runs `launch.mjs`; `signal.mjs` forwards hook events to the local server. All hook commands use `${CLAUDE_PLUGIN_ROOT}` paths; no inline `node -e`.

## If the review blocks on the build or the folder

The checklist holds plugins whose scripts sit in a repository subfolder, and plugins that ship bundled code. If either becomes a blocker, the fallback is a separate repository with the plugin at its top level and the build made by a GitHub Action from tagged source, so the reviewer sees both. That's a release-process change; decide it after the first review.
