# Brainstorm plugin for Claude Code

A live map and replay of what your agents do: every session, every file and place they touch, what broke. Everything runs on your machine.

Preview release (0.3). The full release is planned for late October 2026.

- **Map:** your project's files as a graph. Each agent is a marker that moves to the file it's working on. Click a thread to replay it step by step; a running one plays live.
- **Places:** where the thread went outside the code: websites, your local apps, services like GitHub and Vercel, and what it changed there (pushes, deploys, sent forms). Click a place to read its step.
- **Track:** the same thread as a story, top to bottom: each place the agent worked (a file, a website, a command-line tool), with a window showing the screenshot, the file it made, the code it wrote or the command explained. Works for non-code work too, like editing a video with FFmpeg.
- **Follow:** every step of a session as a timeline. Click an edit to see its diff.
- **Errors:** a failed step turns the agent's marker red, and shows red in Follow, on the replay bar and in the Track.

## Install

In Claude Code:

```
/plugin marketplace add Djbrl/brainstorm
/plugin install brainstorm@brainstorm
```

Or in one command (Claude Code 2.1.275 or later): `/plugin install brainstorm --marketplace Djbrl/brainstorm`.

Then start a new session. You need Node.js 22.13 or later (`node -v`). If Node is missing, Brainstorm tells you when the session starts.

## Updates

When a newer version is on GitHub, Brainstorm tells you at the start of a session (it checks at most once a day). To update, run `claude plugin update brainstorm@brainstorm` in a terminal, or choose **Update now** in `/plugin` → **Installed**, then start a new session. The running server restarts on the new version by itself.

To update automatically instead, turn on auto-update for the `brainstorm` marketplace in `/plugin` → **Marketplaces**.

## Use

- **`/brainstorm:open`** opens the map in your browser, for the project you're in.
- **`/brainstorm:stop`** stops Brainstorm. It starts again with your next Claude Code session.

Brainstorm starts in the background when a Claude Code session starts, and reads Claude Code's own session logs, so it also shows sessions that ran while it was closed. The first time, a message in Claude Code tells you where it's running.

## Settings

- **Anthropic API key (optional):** lets you ask Claude questions about your code. Set it with `/plugin configure brainstorm@brainstorm`, then start a new session. Claude Code keeps it in your system's secure credential store. Leave it empty and everything else still works.

Summaries of files and labels written by a model are off in this release. They'll use the Claude Code you already have in a later version.

## What it stores, and where

- Data: `~/.claude/plugins/data/brainstorm-brainstorm/` (a SQLite database, the server log, `server.json`, `notices.json`). Uninstalling the plugin deletes it.
- Once a day, Brainstorm fetches its own version number from GitHub to tell you about updates. That request carries nothing about you or your code.
- The server listens on `127.0.0.1` only (port 4747, or the next free one). It refuses requests addressed to other host names, and WebSocket connections from other websites.
- Nothing else is sent anywhere, except your questions to Claude if you set a key.

## How it's built (for contributors)

- `build/server.js` is the Brainstorm server (`app/server`) bundled into one file, and `build/web/` is the web app (`app/web`), which the server serves. Rebuild both from `app/` with `node scripts/build-plugin.mjs`, and commit `build/` with each release.
- `scripts/launch.mjs` starts the server or reuses the running one, restarts it when the plugin version changed, and opens the browser. The `SessionStart` hook runs it through `scripts/hook.sh` (which checks for Node) with `--background`, where it prints at most one JSON `systemMessage` for the user: welcome, updated, update available, or Node too old.
- Releasing: bump `version` in `.claude-plugin/plugin.json`, rebuild, commit, push. Users on a pinned version don't get new commits until the version changes.

## License

[FSL-1.1-ALv2](../LICENSE.md): use, change and self-host it freely; no competing product or service. Each release also becomes Apache 2.0 two years later.

## Uninstall

```
/plugin uninstall brainstorm@brainstorm
/plugin marketplace remove brainstorm
```

Run `/brainstorm:stop` first to stop the server. Uninstalling deletes Brainstorm's data folder.
