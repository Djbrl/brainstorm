# Performance

How fast Brainstorm is on big projects and slow machines, measured the same way every time. The benchmark lives in
[`app/scripts/bench/`](../app/scripts/bench/README.md):

```sh
node app/scripts/bench/run.mjs --files 1000,5000,20000 --cpu 1,4
```

It generates a fake TypeScript repo (1k, 5k or 20k files, nested folders, 10–800 lines a file, 1–8 imports each),
a finished 10,000-step thread (about 40% in 40–56 subagents), and a live writer that appends about 3 steps a second
with bursts. The server reads them from a scratch folder (`CLAUDE_PROJECTS_DIR`), never `~/.claude/projects`. The web
app is the production build, served by the server as the plugin does, and measured in a private headless Chrome at
1440×900 with CPU throttling 1× and 4× (4× is roughly a mid-range Windows laptop).

## Baseline (5 Oct 2026)

**Machine:** MacBook Pro (`MacBookPro18,3`), Apple M1 Pro, 8 cores, 16 GB RAM, macOS 26.7.1, Node 24.13.1, Chrome
154. **Code:** `main` at `2d1de72` (the bench commits add scripts only). **Load:** other agents were building and
testing on the same machine; the load average was 119, 28 and 15 at the start of the 1k, 5k and 20k runs (8 cores).
Wall times below carry that noise. CPU seconds and main-thread CPU are steadier. A first pass under heavier load
(load average up to 104) gave the same picture, with cold boots of 5–10 s.

### Server

| | 1k files | 5k files | 20k files |
| --- | --- | --- | --- |
| Files on the map | 800 | 800 | 800 |
| Map build (walk, read, imports) | 416 ms | 302 ms | 667 ms |
| Boot, no threads: answers / goes quiet | 2.1 s / 2.6 s | 1.3 s / 1.9 s | 2.3 s / **10.2 s** |
| CPU used by then | 0.9 / 1.0 s | 1.0 / 1.7 s | 0.9 / **4.6 s** |
| Boot, 10k-step thread never read (cold): answers | **5.6 s** | 3.3 s | **5.6 s** |
| CPU used before it answers (cold) | 2.9 s | 2.6 s | 2.9 s |
| Boot, same database (warm): thread listed | 1.8 s | 1.5 s | 2.4 s |
| `/api/map` | 17 ms, 1.2 MB | 9 ms, 1.1 MB | 14 ms, 1.1 MB |
| `/api/sessions` | 16 ms | 10 ms | 11 ms |
| `/api/failures` first / cached | 86 / 10 ms | 82 / 3 ms | 144 / 5 ms |
| `/api/sessions/:id/steps` (the 10k thread) | 195 ms, **12 MB** | 182 ms, 12 MB | 361 ms, 12 MB |
| `/api/tasks/:id` | 222 ms, 1.1 MB | 250 ms, 1.1 MB | 255 ms, 1.1 MB |
| Memory (RSS): no threads / warm / after serving the thread / peak | 127 / 146 / 347 / 347 MB | 194 / 213 / 401 / 401 MB | 323 / 301 / 477 / **488 MB** |
| CPU while the live writer runs (avg / max) | 1.0 / 3% | 1.3 / 13% | 1.1 / 5% |
| Websocket while it runs | 14.5 msg/s, 1.2 KB avg | 10.9 msg/s, 1.1 KB | 14 msg/s, 1.2 KB |
| Step latency, log line → websocket (p50 / p95 / max) | 5 / 38 / 167 ms | 3 / 15 / 1,966 ms | 9 / 66 / 2,200 ms |

### Web app

Frame times are rAF to rAF (16.7 ms = 60 fps). Long tasks are main-thread tasks over 50 ms, summed over the 10-second
window. "CPU" is the page's main-thread CPU time as a share of the window.

