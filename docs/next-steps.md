# What's next

We cut the items below to ship on time. Most of them already have a place in the code: a stubbed endpoint, a contract field, or data we already collect. The sizes are our estimates for one developer who knows the codebase.

## Planned features we cut

| Feature | Why it matters | What exists | What's left | Size |
| --- | --- | --- | --- | --- |
| **History slider** | Scrub through how the codebase changed during a session | `GET /api/history` and the `Snapshot` type exist and return nothing; the map already updates live | Save a map snapshot after each finished agent turn (a `history` table), then a slider in the Map view that swaps in old snapshots | ½ day |
| **Pause and steer** | Stop an agent before a risky edit, from the map | Risk flags are computed on every edit | A Claude Code `PreToolUse` hook that asks Brainstorm before Edit/Write/Bash runs; a Pause button and a "steer" note written back to the session | 1 day |
| **Markdown export** | A shareable "what the agents did" report for reviews | Labels, summaries, failures and answers are all in the db | `GET /api/export.md?root=`: the session's steps grouped by module, with summaries and failure groups | 2 hours |
| **Codex support** | Brainstorm is only useful if it follows the harness you use | The listener is the only Claude-specific part | A second parser for Codex session logs, producing the same `Step` type | ½ day |
| **Summary quality score** | Evidence that Nemotron summaries are good enough | Nemotron summaries and a Claude client | Claude grades 10 summaries against the file (planned in `numbers.md`) | 1 hour |

## Smaller improvements we know how to make

| Improvement | Details | Size |
| --- | --- | --- |
| Exact call/result pairing | Results are matched to calls by order, which is correct in practice. Storing `tool_use_id` on both steps (a new contract field) would make it exact | 1 hour |
| Removed files on the map | The mapper drops deleted files, but there's no WebSocket message for it yet, so the web keeps them until reload. Add `{type: "file-removed", path}` | 30 min |
| Choose the project in the UI | Today `MAP_ROOT` and `SESSION_FILTER` are env vars. Pick the project from the sessions list instead, and map any session's `cwd` | ½ day |
| One-command install | Serve the built web from the NestJS server, publish as `npx brainstorm` | ½ day |
| Tunnel health in the UI | Show "Nemotron offline, labels paused" when the Brev tunnel drops, and reconnect it automatically | 2 hours |
| Failures over time | A trend per group (getting better or worse), and a "suggest a fix" button that asks Claude with the evidence | ½ day |
| Automated tests | There are none yet. Start with the log parser, error grouping and secret masking, which are pure functions and easy to test | ½ day |
| More languages on the map | Imports are parsed for TypeScript, JavaScript and Python. Add Go, Rust, Java with the same regex approach, or tree-sitter | ½ day |
| Test-file summaries | The stress test showed test files are sometimes described as the code they test. Tell the model when a path contains `.test.` | 30 min |
| Smaller web bundle | The graph library pushes the bundle over 500 kB. Load the Map view lazily | 30 min |
