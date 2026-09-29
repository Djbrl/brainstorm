# Tasks

Every agent session told as a task you can replay: the goal, a filmstrip of what the agent saw, how it did it, what it made, and where it got things. It's for work that isn't code as much as for code: editing a video with FFmpeg, writing a document, researching the web, testing an app in a browser. The product thinking is in [roadmap.md](roadmap.md) ("Tasks"). It builds on the places classifier from the Cowork prototype ([cowork.md](cowork.md)).

Shipped in plugin 0.2 (29 Sep 2026), merged from `feature/tasks`. Local app only: the hosted demos have no Tasks API.

## What you see (updated 28 Sep, evening)

There is no separate Tasks tab anymore. A thread is picked once, and the Map tab shows it two ways, switched at the top: **Map** (where in the code it happened) and **Track** (the story, top to bottom).

- **Sidebar, same on both:**
  - Clicking a thread plays it. A running thread pulses blue and plays live, following its newest step; opening the Map picks the newest running thread by itself.
  - The open thread's steps fill the sidebar. Clicking the open thread again, or × on the player, closes it. **Open in Follow** is on the player and opens Follow at the step you're on.
  - Going to the newest step of a running thread (the end of the slider, or the bottom of the Track) follows it live again.
- **Track:**
  - One vertical line. Each stop is a stretch of work in one place (a file, a website, a command-line tool, a service), with an icon for what happened: made a file, edited, read, searched, ran, browsed, used a service.
  - Going back to an earlier place is a compact "Back to …" row; three or more in a row fold into "Back and forth between …".
  - Your requests are chapters. New files are square stops with their names.
  - The window on the right stays in view and shows the stop you're on: the screenshot, the image or video it made, the code it wrote, or the command (FFmpeg explained). It also has Open in Follow and Show on map.
- **Errors:** a failed tool call turns the agent's marker red with one red ring (live and in replay). It shows red in Follow with the first line of the error, as red ticks on the replay bar, and as red stops with the error text in the Track.

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
- `app/web/src/tasks/`: `TrackView.tsx` and `track.css`. The Map | Track switch is `app/web/src/map/LensSwitch.tsx`.

## Privacy

Everything stays on this computer: the server listens on 127.0.0.1 only, and a file is served only if the task made or used it.

Screenshots and file previews are **not part of any replay export**. When replays can be shared, sharing a task will need either a clear warning ("this includes screenshots of everything the agent saw") or redaction first.

## Next

1. Live file previews: refresh a thumbnail when an output file changes, not only on reload.
2. Explain more tools the FFmpeg way: ImageMagick, pandoc, yt-dlp, git.
3. A task can span several sessions, or be one request inside a long session. Let people split and merge tasks.
4. Merge the places map into the main map ([cowork.md](cowork.md), "one map, not two tabs").
5. Reach agents that keep no local logs (Cowork, ChatGPT's agent). See the roadmap.
