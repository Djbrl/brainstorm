# Rundown plugin for Claude Code

A live map and replay of what your agents do: every session, every file and place they touch, what broke. Everything runs on your machine.

Preview release (0.4). The full release is planned for late October 2026.

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
/plugin install brainstorm@brainstorm
```

Or in one command (Claude Code 2.1.275 or later): `/plugin install brainstorm --marketplace Djbrl/brainstorm`.

Then start a new session. You need Node.js 22.13 or later (`node -v`). If Node is missing, Rundown tells you when the session starts.

## Updates

When a newer version is on GitHub, Rundown tells you at the start of a session (it checks at most once a day). To update, run `claude plugin update brainstorm@brainstorm` in a terminal, or choose **Update now** in `/plugin` → **Installed**, then start a new session. The running server restarts on the new version by itself.

To update automatically instead, turn on auto-update for the `brainstorm` marketplace in `/plugin` → **Marketplaces**.

## Use

- **`/brainstorm:open`** opens the map in your browser, for the project you're in.
- **`/brainstorm:share`** saves this thread to your Downloads folder as a replay file and a Markdown summary. The Share button on the map's replay player does the same for any thread.
- **`/brainstorm:stop`** stops Rundown. It starts again with your next Claude Code session.

Rundown starts in the background when a Claude Code session starts, and reads Claude Code's own session logs, so it also shows sessions that ran while it was closed. The first time, a message in Claude Code tells you where it's running.

## Settings

- **Anthropic API key (optional):** lets you ask Claude questions about your code. Set it with `/plugin configure brainstorm@brainstorm`, then start a new session. Claude Code keeps it in your system's secure credential store. Leave it empty and everything else still works.

Summaries of files and labels written by a model are off in this release. They'll use the Claude Code you already have in a later version.

## What it stores, and where

- Data: `~/.claude/plugins/data/brainstorm-brainstorm/` (a SQLite database, the server log, `server.json`, `notices.json`). Uninstalling the plugin deletes it.
- Once a day, Rundown fetches its own version number from GitHub to tell you about updates. That request carries nothing about you or your code.
- Once a day, it sends anonymous usage stats (a random install id, version, OS, map theme and counts of what you used; never code, paths, prompts or names). See [Usage stats](../README.md#usage-stats) for exactly what. Turn it off in Settings, or with `DO_NOT_TRACK=1`.
- The server listens on `127.0.0.1` only (port 4747, or the next free one). It refuses requests addressed to other host names, and WebSocket connections from other websites.
- To show when a thread is waiting for you, the plugin's hooks tell the local server when Claude Code asks for a permission, shows a notification, finishes a turn or gets a new message (the tool's name and input, never the conversation). They only talk to `127.0.0.1`.
- Nothing else is sent anywhere, except your questions to Claude if you set a key. Sharing only saves files on your computer; you decide where they go.
- A shared file contains the thread's prompts, messages, commands and code changes, and the project's file list. Before it's saved, secrets are masked again, email addresses are masked, and your home folder, account name and computer name are replaced. Screenshots are never included. Read it before you send it anywhere.

## How it's built (for contributors)

- `build/server.js` is the Rundown server (`app/server`) bundled into one file, and `build/web/` is the web app (`app/web`), which the server serves, and `build/share.html` is the same app in one file, which shared replays are poured into. Rebuild both from `app/` with `node scripts/build-plugin.mjs`, and commit `build/` with each release.
- `scripts/launch.mjs` starts the server or reuses the running one, restarts it when the plugin version changed, and opens the browser. The `SessionStart` hook runs it through `scripts/hook.sh` (which checks for Node) with `--background`, where it prints at most one JSON `systemMessage` for the user: welcome, updated, update available, or Node too old.
- The `PermissionRequest`, `Notification`, `Stop` and `UserPromptSubmit` hooks run `scripts/signal.mjs` in the background (async, they never slow a session): it posts the event to the running server's `/api/hooks`, which works out whether a thread needs you (see `docs/attention.md`).
- Releasing: bump `version` in `.claude-plugin/plugin.json`, rebuild, commit, push. Users on a pinned version don't get new commits until the version changes.

## License

[FSL-1.1-ALv2](../LICENSE.md): use, change and self-host it freely; no competing product or service. Each release also becomes Apache 2.0 two years later.

## Uninstall

```
/plugin uninstall brainstorm@brainstorm
/plugin marketplace remove brainstorm
```

Run `/brainstorm:stop` first to stop the server. Uninstalling deletes Rundown's data folder.
