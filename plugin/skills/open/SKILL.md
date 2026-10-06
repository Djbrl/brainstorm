---
description: Open Rundown, the live map and replay of this project's agent sessions, in the browser.
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

## Launcher output

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/launch.mjs" --open --switch --project "${CLAUDE_PROJECT_DIR}"`

## What to do

The Rundown launcher ran above.

- If it printed a URL, tell the user in one short sentence that Rundown is open for this project, with the URL as a link. Nothing else.
- If it says Node.js is missing or too old, tell the user Rundown needs Node.js 22.13 or later, and offer to install it (for example `brew install node` on macOS, or the installer from nodejs.org). Once it's installed, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/launch.mjs" --open --switch --project "${CLAUDE_PROJECT_DIR}"` again.
- If it failed another way, show the last lines of the output and the log path it mentions, and suggest `/brainstorm:stop` then `/brainstorm:open`.
