---
description: Save this thread as a replay file anyone can open in a browser, plus a Markdown summary, to share it.
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

## Launcher output

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/launch.mjs" --share --session "${CLAUDE_SESSION_ID}" --project "${CLAUDE_PROJECT_DIR}"`

## What to do

The Rundown launcher ran above.

- If it saved files, tell the user in two short sentences where the replay file and the summary are (as links to the paths), and that the replay opens in any browser with nothing to install. Add the line about what's included and masked.
- If it says Node.js is missing or too old, tell the user Rundown needs Node.js 22.13 or later.
- If it failed another way, show the last lines of the output.
