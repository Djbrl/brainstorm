# What's next

We cut the items below to ship on time. Most of them already have a place in the code: a stubbed endpoint, a contract field, or data we already collect. The sizes are our estimates for one developer who knows the codebase.

## Planned features we cut

| Feature | Why it matters | What exists | What's left | Size |
| --- | --- | --- | --- | --- |
| **History slider** | Scrub through how the codebase changed during a session | `GET /api/history` and the `Snapshot` type exist and return nothing; the map already updates live | Save a map snapshot after each finished agent turn (a `history` table), then a slider in the Map view that swaps in old snapshots | ½ day |
| **Pause and steer** | Stop an agent before a risky edit, from the map | Risk flags are computed on every edit | A Claude Code `PreToolUse` hook that asks Brainstorm before Edit/Write/Bash runs; a Pause button and a "steer" note written back to the session | 1 day |
| **Markdown export** | Done (30 Sep): `GET /api/export.md?sessionId=`, and Summary in the Share menu | | | |
| **Codex support** | Brainstorm is only useful if it follows the harness you use | The listener is the only Claude-specific part | A second parser for Codex session logs, producing the same `Step` type | ½ day |
| **Summary quality score** | Evidence that Nemotron summaries are good enough | Nemotron summaries and a Claude client | Claude grades 10 summaries against the file (planned in `numbers.md`) | 1 hour |

## Smaller improvements we know how to make

| Improvement | Details | Size |
| --- | --- | --- |
| Exact call/result pairing | Done (30 Sep): steps keep the `tool_use` id (`toolUseId`); one pairer on the server and the web, order as the fallback for older steps | |
| Removed files on the map | Done (30 Sep): `file-removed` over the WebSocket, and a changed file sends its new imports so lines update live | |
| Choose the project in the UI | Today `MAP_ROOT` and `SESSION_FILTER` are env vars. Pick the project from the sessions list instead, and map any session's `cwd` | ½ day |
| One-command install | Serve the built web from the NestJS server, publish as `npx brainstorm` | ½ day |
| Tunnel health in the UI | Show "Nemotron offline, labels paused" when the Brev tunnel drops, and reconnect it automatically | 2 hours |
| Failures over time | A trend per group (getting better or worse), and a "suggest a fix" button that asks Claude with the evidence | ½ day |
| Automated tests | There are none yet. Start with the log parser, error grouping and secret masking, which are pure functions and easy to test | ½ day |
| More languages on the map | Done (30 Sep): Go (packages inside the module), Rust (`mod`, `use crate/super/self`), Java (imports, wildcards, static) | |
| Test-file summaries | The stress test showed test files are sometimes described as the code they test. Tell the model when a path contains `.test.` | 30 min |
| Smaller web bundle | Done (30 Sep): Map, Track, Places and Failures load when opened, the diff viewer on the first diff: first load 709 → 279 kB | |
