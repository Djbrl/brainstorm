# Site (landing page for the jury)

One static file, `index.html`. No build step. Preview with `python3 -m http.server 4321 -d site`.

**To update on the day, edit only the `SITE` object at the top of the `<script>` in `index.html`:**
- `links.video`, `links.demo`, `links.repo`: buttons stay hidden while a link is `null`.
- `stats`: copy values from `docs/numbers.md` only. A `null` value is hidden, never guessed.
- `brev`: GPU, $/hour and vLLM version from `docs/brev-setup.md`.
- `self`: sessions, steps and files from Brainstorm's own db.
- `team`: names and roles.

**Screenshots:** drop real PNGs (16:10, taken from the running app) at `img/follow.png`, `img/map.png`, `img/history.png`. Missing files show a placeholder frame.

**Deploy:** Vercel, root directory `site/`, framework "Other", no build command.