| | 1k, 1× | 1k, 4× | 5k, 1× | 5k, 4× | 20k, 1× | 20k, 4× |
| --- | --- | --- | --- | --- | --- | --- |
| First map render, empty cache / cached | 725 / 375 ms | 962 / 496 ms | 1,836 / 97 ms | 697 / 516 ms | 902 / 442 ms | 852 / 668 ms |
| Layout settling (10 s after first render): fps, p95 | 60, 17 ms | 40, 50 ms | 60, 17 ms | 38, 50 ms | 60, 17 ms | 38, 50 ms |
| At rest: fps, p95, CPU | 60, 17 ms, **18%** | 57, 17 ms, **66%** | 60, 17 ms, 18% | 57, 17 ms, 72% | 60, 17 ms, 20% | 55, 33 ms, 56% |
| Panning and zooming: fps, p95, long tasks | 58, 17 ms, 0 | **22, 133 ms, 3.3 s** | 60, 17 ms, 0 | 26, 67 ms, 1.9 s | 59, 17 ms, 0.05 s | 35, 67 ms, 1.9 s |
| Live writer running: fps, p95, CPU | 60, 17 ms, 57% | **21, 100 ms, 90%** | 60, 17 ms, 55% | 31, 67 ms, 91% | 60, 17 ms, 59% | 33, 67 ms, 75% |
| Replaying the 10k thread at 4×: fps, p95, long tasks | 58, 17 ms, 0.3 s | 26, 117 ms, 0.9 s | 58, 17 ms, 0.3 s | 23, 117 ms, 2.0 s | 58, 17 ms, 0.3 s | 26, 100 ms, 2.4 s |
| Replay moments played in 10 s | 65 | 36 | 64 | 34 | 61 | 37 |
| Opening the 10k thread: ready to replay, longest task | 2.1 s, 101 ms | 2.2 s, 434 ms | 1.9 s, 123 ms | 1.9 s, 505 ms | 4.0 s, 125 ms | 2.6 s, 336 ms |
| Times its steps were downloaded on open | **6× (72 MB)** | 2× | 5× (61 MB) | 2× | 4× (49 MB) | 1× |
| JS heap: at rest / with the thread open | 12 / 149 MB | 20 / 127 MB | 8 / 131 MB | 16 / 154 MB | 7 / 110 MB | 18 / 89 MB |

**Bundle** (`vite build`): 879 KB of JS, 306 KB gzipped. The first load is `index` JS and CSS, 286 KB (90 KB gzipped);
the map view adds the graph library chunk (`FitButton-*.js`, 258 KB) and `MapView` (39 KB); the diff viewer
(`index-*.js`, 157 KB, with its 70 KB worker and 40 small language chunks) loads on demand. Plus a render-blocking
stylesheet from Fontshare.

### What falls over, or nearly

Nothing timed out and every page rendered. These are the worst numbers, most important first:

1. **The map stops at 800 files.** `MAX_FILES = 800` in `app/server/src/mapper/mapper.service.ts`: a 5k or 20k-file
   repo shows the first 800 files in folder order (here `apps/` and the first packages: 3 of 25 modules), with no sign
   that the rest is missing. Edits to files past the cap add them one by one as they happen.
2. **A big project keeps the server busy after it answers, and doubles its memory.** The map is capped, but the
   server still works through the whole repo after it answers, most likely the file watcher (chokidar on the whole
   repo, with an `existsSync` and a `statSync` per path in its `ignored` callback): 8 more seconds at up to 93% of a core, 4.6 CPU seconds in all (1.0 s at 1k files), and 323 MB with no threads
   (127 MB at 1k).
3. **The server can't answer while it reads history it hasn't seen.** On a cold boot the 10k-step thread is parsed
   before the server listens: 3.3–5.6 s of "Connecting…" here (5–10 s in the busier first pass), 2–3 CPU seconds that
   grow with the number of steps. A project with months of threads, on a slower machine, waits much longer. A warm
   restart is fine (1.5–2.4 s).
