# Tasks

Every agent session told as a task you can replay: the goal, a filmstrip of what the agent saw, how it did it, what it made, and where it got things. It's for work that isn't code as much as for code: editing a video with FFmpeg, writing a document, researching the web, testing an app in a browser. The product thinking is in [roadmap.md](roadmap.md) ("Tasks"). It builds on the places classifier from the Cowork prototype ([cowork.md](cowork.md)).

Branch: `feature/tasks` (from `main`, with `feature/cowork` merged in). Local app only.

## What you see

- **Task list:** every session in the workspace, newest first, with its first request as the title, a kind (Code, Web, Media, Writing, Other), and how many frames and files it has. A green dot means the agent is working now.
- **The goal:** the first request, and how many more requests followed.
- **Filmstrip player:** the screenshots the agent's tools took (in-app browser, Chrome, computer use, simulator), in order, with the step that took each one.
  - Play, pause, frame by frame (the arrow keys work), speed 1×, 2× or 4×.
  - On a live task, **Follow live** keeps the newest frame in view: a picture-in-picture of what the agent is looking at, refreshed every 3 seconds.
- **How it did it:** the work in stretches. Each stretch is one of your requests (highlighted) or the agent saying what it's about to do, followed by the calls it made in plain words.
  - Commands use the agent's own one-line description.
  - FFmpeg commands have a **How this command works** list, with every option in plain words.
  - ◉ jumps the player to what the agent saw at that step, and the step shown in the player is highlighted.
- **What it made:** files it wrote or edited, and files commands produced (FFmpeg, ImageMagick, pandoc, `cp`, `mv`, `zip`, `tar`, `curl -o`, `>` redirects), filterable by Media, Writing, Code and Data.
  - Images, video stills, PDFs and text open in a preview.
  - Videos and sound play in the preview.
- **Outside this computer:** what it sent, published, deployed or pushed, from the places classifier.
- **Where it got things:** the websites it visited or searched, with page titles and links, and the files it used as inputs.

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
- `app/web/src/tasks/`: `TasksView.tsx` and `tasks.css`.

## Privacy

Everything stays on this computer: the server listens on 127.0.0.1 only, and a file is served only if the task made or used it.

Screenshots and file previews are **not part of any replay export**. When replays can be shared, sharing a task will need either a clear warning ("this includes screenshots of everything the agent saw") or redaction first.

## Next

1. Live file previews: refresh a thumbnail when an output file changes, not only on reload.
2. Explain more tools the FFmpeg way: ImageMagick, pandoc, yt-dlp, git.
3. A task can span several sessions, or be one request inside a long session. Let people split and merge tasks.
4. Merge the places map into the main map ([cowork.md](cowork.md), "one map, not two tabs").
5. Reach agents that keep no local logs (Cowork, ChatGPT's agent). See the roadmap.
