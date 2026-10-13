# Rundown plugin for Claude Code

A live map and replay of what your agents do: every session, every file and place they touch, what broke. Everything runs on your machine.

Preview release (0.9.1). The full release is planned for late October 2026.

- **Map:** your project's files as a graph, with what changed since you last looked. Each agent is a marker that moves to the file it's working on. Open a thread to see what it touched first, then its steps or its replay; a running one can be followed live.
- **Places:** where the thread went outside the code: websites, your local apps, services like GitHub and Vercel, and what it changed there (pushes, deploys, sent forms). Click a place to read its step.
- **Track:** the open thread's steps in the sidebar, grouped by what you asked. Scrolling them moves the agent along the map; open a step for its diff, its output or the screenshots it took.
- **Steps:** open any step for its diff or output, and ask about it. Every place has a link, and Back or Esc goes up one level.
- **Errors:** a failed step turns the agent's marker red, and shows red in the steps, on the replay bar and in the Track.
- **Share:** save a thread as one `.html` file anyone can open in a browser (the map and every step, nothing to install), plus a Markdown summary.

## Install

In Claude Code:

```
/plugin marketplace add Djbrl/brainstorm
/plugin install rundown@rundown
```

Or in one command (Claude Code 2.1.275 or later): `/plugin install rundown --marketplace Djbrl/brainstorm`.

Then start a new session. You need Node.js 22.13 or later (`node -v`). If Node is missing, Rundown tells you when the session starts.

## Moving from Brainstorm (0.4 and older)

Until 0.4 the plugin was called `brainstorm`. Claude Code sees Rundown as a new plugin from the same marketplace, which keeps its old name on your machine:

```
/plugin marketplace update brainstorm
/plugin install rundown@brainstorm
```

Start a new session: Rundown takes over the old plugin's data (your history and settings) and stops its server. Then remove the old plugin:

```
/plugin uninstall brainstorm@brainstorm
```

From then on, update with `claude plugin update rundown@brainstorm`.

## Updates

When a newer version is on GitHub, Rundown tells you at the start of a session (it checks at most once a day). To update, run `claude plugin update rundown@rundown` in a terminal (`rundown@brainstorm` if you had it before the rename), or choose **Update now** in `/plugin` → **Installed**, then start a new session. The running server restarts on the new version by itself.

To update automatically instead, turn on auto-update for the `rundown` marketplace in `/plugin` → **Marketplaces**.

## Use

- **`/rundown:open`** opens the map for the project you're in. In the Claude desktop app it opens in the app's browser pane, beside your thread (Claude opens it there, so the first time the app may ask you to allow the page); `/rundown:open browser` opens it in your default browser instead, for the full window. In the terminal and in IDEs it opens in your default browser.
- **`/rundown:share`** saves this thread to your Downloads folder as a replay file and a Markdown summary. The Share button on the map's replay player does the same for any thread.
- **`/rundown:stop`** stops Rundown. It starts again with your next Claude Code session.

Rundown starts in the background when a Claude Code session starts, and reads Claude Code's own session logs, so it also shows sessions that ran while it was closed. The first time, a message in Claude Code tells you where it's running.

## Settings

- **Anthropic API key (optional):** lets you ask Claude questions about your code. Set it with `/plugin configure rundown@rundown` (`rundown@brainstorm` if you had it before the rename), then start a new session. Claude Code keeps it in your system's secure credential store. Leave it empty and everything else still works.

Summaries of files and labels written by a model are off in this release. They'll use the Claude Code you already have in a later version.

## What it runs, stores and sends

Everything Rundown does on your computer, and every time it talks to anything outside it.

### What runs

