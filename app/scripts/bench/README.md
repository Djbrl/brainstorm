# Performance benchmark

One command measures the server and the web app on a fake project of any size, with a long Claude Code thread and a
live writer, and prints a table. Results and what they mean: [docs/performance.md](../../../docs/performance.md).

```sh
cd app/server && npm ci && cd ../web && npm ci && cd ../..   # once per checkout
node app/scripts/bench/run.mjs --files 5000 --cpu 4
node app/scripts/bench/run.mjs --files 1000,5000,20000 --cpu 1,4    # the baseline
```

It builds the server (`tsc`) and the web (`vite build`) of the checkout it runs in, so run it in your own worktree to
measure your branch. A full run of the three sizes at two CPU rates takes about 10 minutes.

## What it does

1. **Repo** (`gen-repo.mjs`): a TypeScript monorepo of N files under `apps/` and `packages/`, folders 1–6 deep, 10–800
   lines per file (median about 90), each TS file importing 1–8 others (half from its own folder, then neighbours, its
   package, anywhere), some JSON, Markdown and CSS. Two git commits (300 and 3 days ago), file times to match. Cached
   between runs (same `--files` and seed), reset with `git checkout` before each run.
2. **Thread** (`gen-thread.mjs`): a finished thread of `--steps` steps (default 10,000; about 40% in subagents) in
   Claude Code's log shape: one line per content block, tool results in user lines, Read results with the file's
   numbered lines, edits with old and new strings, about 4% failing calls, noise lines the listener skips, subagents in
   `<session>/subagents/agent-<id>.jsonl` with their `.meta.json`. Made-up content, no real logs copied.
3. **Live writer** (same file): a new running thread, about 3 steps a second with bursts of 5–12 calls, written with
   real timestamps; its edits also append a line to the file in the repo, as Claude Code would.
4. **Server** (`server.mjs`): started the way the plugin starts it (`node app/server/dist/main.js` serving
   `app/web/dist`), on a free port from 4900, with `CLAUDE_PROJECTS_DIR`, `BRAINSTORM_DATA_DIR` and `BRAINSTORM_ROOT`
   pointing into the scratch dir and no model keys. Booted three times: no logs (the map alone), cold (the long thread
   never read before) and warm (same database, the everyday restart).
5. **Front-end** (`front.mjs`, `cdp.mjs`): our own headless Chrome on a free port from 9620 with a throwaway profile,
   1440×900, at each `--cpu` throttling rate. Loads the map twice (cold and warm cache), then 10-second windows: the
   layout settling, at rest, panning and zooming, with the live writer running, replaying the long thread at 4×.

The real `~/.claude/projects` is never read: the server only sees the scratch dir (`CLAUDE_PROJECTS_DIR` already
existed in `app/server/src/core/config.service.ts`). The scratch dir defaults to `$TMPDIR/brainstorm-bench` and the
script refuses one inside the repo, `~/brainstorm` or `~/.claude`.

## Options

| Option | Default | |
| --- | --- | --- |
| `--files` | `1000` | Repo sizes, comma separated |
| `--cpu` | `1,4` | Chrome CPU throttling rates |
| `--steps` | `10000` | Steps in the long thread |
| `--scratch` | `$TMPDIR/brainstorm-bench` | Repos, logs, databases, Chrome profile |
| `--out` | `<scratch>/results` | Where the JSON goes |
| `--window` | `10` | Seconds per front-end window |
| `--live-seconds` | `20` | Live writer against the server alone |
| `--rate` | `3` | Live writer steps a second |
| `--dpr` | `1` | Device pixel ratio (2 = a Retina screen: four times the pixels to paint) |
| `--no-build` | | Reuse `app/server/dist` and `app/web/dist` |
| `--no-front` | | Server only |
| `--label` | | A name stored in the JSON (a branch, a change) |

The pieces run alone too: `node gen-repo.mjs --files 5000 --out <dir>`, `node gen-thread.mjs --repo <dir>
--claude-dir <dir> --steps 10000`, `node gen-thread.mjs --repo <dir> --claude-dir <dir> --live --seconds 30`.

## Reading the numbers

- Ports 4000, 5173, 5825, 4747, 7331 and 9487 are never used, and every server and Chrome it starts is stopped at the
  end (Ctrl-C too).
- Other agents' builds and servers share the CPU: compare runs made on a quiet machine (the JSON stores the load
  average at the start), and run twice when a number moves by less than 20%.
- Headless Chrome paints the canvas like a normal window, but frame times are rAF to rAF: 16.7 ms is a full 60 fps.
- "First render" is the first frame that paints at least half the files of the map (canvas `fill()` calls per frame).
