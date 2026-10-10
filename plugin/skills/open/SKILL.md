---
description: Open Rundown, the live map and replay of this project's agent sessions, beside this thread (in the Claude desktop app) or in the browser. Add "browser" to open it in your default browser instead.
disable-model-invocation: true
argument-hint: "[browser]"
allowed-tools: Bash(node:*), mcp__Claude_Browser__tabs_context, mcp__Claude_Browser__tabs_select, mcp__Claude_Browser__preview_start
---

## Launcher output

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/launch.mjs" --open --switch --project "${CLAUDE_PROJECT_DIR}"`

## Arguments

$ARGUMENTS

## What to do

The Rundown launcher ran above.

- If it says "Open it in the browser pane" with a URL:
  - If the arguments ask for the default browser (for example "browser"), run `node "${CLAUDE_PLUGIN_ROOT}/scripts/launch.mjs" --open --browser --project "${CLAUDE_PROJECT_DIR}"` and tell the user in one short sentence that Rundown is open in their browser.
  - Otherwise open it in the Claude app's browser pane, beside this thread: call `mcp__Claude_Browser__tabs_context`; if a tab already shows that URL's origin, front it with `mcp__Claude_Browser__tabs_select`, else open the URL with `mcp__Claude_Browser__preview_start` (pass `url`). Then tell the user in one short sentence that Rundown is open beside the thread, and that `/rundown:open browser` opens it in their browser, for the full window. If `tabs_context` said the browser pane is hidden (the side panel shows something else), add that Cmd+Shift+B (Ctrl+Shift+B on Windows) brings it back. Nothing else.
  - If those browser tools aren't available or the pane refuses the URL, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/launch.mjs" --open --browser --project "${CLAUDE_PROJECT_DIR}"` instead and say Rundown is open in their browser, with the URL as a link.
- Else, if it printed a URL, tell the user in one short sentence that Rundown is open for this project, with the URL as a link. Nothing else.
- If it says Node.js is missing or too old, tell the user Rundown needs Node.js 22.13 or later, and offer to install it (for example `brew install node` on macOS, or the installer from nodejs.org). Once it's installed, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/launch.mjs" --open --switch --project "${CLAUDE_PROJECT_DIR}"` again.
- If it failed another way, show the last lines of the output and the log path it mentions, and suggest `/rundown:stop` then `/rundown:open`.
