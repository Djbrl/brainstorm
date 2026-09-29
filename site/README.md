# Site (landing page)

One static file, `index.html`. No build step. Preview with `python3 -m http.server 4321 -d site`.

**Links:** edit the `SITE` object at the top of the `<script>` in `index.html` (`demo`, `install`, `guide`, `repo`, `award`, `numbers`, `video`). Every button that uses a link set to `null` is hidden.

**Waitlist:** both forms (header band, Roadmap section) POST `email` to `/api/waitlist` (`api/waitlist.js`, no dependencies), which saves `waitlist/<email>.json` in a private Vercel Blob store connected to the project. Set up once from `site/`: `vercel blob create-store brainstorm-waitlist --access private --yes`, then redeploy. Read the list: `vercel blob list --prefix waitlist/ --limit 1000`. Set `SITE.waitlist` to `null` to hide the forms. A temporary list until a proper waitlist tool.

**What's on it:** a live map of your agents. The hero scroll story (an illustration), the problem, the research, a carousel of real screenshots, "Not just code" (an illustration of the Track view: one agent cutting a video with FFmpeg, with a failed step; the video frames are one SVG scene, `#stageScene`, reused), Ask, NVIDIA (the planned first read on Nemotron, with the numbers measured at the hackathon), the roadmap with the waitlist, the install steps, privacy, and the closing call to install.

**Screenshots** in `img/` come from the redacted demo recording, never from a live local session: `replay.jpg` (Map replaying a thread), `follow.png`, `map.png`. `failures.png` is the hackathon's Failures view, no longer shown.

**Live:** https://brainstorm-landing.vercel.app (Vercel project `bountbi/brainstorm-landing`).

**Redeploy:** `cd site && vercel deploy --prod --yes`. `site/.vercel/` holds the project link and is gitignored; if it's missing, run `vercel link --project brainstorm-landing` first.
