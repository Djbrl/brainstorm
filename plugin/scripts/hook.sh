#!/bin/sh
# SessionStart hook: start Brainstorm in the background. Prints nothing, or one JSON line with a message for the user.
if command -v node >/dev/null 2>&1; then
  exec node "$CLAUDE_PLUGIN_ROOT/scripts/launch.mjs" --background
fi
# No Node: say so, at most once a day.
mark="${CLAUDE_PLUGIN_DATA:-$HOME/.brainstorm}/.node-missing"
if [ -z "$(find "$mark" -mmin -1440 2>/dev/null)" ]; then
  mkdir -p "$(dirname "$mark")" && touch "$mark"
  printf '%s\n' '{"systemMessage":"Brainstorm needs Node.js 22.13 or later, and Node isn'"'"'t installed. Install it (for example `brew install node`, or from nodejs.org), then start a new session. Or ask Claude to install it for you."}'
fi
exit 0
