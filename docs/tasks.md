# Tasks

Every agent session told as a task you can replay: the goal, a filmstrip of what the agent saw, how it did it, what it made, and where it got things. It's for work that isn't code as much as for code: editing a video with FFmpeg, writing a document, researching the web, testing an app in a browser. The product thinking is in [roadmap.md](roadmap.md) ("Tasks"). It builds on the places classifier from the Cowork prototype ([cowork.md](cowork.md)).

Shipped in plugin 0.2 (29 Sep 2026), merged from `feature/tasks`. Local app only: the hosted demos have no screenshots.

## What you see (updated 5 Oct)

A thread opens on the map, and its steps sit next to it in the sidebar's **Track** tab (the sidebar's tabs: Threads, Track, Files). Scrolling the Track moves the tracer on the map; clicking a step opens it in the side panel. The dock has **Replay** for every thread (it plays from the start) and **Live** / **Follow live** for a running one. On the Places lens, the Track tab lists the thread's places instead.

The full-screen Track (one vertical line of stops with a window on the right: screenshots, images and video it made, code, commands) was a lens of its own from 28 Sep to 5 Oct. It hid the map, so it was unmounted early on 5 Oct (`/thread/<id>/track` links open the map), and later that day it was removed with its "Ask about this thread" box and the Tasks API behind it. What replaced them: the sidebar's Track tab for the story, the step panel for a step's screenshots, and Ask about a step or a file.

- **Errors:** a failed tool call turns the agent's marker red with one red ring (live and in replay). It shows red in Follow with the first line of the error, as red ticks on the replay bar, and as red rows in the Track.

## How it works

- `app/server/src/shots/shots.service.ts` reads screenshots from Claude Code's session logs.
  - Tool results carry them as base64 JPEG or PNG, about 30 KB each.
  - It stores them in the local database (`task_shots`), keyed by the result step's id, and reads only new bytes of each log (`task_shot_files`).
  - Asked for one it doesn't have, it reads what's new in that step's session logs and looks again; a miss is remembered for 30 s.
  - Screenshots survive Claude Code's 30-day log cleanup.
- API: `GET /api/tasks/shot/:stepId/:idx`, one screenshot (`shots/shots.controller.ts`; the URL kept its old prefix). The step panel shows them (`app/web/src/follow/content/ToolView.tsx`).
- `app/web/src/map/sidebar/TrackPanel.tsx` (the Track tab) shows `map/replay/ReplaySteps.tsx`, or `cowork/PlaceSteps.tsx` on Places. The Map | Places switch is `map/LensSwitch.tsx` with `map/lens.css`.
- Removed on 5 Oct: `GET /api/tasks`, `GET /api/tasks/:sessionId` and `GET /api/tasks/:sessionId/file` (it served files the agent made or used, with FFmpeg stills of videos), `tasks.service.ts`, `tasks/commands.ts` (files a Bash command writes and reads, FFmpeg flags explained), the `Task*` types, `web/src/tasks/TrackView.tsx` and `track.css`. They're in git history before that date if the made-files strip or the FFmpeg explanations come back into the sidebar's Track.

## Privacy

Everything stays on this computer: the server listens on 127.0.0.1 only. Since 5 Oct it no longer serves files agents touched.

Screenshots are **not part of any replay export**. When replays can be shared, sharing a task will need either a clear warning ("this includes screenshots of everything the agent saw") or redaction first.

## Next

1. What a thread made (images, video, documents) in the sidebar's Track, with previews.
2. Explain commands in plain words (FFmpeg flags, ImageMagick, pandoc, yt-dlp, git).
3. A task can span several sessions, or be one request inside a long session. Let people split and merge tasks.
4. Merge the places map into the main map ([cowork.md](cowork.md), "one map, not two tabs").
5. Reach agents that keep no local logs (Cowork, ChatGPT's agent). See the roadmap.
