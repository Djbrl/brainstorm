# Site (landing page)

One static file, `index.html`. No build step. Preview with `python3 -m http.server 4321 -d site`.

**Links:** edit the `SITE` object at the top of the `<script>` in `index.html` (`demo`, `install`, `guide`, `repo`, `contact`, `award`, `video`). Every button that uses a link set to `null` is hidden. Install buttons go to the page's own install section (`#install`).

**Deploying:** `sh tools/predeploy.sh && vercel deploy --prod --yes`. The check stops while the privacy or terms page still has a highlighted blank (name, address, country, city, contact email), and fetches the font if it's missing.

**Fonts:** Satoshi is served from `fonts/` (no visitor's browser talks to Fontshare). The files aren't in git, because the ITF Free Font License forbids making them available through a public repository: `sh tools/fetch-fonts.sh` downloads them, and `vercel deploy` uploads them (it reads `.vercelignore`, not `.gitignore`).

**Privacy and terms:** `privacy.html` and `terms.html` (styles in `legal.css`). Keep them true when what the app or the site collects changes.

**Project variables (Vercel):** `UNSUBSCRIBE_SECRET` (any long random string: signs the unsubscribe and confirm links and fingerprints unsubscribed addresses; never change it once the list exists), `RESEND_API_KEY` and `RESEND_FROM` (the confirmation email's sender, as in `tools/release-email.mjs`), `CRON_SECRET` (the same for the daily retention job), `STATS_TOKEN` (the admin page). Set one with `vercel env add UNSUBSCRIBE_SECRET production`.

**Usage stats retention:** `vercel.json` runs `api/usage-prune.js` every day; it deletes reports older than 13 months. `api/usage-forget.js` deletes one install's reports (found through the per-install index `usage-index/<id>/<day>.json` that `api/usage.js` writes with each report; run `tools/index-usage.mjs` once to index older reports) The same job forgets signups nobody confirmed within 30 days (Settings → Delete the stats already sent).

**Sending the release email:** with Resend, from `tools/release-email.mjs` (setup and commands at the top of that file): a dry run by default, `--test you@example.com` for one copy, `--yes` to send to everyone. Each message gets its own unsubscribe link and the one-click unsubscribe headers; unsubscribing (`unsubscribe.html` → `api/unsubscribe.js`) deletes the address. It goes to confirmed addresses only. The message is `tools/release-email.html`. Never commit a recipients CSV.

**Release email:** the one form (Roadmap section) POSTs JSON `{email}` to `/api/waitlist` (`api/waitlist.js`, no dependencies), which saves `waitlist/pending/<email>.json` in a private Vercel Blob store connected to the project and emails a confirm link (Resend). The link goes to `confirm.html`, whose button posts to `api/waitlist-confirm.js`: the record moves to `waitlist/confirmed/`, the only addresses the release email goes to. Unsubscribing deletes every record of the address and leaves `waitlist/unsubscribed/<fingerprint>.json` (an HMAC of the address, not the address), so a later signup isn't added again. Layout of the store: `api/_waitlist.js`. Set up once from `site/`: `vercel blob create-store brainstorm-waitlist --access private --yes`, then redeploy. Read the list: `vercel blob list --prefix waitlist/confirmed/ --limit 1000`. Records from before the confirmation step (`waitlist/<email>.json`) are not sent to: `tools/migrate-waitlist.mjs` moves them if you decide they count. Set `SITE.waitlist` to `null` to hide the forms.

**What's on it** (about 13 screens at 1440×900, 10 on a phone), in order:
- **Band** (desktop only): "Rundown 0.8.1 is out", one link to Install.
- **Hero** (`#hero`, 300vh, pinned): the title with Install for Claude Code and Try the live demo, then the three agents' story on the map (`hero` script, an illustration, not product data), ending on "We give you the rundown."
- **Every agent. Every project.** (`#crew`): an app window drawn as SVG (`agentMap`), three agents moving between files, Find a thread over it.
- **Claude Code. Codex. One map.** (`#codex`): the threads list in two groups beside one map with an agent of each.
- **Research** (`#stats`): two numbers that count up once in view, with their studies.
- **Not just code** (`#tasks`, 300vh, pinned): six features, each with a small picture (Track, Places, Codex, commands as edits, live states and notifications, replay and share).
- **Ask why** (the typed question and a grounded answer), **Install** (`#install`, Rundown ink, one Claude Code window, the usage-stats line with the opt-out), **Roadmap** (`#roadmap`, Today / Late October / After, with the release-email form), and the closing.
- **Share image:** `img/og.png` (1200×630) in the `og:` and `twitter:` tags, which use the absolute URL of the live site. Change them if the domain changes.

**Live:** https://brainstorm-landing.vercel.app

**Redeploy:** `cd site && vercel deploy --prod --yes`. `site/.vercel/` holds the project link and is gitignored; if it's missing, run `vercel link --project brainstorm-landing` first.
