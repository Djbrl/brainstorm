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
- **Homepage:** https://rundown-dev.vercel.app
- **Support / contact:** sydjbrl@gmail.com (the address on the privacy page)
- **Privacy policy:** https://rundown-dev.vercel.app/privacy
- **Terms:** https://rundown-dev.vercel.app/terms
- **License:** MIT (`LICENSE.md` in the plugin folder)

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

## Notes for the reviewer

The portal's validation (12 Oct 2026, main @ e75db3f) found no blocks: 8 policy holds and 3 warnings. The icon warning is fixed by `plugin/.claude-plugin/icon.png` (add it before the first save: the portal takes the icon only once). Paste the rest into the submission's notes field.

> **ALLOWED_TOOLS_BROAD (skills/open, share, stop).** Each skill's only shell line runs the plugin's own launcher (`node "${CLAUDE_PLUGIN_ROOT}/scripts/launch.mjs" --open | --share | --stop …`), and `allowed-tools` is scoped to exactly that script, so `/rundown:open` doesn't ask for permission each time. The skills are user-invoked only (`disable-model-invocation: true`). Happy to drop `allowed-tools` and let users approve each call if you prefer.
>
> **MCP_FORWARDS_CREDENTIAL_ENV (scripts/launch.mjs, plugin.json).** The only credential is the optional Anthropic API key, declared as a `sensitive` userConfig option. The launcher passes `CLAUDE_PLUGIN_OPTION_ANTHROPIC_API_KEY` to the local Rundown server it starts (127.0.0.1), whose Ask feature sends it to Anthropic's API only. The `raw.githubusercontent.com` URL in the same file is the daily version check (a GET of the plugin's own `plugin.json`, no headers or data, can be turned off); the key never goes there. The launcher builds the server's environment from an allowlist, so no other environment variable (a shell `ANTHROPIC_API_KEY` included) reaches it.
>
> **BINARIES_NOT_INSPECTED (build/server.js, build/share.html).** These are esbuild/Vite bundles of the readable TypeScript source in the same repository (`app/server`, `app/web`), not hand-minified code. `node app/scripts/build-plugin.mjs --check` rebuilds into a temporary folder and confirms the committed build is identical, file by file. `build/THIRD_PARTY_NOTICES.md` lists the bundled packages.
>
> **COMMAND_SCRIPT_NOT_FOLLOWED.** `scripts/hook.sh` (POSIX sh) only checks that Node.js 22.13+ is installed and runs `scripts/launch.mjs`; `scripts/signal.mjs` posts hook events (tool name and input, signed with a per-install secret) to the local server on 127.0.0.1. Neither downloads or installs anything.
>
> **RUNTIME_FETCH_EXEC (build/web/assets/bash-*.js, index-*.js).** False positives: the first is the syntax highlighter's grammar for shell code, the second contains the app's classifier that recognises commands an agent ran (for example `curl … | sh`) to label them in the UI. Both only match text; nothing in the web app downloads or executes anything.
>
> **Local server.** The SessionStart hook starts a local HTTP server bound to 127.0.0.1 only. It refuses other host names and cross-site writes, requires a token for its live feed, and only accepts hook messages signed with the per-install secret. It serves the map UI the user opens in their browser or in the Claude desktop app's browser pane. Everything it reads, stores and sends is listed in `plugin/README.md` → "What it runs, stores and sends".

## If the review blocks on the build or the folder

The checklist holds plugins whose scripts sit in a repository subfolder, and plugins that ship bundled code. If either becomes a blocker, the fallback is a separate repository with the plugin at its top level and the build made by a GitHub Action from tagged source, so the reviewer sees both. That's a release-process change; decide it after the first review.
