# Thread replay on the Map (spec)

Branch `feature/thread-replay` (from `post-deadline`), worktree `.claude/worktrees/thread-replay`. Web only, no server changes. Must work in the static replay build (`?replay=/replay.json`) and the live app.

## What the human wants

A replay of one thread (session) on the Map: a tracer shows the agent's course through the files, step by step. You can scroll back and forth and stop on any step. It sits between Follow and Map.

A floating **left** sidebar on the Map with two tabs:
- **Threads:** the threads, with Replay and Open in Follow, plus show/hide per agent (the old agent tracker folds in here).
- **Files:** a normal file tree of the codebase.

## Decisions (human)

- **Every step is a beat** you can stop on. **The tracer only moves on edits** (`TRACER_MOVES_ON` in `lib/thread.ts`). A read briefly flashes its file without moving the tracer. Other steps keep the tracer in place.
- **Scroll on the map moves the tracer** during a replay, one beat per wheel notch. Zoom during a replay: pinch, ⌘/Ctrl+scroll, or the +/− buttons. Outside a replay, scroll zooms as before.
- **Scrolling the step list also moves the tracer.** Both stay in sync.
- **Agents can be hidden and shown** in the tracker (`nav.hiddenAgents`, `nav.toggleAgent`, saved in localStorage).
- **Same visual language** as the existing map and `map/agents.tsx`: `agentColor`, the accent, the recency colors. Apple-style light UI: no eyebrow labels, no stacked cards.

## Foundation (done, commit 8705879; don't change the APIs, only add to them)

- `lib/paths.ts`: `makeFileResolver(map)` matches any absolute path, including other worktrees of the repo (`<repo>/.claude/worktrees/<name>/…`), to a map node id, or null.
- `lib/thread.ts`: `useThread(sessionId)` returns a `Thread`, which has:
  - `beats[]`: `{ index, step, action: "edit" | "read" | "other", file, outside, moveIndex }`
  - `moves[]`: the tracer path, `{ beatIndex, file, ts }`, one entry per change of file
  - `files`, `touched`
  It loads the session's steps if missing.
- `lib/nav.tsx`:
  - `replay: { sessionId, index, playing, speed } | null`
  - `startReplay(sessionId, index?)` switches to the Map
  - `setReplayIndex(i | fn)`, `setReplayPlaying`, `setReplaySpeed`, `stopReplay`
  - deep link `?view=map&thread=<id>&beat=<n>`
  - `hiddenAgents`, `toggleAgent(id)`, `setHiddenAgents(ids)`
- `map/MapView.tsx` already:
  - renders `<MapSidebar …/>` (left) and `{replay && <ReplayBar />}`
  - calls `useReplayLayer(…)`, draws its layer every frame, and multiplies node alpha by `nodeAlpha(id)`
  - hides hidden agents, and all live agents during a replay
  - matches live agents across worktrees

## Ownership (only edit your own files)

| Agent | Owns |
| --- | --- |
| Sidebar | `app/web/src/map/sidebar/**` (new CSS in `sidebar/sidebar.css`) |
| Replay | `app/web/src/map/replay/**` (CSS in `replay/replay.css`), plus a "Replay on map" button in `app/web/src/follow/FollowView.tsx` |

Need a change elsewhere (`MapView.tsx`, `lib/*`, `agents.tsx`)? Note it at the end of this file under "Requests" and continue with a workaround.

## Checks before you finish

- `cd app/web && npx tsc --noEmit -p . && npx vite build` pass.
- Try it in the replay build: `cd app/web && npx vite --port 5199`, then open `http://localhost:5199/?replay=https://brainstorm-demo-black.vercel.app/replay.json&view=map`. The dev server serves `src/`, and the replay JSON is fetched from the hosted demo.
- Commit your files only, with the prefix `[sidebar]` or `[replay]`. Don't push.

## Requests
- [replay → lead] `MapView.tsx`: clear `followId` when a replay starts (`useEffect(() => { if (replay) setFollowId(null); }, [replay?.sessionId])`). Otherwise the agent-follow camera loop keeps pulling toward a stale marker and fights the replay camera. DONE 2528d56
- [replay → lead] `map.css`: `.map-wrap { overflow: clip; }` would stop `scrollIntoView` (focus, automation) from scrolling the map sideways; seen once while testing. Optional. DONE 2528d56
- [replay, FYI] `replay/replay.css` hides `.map-legend` while the ReplayBar is shown (`.map-wrap:has(.rp-bar) .map-legend`), since both sit bottom-left/center and the replay dims most files anyway.
