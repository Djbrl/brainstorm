---
description: Stop the Rundown server running in the background.
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/launch.mjs" --stop`

Tell the user in one short sentence what the output above says. Mention that Rundown starts again with the next Claude Code session, or with `/rundown:open`.