- **When a Claude Code session starts,** the `SessionStart` hook runs `scripts/hook.sh`, which checks for Node.js and runs `scripts/launch.mjs`. The launcher starts the Rundown server (`build/server.js`, run with your Node.js) in the background, or reuses the one already running, and prints at most one message for you (welcome, updated, an update available, or Node too old).
- **While a session runs,** the `PermissionRequest`, `Notification`, `Stop` and `UserPromptSubmit` hooks run `scripts/signal.mjs` in the background. It sends the event (the tool's name and input, never the conversation) to the local server, signed with a secret only the server and the hooks know, so the map can show which thread is waiting for you.
- **The skills** (`/rundown:open`, `/rundown:share`, `/rundown:stop`) may only run the launcher, nothing else.
- **The server** reads Claude Code's and Codex's session logs (`~/.claude/projects`, `~/.codex`) and the files of the project you open, to draw the map. In a git project it runs read-only git commands there (the file list, recent commit times), with the repository's own helper programs turned off. It never writes to your project.
- **When you ask it to,** it opens a file in your editor or shows it in Finder, and opens the map in your browser.

### What it stores, and where

- Data: `~/.claude/plugins/data/rundown-rundown/` (`rundown-brainstorm` if you installed `rundown@brainstorm`): a SQLite database (your threads' steps, read from the logs, with secrets masked), the server log, `server.json`, `notices.json` and `settings.json`. The folder and its files are readable only by you. Uninstalling the plugin deletes it. If Claude Code doesn't set a plugin data folder, Rundown uses `~/.rundown` instead, and that folder stays after you uninstall (delete it yourself to remove your history).
- `server.json` holds a random secret. The launcher and the hooks only talk to a server that proves it knows it, and the server only accepts hook messages signed with it.

### What it sends, and to whom

- **Nothing about your code, prompts or files leaves your computer,** with the two exceptions below, both your choice.
- **Update check (on by default, can be turned off):** once a day, Rundown fetches its own version number from GitHub (`raw.githubusercontent.com`) to tell you about updates. The request carries nothing about you or your code. Turn it off in Settings → Updates, or with `RUNDOWN_UPDATE_CHECK=0`.
- **Usage stats (off until you say yes):** the app asks once. With a yes, once a day: a random install id, the version, the OS, the map theme and counts of what you used, sent to the landing site (`rundown-dev.vercel.app`); never code, paths, prompts or names. Kept 13 months. Change it, or delete what was sent, in Settings; `DO_NOT_TRACK=1` keeps it off for good. Details: [Usage stats](../README.md#usage-stats) and the [privacy page](https://rundown-dev.vercel.app/privacy).
- **Questions to Claude (only if you set an API key):** when you ask about a step or a file, the question and the step or file it's about go to Anthropic's API with your key. Without a key, nothing is sent.
- **Sharing** only saves files on your computer; you decide where they go. A shared file contains the thread's prompts, messages, commands and code changes, and the project's file list. Before it's saved, secrets are masked again, email addresses are masked, and your home folder, account name and computer name are replaced. Screenshots and Ask answers are never included. The file runs only its own code and loads nothing from the network. Read it before you send it anywhere.

### Who can reach the server

The server listens on `127.0.0.1` only (port 4747, or the next free one), so other computers can't reach it. It refuses requests addressed to other host names and writes from other websites, and its live feed needs a token only its own page can read. Other programs running on this computer can read from it, as with any local server. Its page loads nothing from elsewhere (a Content Security Policy), and other sites can't frame it.

## How it's built (for contributors)

- `build/server.js` is the Rundown server (`app/server`) bundled into one file, and `build/web/` is the web app (`app/web`), which the server serves, and `build/share.html` is the same app in one file, which shared replays are poured into. Rebuild both from `app/` with `node scripts/build-plugin.mjs`, and commit `build/` with each release.
- `scripts/launch.mjs` starts the server or reuses the running one, restarts it when the plugin version changed, and opens the map: in the default browser, or, inside the Claude desktop app (`CLAUDE_CODE_ENTRYPOINT=claude-desktop`), it only prints the URL and the `open` skill has Claude open it in the app's browser pane (`--browser` forces the default browser). The `SessionStart` hook runs it through `scripts/hook.sh` (which checks for Node) with `--background`, where it prints at most one JSON `systemMessage` for the user: welcome, updated, update available, or Node too old.
- The `PermissionRequest`, `Notification`, `Stop` and `UserPromptSubmit` hooks run `scripts/signal.mjs` in the background (async, they never slow a session): it posts the event to the running server's `/api/hooks`, which works out whether a thread needs you (see "Waiting for you" in `docs/technical.md`).
- `build/THIRD_PARTY_NOTICES.md` holds the licences of the open-source packages bundled into the build; the build writes it (`app/scripts/third-party-notices.mjs`).
- Releasing: bump `version` in `.claude-plugin/plugin.json`, rebuild, commit, push. Users on a pinned version don't get new commits until the version changes.

## License

[MIT](../LICENSE.md): open source. Use it, change it and build on it freely; keep the copyright and licence notice in copies.

## Uninstall

```
/plugin uninstall rundown@rundown
/plugin marketplace remove rundown
```

If you installed it as `rundown@brainstorm`, use `/plugin uninstall rundown@brainstorm` and `/plugin marketplace remove brainstorm`.

Run `/rundown:stop` first to stop the server. Uninstalling deletes Rundown's data folder, unless it is `~/.rundown` (see above), which stays. If you want to keep your settings, copy the data folder somewhere first.
