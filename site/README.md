# Site (landing page)

One static file, `index.html`. No build step. Preview with `python3 -m http.server 4321 -d site`.

**Links:** edit the `SITE` object at the top of the `<script>` in `index.html` (`demo`, `install`, `guide`, `repo`, `contact`, `award`, `video`). Every button that uses a link set to `null` is hidden. Install buttons go to the page's own install section (`#install`).

**Deploying:** `sh tools/predeploy.sh && vercel deploy --prod --yes`. The check stops while the privacy or terms page still has a highlighted blank (name, address, country, city, contact email), and fetches the font if it's missing.

**Fonts:** Satoshi is served from `fonts/` (no visitor's browser talks to Fontshare). The files aren't in git, because the ITF Free Font License forbids making them available through a public repository: `sh tools/fetch-fonts.sh` downloads them, and `vercel deploy` uploads them (it reads `.vercelignore`, not `.gitignore`).

**Privacy and terms:** `privacy.html` and `terms.html` (styles in `legal.css`). Keep them true when what the app or the site collects changes.

**Project variables (Vercel):** `UNSUBSCRIBE_SECRET` (any long random string: signs the release email's unsubscribe links), `CRON_SECRET` (the same for the daily retention job), `STATS_TOKEN` (the admin page). Set one with `vercel env add UNSUBSCRIBE_SECRET production`.

**Usage stats retention:** `vercel.json` runs `api/usage-prune.js` every day; it deletes reports older than 13 months. `api/usage-forget.js` deletes one install's reports (Settings → Delete the stats already sent).

**Sending the release email:** `vercel env pull tools/.env.local && node --env-file=tools/.env.local tools/release-email.mjs > recipients.csv` gives each address its unsubscribe link and the two headers for one-click unsubscribe; `tools/release-email.html` is the message, with the footer the law requires (unsubscribe link, postal address). Unsubscribing (`unsubscribe.html` → `api/unsubscribe.js`) deletes the address. Never commit the CSV.

**Release email:** the one form (Roadmap section) POSTs `email` to `/api/waitlist` (`api/waitlist.js`, no dependencies), which saves `waitlist/<email>.json` in a private Vercel Blob store connected to the project. Set up once from `site/`: `vercel blob create-store brainstorm-waitlist --access private --yes`, then redeploy. Read the list: `vercel blob list --prefix waitlist/ --limit 1000`. Set `SITE.waitlist` to `null` to hide the forms. A temporary list until a proper waitlist tool.

**What's on it** (about 13 screens at 1440×900, 10 on a phone), in order:
- **Band** (desktop only): "Rundown 0.6 is out", one link to Install.
- **Hero** (`#hero`, 300vh, pinned): the title with Install for Claude Code and Try the live demo, then the three agents' story on the map (`hero` script, an illustration, not product data), ending on "We give you the rundown."
- **Every agent. Every project.** (`#crew`): an app window drawn as SVG (`agentMap`), three agents moving between files, Find a thread over it.
- **Claude Code. Codex. One map.** (`#codex`): the threads list in two groups beside one map with an agent of each.
- **Research** (`#stats`): two numbers that count up once in view, with their studies.
- **Not just code** (`#tasks`, 300vh, pinned): six features, each with a small picture (Track, Places, Codex, commands as edits, live states and notifications, replay and share).
- **Ask why** (the typed question and a grounded answer), **Install** (`#install`, Rundown ink, one Claude Code window, the usage-stats line with the opt-out), **Roadmap** (`#roadmap`, Today / Late October / After, with the release-email form), and the closing.
- **Share image:** `img/og.png` (1200×630) in the `og:` and `twitter:` tags, which use the absolute URL of the live site. Change them if the domain changes.

**Screenshots** in `img/` (`shot-*.jpg`, `map.png`, `failures.png`) are not shown on the page any more; the product scene that used them was removed. They come from the redacted demo recording (`?replay=/replay-next.json`), never from a live local session.

**Live:** https://brainstorm-landing.vercel.app (Vercel project `bountbi/brainstorm-landing`).

**Redeploy:** `cd site && vercel deploy --prod --yes`. `site/.vercel/` holds the project link and is gitignored; if it's missing, run `vercel link --project brainstorm-landing` first.
