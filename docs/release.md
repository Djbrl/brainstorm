# Releasing the plugin

A release is a commit on `main` that holds a new `plugin/build`, with the version bumped, tagged and pushed. People get it the next time Claude Code updates its plugins. Agents prepare everything up to the commit and the tag; pushing is the maintainer's.

Never move the tag `hackathon-submission`, and never redeploy the judged demo (brainstorm-demo-black.vercel.app).

## 1. Check the code

From a clean `main` (`git status` shows nothing to commit):

```bash
cd app/server && npm install && npm test && npm run typecheck
cd ../web && npm install && npm run typecheck && npm test
```

`npm install` first: the dependencies change from time to time (the web's tests need vitest, added in the cleanup's Phase 6).

Everything passes, on Node 22.13 (`.nvmrc`) as well as on the Node you use day to day.

## 2. Bump the version

The version lives in one file that matters to Claude Code: `plugin/.claude-plugin/plugin.json` (`"version"`). Raise it: the last number for fixes (0.8.1 → 0.8.2), the middle one for new features (0.8.1 → 0.9.0).

Then find every other place that names the old version, and update the ones that describe the current release:

```bash
git grep -n "0\.8\.1" -- . ':!plugin/build' ':!docs/archive' ':!docs/build-log.md' ':!**/package-lock.json'
```

Usually that is `README.md` ("Rundown is a preview (version …)"), `plugin/README.md` ("Preview release (…)"), and on the landing page (its own repository, `rundown-site`) `index.html` and `README.md`. The build log keeps old versions on purpose. `app/server/package.json` and `app/web/package.json` stay at 0.1.0: they are not published.

## 3. Build

```bash
cd app && node scripts/build-plugin.mjs
```

This rebuilds `plugin/build`: `server.js` (the server in one file), `web/` (the app it serves), `share.html` (the page a shared thread goes into), `THIRD_PARTY_NOTICES.md` and `build.json` (the commit it was built from, printed when the server starts). Build from a committed tree, or `build.json` says `-dirty`.

Then check that the build on disk is the one the code makes:

```bash
cd app && node scripts/build-plugin.mjs --check
```

It builds again into a temporary folder and compares it with `plugin/build`, file by file. "plugin/build is up to date" means you can commit it. A list of changed files means something moved between the two (a file edited after the build): rebuild.

## 4. Try it live

Install the build you just made in a real Claude Code session, on a project with some history, and try the three commands:

| Command | What you should see |
| --- | --- |
| `/rundown:open` | Rundown opens beside the thread (desktop app) or in the browser, on this project. The server's log (`server.log` in `~/.claude/plugins/data/rundown-rundown/`) starts with `Rundown <new version> (<commit>)`. Threads load, the agent moves on the map while the session works |
| `/rundown:share` | A replay `.html` file and a Markdown summary are saved. The `.html` opens in a browser with nothing installed, shows the map and every step, and has no home folder, computer name or key in it |
| `/rundown:stop` | The server stops. `/rundown:open` starts it again |

Also open a thread with a failed step, and the Places view, once each. If an Anthropic key is set, ask one question.

## 5. Commit and tag

```bash
git add plugin/.claude-plugin/plugin.json plugin/build README.md plugin/README.md
git commit -m "[plugin] 0.8.2: <what changed, in a few words>"
git tag -a v0.8.2 -m "Rundown 0.8.2"
```

Add a line to `docs/build-log.md` (date, time, version, what changed) in the same commit.

## 6. Release notes

A few lines for people who use Rundown, not for engineers: what's new, what's fixed, anything they have to do (a new session, a setting). Write them from `git log <previous tag>..HEAD --oneline` and the build log. They go in the GitHub release and, when the release is worth announcing, on the landing page's band.

## 7. Push (the maintainer)

```bash
git push origin main --follow-tags
gh release create v0.8.2 --title "Rundown 0.8.2" --notes-file notes.md
```

If the landing page changed: `cd ~/rundown-site && vercel deploy --prod --yes` (it has its own repository since 12 Oct 2026).

After the push, update the plugin in a Claude Code session (`/plugin`, then update Rundown, then a new session) and run `/rundown:open` once more: the log should name the new version.
