# Tasks

Every agent session told as a task you can replay: the goal, a filmstrip of what the agent saw, how it did it, what it made, and where it got things. It's for work that isn't code as much as for code: editing a video with FFmpeg, writing a document, researching the web, testing an app in a browser. The product thinking is in [roadmap.md](roadmap.md) ("Tasks"). It builds on the places classifier from the Cowork prototype ([cowork.md](cowork.md)).

Shipped in plugin 0.2 (29 Sep 2026), merged from `feature/tasks`. Local app only: the hosted demos have no Tasks API.

## What you see (updated 5 Oct)

A thread opens on the map, and its steps sit next to it in the sidebar's **Track** tab (the sidebar's tabs: Threads, Track, Files). Scrolling the Track moves the tracer on the map; clicking a step opens it in the side panel. The dock has **Replay** for every thread (it plays from the start) and **Live** / **Follow live** for a running one. On the Places lens, the Track tab lists the thread's places instead.

The full-screen Track (one vertical line of stops with a window on the right: screenshots, images and video it made, code, commands) was a lens of its own from 28 Sep to 5 Oct. It hid the map, so it's no longer mounted; `/thread/<id>/track` links open the map. `tasks/TrackView.tsx` stays in the tree until its best parts (screenshots, made files) move into the sidebar's Track.

- **Errors:** a failed tool call turns the agent's marker red with one red ring (live and in replay). It shows red in Follow with the first line of the error, as red ticks on the replay bar, and as red rows in the Track.

## How it works

- `app/server/src/tasks/shots.service.ts` reads screenshots from Claude Code's session logs.
  - Tool results carry them as base64 JPEG or PNG, about 30 KB each.
  - It stores them in the local database (`task_shots`), keyed by the result step's id, and reads only new bytes of each log (`task_shot_files`).
  - Screenshots survive Claude Code's 30-day log cleanup.
- `app/server/src/tasks/tasks.service.ts` builds a task from the listener's steps:
  - pairs calls with results in order;
  - runs the places classifier (`cowork/classify.ts`) for web and service actions;
  - reads Bash commands for the files they write and read (`tasks/commands.ts`).
  - Results are cached per session until the steps or screenshots change.
- API:
  - `GET /api/tasks`: the list.
  - `GET /api/tasks/:sessionId`: one task (`TaskDetail` in `types.ts`).
  - `GET /api/tasks/shot/:stepId/:idx`: a screenshot.
  - `GET /api/tasks/:sessionId/file?path=[&frame=1]`: a file the task made or used. `frame=1` returns a still of a video, made with FFmpeg if it's installed and cached in `data/previews`.
- `app/web/src/map/sidebar/TrackPanel.tsx` (the Track tab) shows `map/replay/ReplaySteps.tsx`, or `cowork/PlaceSteps.tsx` on Places. `app/web/src/tasks/TrackView.tsx` is the old full-screen Track, not mounted; `track.css` still styles the Map | Places switch (`map/LensSwitch.tsx`).

## Privacy

Everything stays on this computer: the server listens on 127.0.0.1 only, and a file is served only if the task made or used it.

Screenshots and file previews are **not part of any replay export**. When replays can be shared, sharing a task will need either a clear warning ("this includes screenshots of everything the agent saw") or redaction first.

## Next

1. Live file previews: refresh a thumbnail when an output file changes, not only on reload.
2. Explain more tools the FFmpeg way: ImageMagick, pandoc, yt-dlp, git.
3. A task can span several sessions, or be one request inside a long session. Let people split and merge tasks.
4. Merge the places map into the main map ([cowork.md](cowork.md), "one map, not two tabs").
5. Reach agents that keep no local logs (Cowork, ChatGPT's agent). See the roadmap.
