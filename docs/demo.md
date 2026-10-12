# The hosted demo

Two recorded demos are online. Neither needs a server: each is the web app built as static files with a recording.

| Demo | What | Built from |
| --- | --- | --- |
| brainstorm-demo-black.vercel.app | The judged hackathon demo | Its own frozen build (the tag `hackathon-submission`). Never redeploy it and never touch its Vercel project. |
| brainstorm-next.vercel.app | The current app playing a recent recording, with agents moving on the Map and a recorded setup run | `npm run build:demo` in `app/web`, with a recording made by `app/scripts/record-demo.mjs` |

The rest of this page is about brainstorm-next. Building and recording are for agents; deploying is the maintainer's.

## What only the demo has

- `app/web/src/lib/preview.ts` plays the recording's agent moves on the Map and answers the setup screen from the recorded setup run (it stands in for `/api/workspace`).
- The "Setup preview" button and the banner pointing to the plugin (`App.tsx`).
- They load only in a demo build (`VITE_DEMO=1`). A normal build, the plugin's and the share file's included, leaves them out: the flag is replaced at build time and the import is dropped.

## 1. Record

Use a project made for the demo (since 8 Oct, `~/demos/trailhead`) and a thread worked in it. Start your own server on that project with a fresh data folder that holds a copy of the private redaction list, then record:

```bash
mkdir -p /tmp/demo-data && cp app/server/data/redact.json /tmp/demo-data/   # the private list, see below
cd app/server && npm run build
PORT=4886 RUNDOWN_ROOT=~/demos/trailhead RUNDOWN_DATA_DIR=/tmp/demo-data node dist/main.js
# in another terminal, from the repo; the thread ids are in http://127.0.0.1:4886/api/sessions
RUNDOWN_DATA_DIR=/tmp/demo-data node app/scripts/record-demo.mjs --server http://127.0.0.1:4886 --session <id>[,<id>]
```

This writes `app/web/public/replay-next.json` (gitignored; `--out <file>` writes elsewhere). Options:

- `--until <ISO time>`: the recording stops there (steps, Places, agent moves, and the time the demo says it was made).
- `--moves-from` / `--moves-to <ISO time>`: only the agent moves in that window (`--moves-to` defaults to `--until`).

The script takes the server's normal export (`GET /api/replay?sessionId=`, `/api/workspace`, `/api/workspace/suggestions`), adds the agent moves from Claude Code's logs (subagents named from their `.meta.json`), keeps only this project in the setup run's suggestions, redacts everything with `redact.json`, and writes the home folder as `~`. Then open the file and check it for anything private: it holds the prompts, the agents' messages and the diffs.

## 2. Build and check

```bash
cd app/web && npm run build:demo                  # or: npm run build:demo -- --replay <file> --out <folder>
npx vite preview --outDir dist-demo --port 5086   # opens on the recording; Setup preview plays the setup run
```

`dist-demo/` (gitignored) is the whole site, with the recording as `replay.json`.

## 3. Deploy (the maintainer)

The deploy folder is `~/demos/rundown-demo-site`, linked to the Vercel project brainstorm-next, with a `vercel.json` that sends every path to `index.html`. Copy `dist-demo/` into it (keep its `vercel.json` and `.vercel/`), then from inside it: `vercel deploy --prod --yes`. Keep the previous `replay.json` aside first (the one before 8 Oct is `~/demos/replay-next.backup-oct4.json`).

## redact.json

The private redaction list, `redact.json` in the server's data folder (`app/server/data/`, or `RUNDOWN_DATA_DIR`). It is gitignored on purpose: committing it would publish the very names it hides. Both the demo recording and every shared replay (`GET /api/share`, `/rundown:share`) go through it (`app/server/src/replay/redact.ts`). Without the file nothing extra is removed.

```json
{
  "threadTitles": ["titles of your other Claude threads"],
  "projects": ["names of other projects"],
  "regexes": [["pattern", "replacement"]],
  "privateTerms": ["a value containing one of these is replaced entirely"],
  "dropStepTextMatching": ["a step text matching one of these (multiline) is replaced entirely"]
}
```

Titles become "[other thread]", project names "[other project]", and the last two "[removed: private content]". Every text value is checked, and object keys that aren't plain field names too.

## Before 12 Oct 2026

The server built the demo's extras itself: `GET /api/replay?sessionId=…&preview=1` added the agent moves and the setup run, with `movesFrom`, `movesTo` and `until`, and every build carried `lib/preview.ts`. The web was built with `VITE_REPLAY_URL=/replay.json npx vite build`, then `public/replay-next.json` was renamed to `replay.json` in the output and the home folder written as `~` by hand. Those parameters are gone; the script makes the same file (checked byte for byte on the test fixture).
