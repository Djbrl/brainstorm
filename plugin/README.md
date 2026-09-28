# Brainstorm plugin for Claude Code

A live map and replay of what your coding agents do: every session, every file they touch, what broke. Everything runs on your machine.

Preview release (0.1). It lives on the `post-deadline` branch.

## Install

In Claude Code:

```
/plugin marketplace add Djbrl/brainstorm@post-deadline
/plugin install brainstorm@brainstorm
```

Then start a new session. You need Node.js 22.13 or later (`node -v`).

To get updates automatically, turn on auto-update for the `brainstorm` marketplace in `/plugin` → Marketplaces. Otherwise, run `/plugin marketplace update brainstorm`, then `/plugin update brainstorm@brainstorm`.

## Use

- **`/brainstorm:open`** opens the map in your browser, for the project you're in.
- **`/brainstorm:stop`** stops Brainstorm. It starts again with your next Claude Code session.

Brainstorm starts in the background when a Claude Code session starts, and reads Claude Code's own session logs, so it also shows sessions that ran while it was closed.

## Settings

- **Anthropic API key (optional):** lets you ask Claude questions about your code. Set it with `/plugin configure brainstorm@brainstorm`, then start a new session. Claude Code keeps it in your system's secure credential store. Leave it empty and everything else still works.

Summaries of files and labels written by a model are off in this release. They'll use the Claude Code you already have in a later version.

## What it stores, and where

- Data: `~/.claude/plugins/data/brainstorm-brainstorm/` (a SQLite database, the server log, `server.json`). Uninstalling the plugin deletes it.
- The server listens on `127.0.0.1` only (port 4747, or the next free one). It refuses requests addressed to other host names, and WebSocket connections from other websites.
- Nothing is sent anywhere, except your questions to Claude if you set a key.

## How it's built (for contributors)

- `build/server.js` is the Brainstorm server (`app/server`) bundled into one file, and `build/web/` is the web app (`app/web`), which the server serves. Rebuild both from `app/` with `node scripts/build-plugin.mjs`, and commit `build/` with each release.
- `scripts/launch.mjs` starts the server or reuses the running one, restarts it when the plugin version changed, and opens the browser. The `SessionStart` hook runs it with `--background`.
- Releasing: bump `version` in `.claude-plugin/plugin.json`, rebuild, commit, push. Users on a pinned version don't get new commits until the version changes.

## License

[FSL-1.1-ALv2](../LICENSE.md): use, change and self-host it freely; no competing product or service. Each release also becomes Apache 2.0 two years later.

## Uninstall

```
/plugin uninstall brainstorm@brainstorm
/plugin marketplace remove brainstorm
```

Run `/brainstorm:stop` first to stop the server. Uninstalling deletes Brainstorm's data folder.
