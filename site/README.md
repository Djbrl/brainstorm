# Site (landing page)

One static file, `index.html`. No build step. Preview with `python3 -m http.server 4321 -d site`.

**Links:** edit the `SITE` object at the top of the `<script>` in `index.html` (`demo`, `install`, `guide`, `repo`, `award`, `numbers`, `video`). Every button that uses a link set to `null` is hidden.

**Waitlist:** both forms (header band, Roadmap section) POST `email` to `/api/waitlist` (`api/waitlist.js`, no dependencies), which saves `waitlist/<email>.json` in a private Vercel Blob store connected to the project. Set up once from `site/`: `vercel blob create-store brainstorm-waitlist --access private --yes`, then redeploy. Read the list: `vercel blob list --prefix waitlist/ --limit 1000`. Set `SITE.waitlist` to `null` to hide the forms. A temporary list until a proper waitlist tool.

**What's on it** (about 11 screens on a 1024×768 desktop, 9 on a phone), in order:
- **Hero** (`#hero`, 250vh, pinned). Title, "Try the live demo" and "Join the waitlist" on the first screen. The story's opening (one agent, then three running side by side, each in its own lane) plays on its own behind the title for ~7 s, low on the screen; scrolling carries it the rest of the way: captions, the three agents in the map, the zoom out to the whole map (one project: a big core of src/lib, src/api and src/ui with smaller modules around it, `MODS`) (fitted between the nav and the heading, `fitMap` in the `hero` script), then "Rundown shows you where." with the problem line (nobody reads 47 changed files, you look at a map), the legend and the buttons. An illustration, not product data.
- **Research** (`#stats`): one static row, three numbers that count up once in view, with the study titles.
- **Not just code** (`#tasks`, 250vh, pinned): an illustration of the Track view, one agent cutting a video with FFmpeg in five stops, one of them failed; the video frames are one SVG scene, `#stageScene`, reused.
- **NVIDIA** (`#brev`, dark): the planned first read on NVIDIA Nemotron, the animated GPU (`#chip`, drawn by a small script), why a GPU, and the hackathon numbers (81k lines, 73 s, $0.02).
- **Ask why**, **Privacy** (`#privacy`, three lines), **Install** (`#install`, one Claude Code window), **Roadmap** (`#roadmap`, Today / Late October / After, with the waitlist form), and the closing call to install.

**Phones** (below 700px): no pinned scenes. The hero shows its title and buttons, then the finished map as a still with its text; "Not just code" shows its last stop. The nav button is "Try the demo" instead of "Install". The scroll hook for previews: `window.__P = { hero: 0..1, tasks: 0..1, story: 0..1 }` (`story` sets the hero animation directly).

**Screenshots** in `img/` (`shot-*.jpg`, `map.png`, `failures.png`) are not shown on the page any more; the product scene that used them was removed. They come from the redacted demo recording (`?replay=/replay-next.json`), never from a live local session.

**Live:** https://brainstorm-landing.vercel.app (Vercel project `bountbi/brainstorm-landing`).

**Redeploy:** `cd site && vercel deploy --prod --yes`. `site/.vercel/` holds the project link and is gitignored; if it's missing, run `vercel link --project brainstorm-landing` first.
