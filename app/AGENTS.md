# app/

The Rundown product: a NestJS server and a React web app. Read `../CLAUDE.md` for the house rules, then `../docs/technical.md` for how it works.

## What is here

- `server/`: NestJS 11 and TypeScript. It reads the agents' session logs, stores steps in a local SQLite file (Node's built-in `node:sqlite`), and serves a REST API under `/api` and a WebSocket at `/ws`. `server/src/types.ts` is the contract shared with the web app (imported there as `@contract`).
- `web/`: Vite, React 19 and TypeScript. The map, the threads, the steps and the replay.
- `scripts/`: `build-plugin.mjs` bundles both into `../plugin/build`, and `bench/` is the performance check.

You need Node.js 22.13 or later.

## Run it

Use your own ports, so you don't disturb other servers on the machine.

```bash
cd app/server && npm install && npm run build
PORT=4100 RUNDOWN_ROOT=/path/to/a/project RUNDOWN_DATA_DIR=/tmp/rundown-dev node dist/main.js

cd app/web && npm install
API_PORT=4100 npx vite --port 5180      # open http://localhost:5180
```

- `PORT`: the server's port (it listens on 127.0.0.1 only). The default is 4000.
- `RUNDOWN_ROOT`: the project the map shows first. You can also choose one in the app.
- `RUNDOWN_DATA_DIR`: where the database and private files go. Without it the server uses `app/server/data/` and reads `app/.env` if there is one (see `.env.example`; everything in it is optional). With it, `.env` is not read.
- `API_PORT`: the port the web dev server proxies `/api` and `/ws` to. The default is 4000.

`npm run dev` in `app/server` rebuilds and restarts on changes.

## Check your work

```bash
cd app/server && npx tsc -p . --noEmit   # typecheck
cd app/server && npm test                # builds, then runs the node:test suites
cd app/web && npx tsc -b                 # typecheck the web app
```

Then open the app and look at the change, not only at the typechecker. The step and file panels need a window about 1440 px wide.

## Plugin build

`node app/scripts/build-plugin.mjs` from the repo root (or `node scripts/build-plugin.mjs` from `app/`) writes `../plugin/build`. Releases are the maintainer's job.