4. **Opening a long thread downloads it up to six times.** `/api/sessions/:id/steps` is 12 MB for 10k steps (reads
   carry their file's text, edits their diff), and `loadSteps` is called by several hooks at once with no shared
   request (`lib/thread.ts`, `lib/words.ts`, `map/StepPanel.tsx`): 1–6 parallel copies, up to 72 MB, a JS heap of
   110–154 MB, 2–4 s before the thread is ready, and single tasks up to 0.5 s at 4×. The server's RSS goes from about
   200 to 350–480 MB serving it.
5. **The map redraws every frame, even at rest.** It costs 18–20% of a core on an M1 Pro and 56–72% at 4× with
   nothing happening (`autoPauseRedraw={false}` in `MapView.tsx`). On a slow machine, anything on top drops below
   30 fps: panning and zooming at 4× runs at 22–35 fps with 1.9–3.3 s of long tasks per 10 s, and the live writer at
   21–33 fps with the main thread 75–91% busy.
6. **Replays slow down on slow machines.** At 4× CPU a 4× replay plays 34–37 moments in 10 s instead of 61–65, at
   23–26 fps, with up to 2.4 s of long tasks per 10 s.
7. **Smaller:**
   - `/api/map` is 1.1–1.2 MB for 800 files: about 1.4 KB a file, mostly absolute paths repeated in every edge.
   - Each live step sends about 4 messages (`step`, `agent`, `attention`, `step-update`): 11–15 a second for 3 steps.
     An `agent` message carries its whole trail, 2.4–2.7 KB each time.
   - Steps usually reach a websocket client in under 70 ms, but one or two per 20 s take about 2 s (seen at 5k and 20k files,
     in both passes).
   - `/api/failures` rebuilds from every step of every thread (82–144 ms) when its 10 s cache runs out, and each open
     page asks for it every 15 s.
   - The Fontshare stylesheet blocks the first paint: 260–1,250 ms on an empty cache here, and it's the one request
     that leaves the machine.

### What each number means

- **Map build:** the server's own log line, `built map … in N ms`: walking the repo, reading every file it maps,
  resolving imports, one `git log`.
- **Answers:** process start to the first `200` from `/api/health`. **Goes quiet:** until its CPU stays under 5%
  for 2 s. **CPU used:** the server process's CPU seconds at those two points.
- **Cold / warm:** a new database with a 10k-step thread in the logs (first launch on a busy project) / a restart on
  the same database (every other launch). "Thread listed" is until `/api/sessions` lists the thread with its last step.
- **API times:** a single request from Node, first call then second; sizes are the response body.
- **Memory:** the server's resident memory from `ps`. macOS compresses idle memory, so a single reading can drop; the
  peak is the highest reading over the run.
- **Live writer:** about 3 steps a second, a burst of 5–12 calls every 4–12 s, edits also changing the repo file.
  **Step latency:** from the timestamp in the log line to the websocket message reaching a Node client.
- **First map render:** navigation start to the first frame that paints at least half the files (canvas `fill()`
  calls). Empty cache is a new browser profile; cached is the reload after it.
- **Layout settling:** the 10 s after the first render, while the force layout moves the files.
- **At rest, panning, live, replay:** 10-second windows on the cached page. Panning drags from an empty spot and
  scrolls the wheel in and out. Replay opens the thread's link, presses Replay and picks 4×.
- **JS heap:** used heap from the DevTools protocol at the end of a window.

## The overnight pass (5–6 Oct 2026)

Three read-only audits (front end, server, code health) found where the time goes. The work was split into branches
that never edit the same files, each measured on its own, then merged into `perf/integrate` and checked together. None
of it is on `main` until the human says so.

### Where the time went

- **The map redrew every file, 60 times a second, forever,** including files off screen, and laid out names for files
  that couldn't be seen.
- **Every websocket message re-rendered the whole app,** and about eight components each rebuilt the same thread model
  and file lookup.
- **The server recomputed on timers:** failures read every step of every thread every 15 s; the attention sweep scanned
  the steps table every 2 s.
- **The first import blocked startup** and read whole logs into memory; a log over about 512 MB never imported.
- **On big repos, the file scanner** watched every folder, ran the whole `git log` synchronously, and rebuilt everything
  on each change.

### Before and after, same machine, back to back (5 Oct, 06:01–06:20)

`main` at `aba7993` against `perf/integrate` at `61bdb13`, the same benchmark run straight after each other on a quiet
machine (load average 2.4–8.3 on 8 cores; the baseline above ran at 15–119). Synthetic repos, a 10,000-step thread, a
live writer. The map shows 800 files in both (the cap is unchanged).

**Web app at 4× CPU** (roughly a mid-range laptop):

| | 1k files | 5k files | 20k files |
| --- | --- | --- | --- |
| At rest | 52.5 → 59.9 fps, main thread 82% → 3% busy | 49.2 → 59.9 fps, 86% → 2% | 50.2 → 59.9 fps, 86% → 2% |
| Panning and zooming | 15.6 → 56.9 fps (p95 117 → 17 ms) | 31.6 → 55.2 fps | 19.6 → 56.7 fps (p95 133 → 17 ms) |
| Live writer running | 16.6 → 60 fps | 18.2 → 59.2 fps | 19 → 59.9 fps |
| Replay at 4× | 24 → 59.5 fps | 24.4 → 60 fps | 27.4 → 60 fps |
| Opening the 10k-step thread | 2.2 → 0.96 s, steps fetched 5× → 1× | 1.8 → 0.95 s, 4× → 1× | 2.1 → 0.98 s, 5× → 1× |
| JS heap during replay | 96 → 38 MB | 120 → 46 MB | 81 → 47 MB |

At 1× CPU everything was already about 60 fps; the main thread at rest went from 23–25% to 3% busy, and while the live
writer runs from 40–88% to 10–14%.

**Server:**

| | 1k files | 5k files | 20k files |
| --- | --- | --- | --- |
| Cold boot, answering (thread never read) | 1.85 → 0.31 s | 2.11 → 0.34 s | 2.09 → 0.35 s |
| Cold boot, the long thread listed | 1.89 → 0.58 s | 2.25 → 0.80 s | 2.44 → 0.87 s |
| Empty boot, busy until | 0.65 → 1.01 s | 1.30 → 0.99 s | 3.55 → 0.88 s |
| CPU seconds until quiet (empty) | 0.63 → 0.63 | 1.58 → 0.83 | 4.73 → 0.91 |
| `/api/sessions` | 5.4 → 1.2 ms | 5.3 → 1.0 ms | 9.0 → 0.6 ms |
| Peak memory | 371 → 398 MB | 427 → 410 MB | 542 → 451 MB |
| Websocket messages per second, live | 14.6 → 6.6 | 10.9 → 5.3 | 14.0 → 6.3 |

Live latency (log line to websocket) stays 2–6 ms at the median. The JS bundle grew from 886 to 922 KB (+35 KB, 323 KB
gzipped), mostly the canvas branch's position cache and drawing code; the first load is 295 KB (93 KB gzipped). The
benchmark's "mapped" and "build ms" columns are empty on the new branch because the mapper's log line changed.

### What each branch did

Numbers are each branch's own measurements, mostly on a machine loaded by the other agents, so read them as ratios.

| Branch | What | Result |
| --- | --- | --- |
| `perf/canvas` | The map pauses when nothing moves; off-screen files skipped; colours, text widths and folder labels cached; theme shapes from cached pictures; idle import lines batched and hidden when zoomed out on big maps; no full layout restart on live updates; positions saved per project and theme (IndexedDB). `MapView.tsx` split from 1,237 to 413 lines (`graph.ts`, `color.ts`, `drawNode.ts`, `useMapCamera.ts`, `useLiveAgents.ts`) | 20k files at rest: 3–11 → 58–60 fps, main thread 86–89% → 3–4% busy (PS2 45%). 20k files at 4× CPU: the page used to stop answering for 4 minutes; now 58–59 fps at rest, 14–22 fps panning |
| `perf/replay-lists` | Replay trail cached in layers, per-cursor caches, binary search, the camera loop stops when settled; windowed Track list and file tree | 10k-step thread at 4× CPU: "Show every step" 1.8 → 0.7 s; scrolling Track 5–7 → 23–28 fps; full-detail replay 10–12 → 29–34 fps; Files search on 19k files 1.9 s → 37 ms |
| `perf/web-store` | Websocket messages applied once per frame; selector hooks; O(1) reducer updates; `structureVersion`; nav split into actions, state and cursor; the unused failures poll removed; one steps download per thread; the map chunk prefetched | 1,000 messages at 250/s: renders 556 → 229 (project) and 674 → 225 (thread open); 4 s of messages handled in 6.5 s and 4.9 s (was 13.9 s and 13.6 s); header renders ~600 → 0–1 |
| `perf/web-thread` | One shared thread build and file resolver for all components, incremental for live threads; cached chapters and timestamps | A "file" message across 8 views 115–294 → 0.4–2 ms; one new step 197–268 → 2.6–6.7 ms; identical output in 16,524 checks (`node app/web/scripts/perf-thread.mjs`) |
| `perf/server-ingest` | Import after the server starts; 4 MB chunked reads split on bytes; transactions and prepared statements; cached session list; masking before truncation; `/steps` built by SQLite and `?afterSeq=`; watching only the workspace's log folders | 561 MB of real logs: answering 12.4–13.7 → 0.9–1.2 s; full import 12.6–14.0 → 5.7–8.2 s while answering; peak memory 625–646 → 297–384 MB; a 600 MB log (never imported before) imports in 26 s at 220 MB; identical steps and `/steps` bytes |
| `perf/server-live` | Attention sweep on recent threads; labels set on the step before it's sent (fixes live steps arriving without labels); agent messages only on change, time updates at most once a second | Messages per live step 3.34 → 1.28; sweep 20 → 0.02 ms (316k steps: 92 → 0.08 ms); live labels on the first message 0/36 → 36/36 |
| `perf/mapper` | One ignore rule; files from `git ls-files` (respects `.gitignore`); one recursive watch instead of chokidar; changes batched every 100 ms; `git log` streamed and bounded; the 800 files chosen across every folder; `totalFiles`; `BRAINSTORM_MAX_FILES` | 20k repo: 21,028 watch handles (crashed) → 1; 60k commits: event loop blocked 4.9–14.4 s → 0.4–0.8 s; 2k changes: ~1,500–1,900 messages → 22; a 5k repo shows 25 of 25 folders (was 4). One change now reaches the page in 110–180 ms (was 3–55 ms) |
| `perf/server-pollers` | Failures and Places keep each thread's result until its steps change, reading only calls, edits and results | Same answers on a frozen copy of the real database (16/16); 147–152 → 21–24 ms |
| `fix/server-bugs` | Bus listeners isolated; screenshots load again in the step panel (only the unmounted full-screen Track used to trigger the scan) | A failing listener no longer drops the event for the others; a new thread's screenshot returns in 0.21 s |
| `fix/web-panels` | Places deep-link crash; risk labels styled; dark-theme contrast for code, output and JSON | `/thread/<id>/places/step/<id>` opens instead of crashing; dark-theme content at 7:1 or better |
| `refactor/web-dead-code` | Dead exports and CSS from removed views; the FilePanel ↔ MapView circular import | −328 lines, built CSS −15 KB (−16%), screens pixel-identical |
| `perf/bench` | This benchmark | Baseline above |

Tests: `cd app/server && npm test` (49 tests: listener reading and masking, sessions, steps, attention, agents, reader,
mapper, bus), `node app/web/scripts/perf-thread.mjs` (thread model equivalence).

### Left for later

- **Narrow hooks everywhere:** the map, replay and sidebar still read the whole store with `useLive()`/`useNav()`; moving
  them to `useLiveSelector`, `useNavState`, `useNavActions` and `useReplayCursor` is the biggest remaining front-end
  win, especially for the Track list.
- **Live agents in PS2 and Dead Space** stay slow at 4× CPU (about 7 fps at 5k files): a file with an agent on it still
  uses the old glow drawing.
- **Agent labels** ("Subagent · … · Editing") don't use the label space, so they can overlap file names.
- **Server:** light step payloads (fetch the full step when opened); coalesced file and summary broadcasts; the
  listener, reader and workspace split into smaller modules; one shared rule for failed results, call pairing and
  prompt cleanup.
- **Docs:** `docs/technical.md` still describes some removed views.

### Decisions for the human

1. **Merge `perf/integrate` into `main`?** It holds every branch above and has been checked together (tests, both
   typechecks, a production build, the app on real logs: live following, Track, replay with Lock camera, focus).
2. **"Ask about this thread"** only existed in the unmounted full-screen Track (`tasks/TrackView.tsx`). Move it into the
   sidebar's Track tab, or drop it? Then the old Track and its `/api/tasks` routes can go (the screenshot route stays).
   *Decided 5 Oct: dropped, with the old Track and its routes (`refactor/drop-old-track`).*
3. **Save the subagent id** with each step (a small schema change), so threads with parallel subagents group the same
   way after a reload as they do live.
4. **The file cap: decided 5 Oct, raised from 800 to 3,000.** On a 20k-file repo at 4× CPU, a 5,000-file map held
   51–60 fps at rest, panning, live and in replay (server quiet 3 s after boot, map payload 4.9 MB); 3,000 keeps the
   map readable. `BRAINSTORM_MAX_FILES` overrides it. Bigger repos say "showing 3,000 of 20,312 files" in the stats
   line, and the Files tab explains which files were chosen.
5. **Fonts.** The Fontshare stylesheet is the one request that leaves the computer and blocks the first paint for
   0.3–1.3 s on a cold cache. Self-host the fonts (license check needed) or use system fonts?
6. **`?mockmap`,** the dev-only fake map: keep it as a test fixture or delete it?
