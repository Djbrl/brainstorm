# Brainstorm Cowork

Brainstorm only shows coding work today. Cowork extends it to the rest of what agents do: browsing and researching the web, testing your apps in a browser, using connected services (docs, calendar, email) and command-line tools that reach the outside world (GitHub, Vercel, cloud CLIs).

The idea: the map shows *where the agents worked*, and the code is only one kind of place. The same verbs apply everywhere. A **read** is looking at something (opening a page, reading a doc). A **change** is doing something to the outside world (sending, submitting, publishing, deploying, deleting).

Branch: `feature/cowork`, from `post-deadline`. Local prototype, not deployed.

## Why

On this Mac, about a quarter of all agent tool calls in Claude Code logs are already outside the code (counted on 28 Sep 2026 across `~/.claude/projects`):

| Kind | Tool calls |
| --- | --- |
| Code (reads, edits, shell commands) | 11,865 |
| Browser (in-app pane and Chrome) | 4,107 |
| Connectors (docs, calendar…) | 207 |
| Web search and fetch | 119 |

Brainstorm showed those only as plain steps in Follow. With the web, nothing like git records what an agent changed, so a list of changes is the main reason to watch.

## What the prototype does (the easy parts)

Run it: server `PORT=4410 MAP_ROOT=<repo> node dist/main.js` in `app/server`, web `API_PORT=4410 npx vite --port 5190` in `app/web`, open the **Cowork** tab (local app only; the hosted replays carry no cowork data).

- **Sorting every tool call into a place** (`app/server/src/cowork/classify.ts`), in four areas:
  - **Web:** host, then page (host + path, with no query string or hash). Covers both browsers, WebFetch and WebSearch.
  - **Your apps:** localhost, `*.localhost`, `*.test` and `file://` pages, meaning the apps you're building.
  - **Services:** connectors and other MCP servers, plus shell commands that reach out: `git push`, `gh`, `vercel`, `brev`, `npm publish`, `curl`.
  - **Apps:** the iOS Simulator and computer use (no data yet).
- **How pages are identified.** Both browsers add a "Tab Context" footer to every result, with the tab's title and URL. The tracker follows each tab through a session, so a click is placed on the page where it happened.
- **Reads vs changes, with a confidence level:**
  - **sure:** the tool itself changes something. A connector call named create, update, delete or send; publishing an Artifact; a deploy; a push that wasn't "Everything up-to-date"; `brev delete`.
  - **likely:** a click on an element named like a commit button ("Send", "Submit", "Publish", "Delete", and French equivalents such as "Envoyer"), pressing Enter after typing on a website, a curl POST, or a file upload.
  - **maybe:** a click on a button whose name we can't read, typing into a field, or a script that clicks.
  - Element names come from earlier `find` and `read_page` results (`button "Envoyer" [ref_5]`).
  - Links, tabs and form fields don't count as changes.
  - Nothing done in your own local apps counts as a change.
- **The list of changes:** newest first, grouped by day. A run of the same change (7 edits to one doc) collapses into one row. There are totals per verb and a switch to show the maybes. Each row shows the place on the map and opens the step in Follow.
- **The places map:** one region per area, sites as bubbles sized by activity, and pages around sites that have several. An orange ring means something changed there, a red dot means a step failed. Clicking a place lists every step there.
- **Failures:** errors, blocked navigations (`permission_required`, "not allowed"), timeouts, and error lines in the output of outward shell commands.

On the last day of logs, it found 26 production deploys, 26 pushes, 17 doc edits, 1 doc created, and the lead agent's `brev delete brainstorm-gpu` at 00:05. It also found 13 possible changes: clicks and typing in the Brev console while setting up the GPU, scripts on the Google Form, and scripts clicking through our own demo pages. The Google Form shows up only as filled in, never submitted, which is correct: the human sent it.

## Hard parts, to revisit

1. **Cowork mode keeps no local transcripts.**
   - `~/Library/Application Support/Claude/local-agent-mode-sessions` holds only settings and caches, and no `.jsonl` logs.
   - Today we only see Claude Code sessions that use the browser, computer use or connectors.
   - Covering Cowork itself, the ChatGPT agent or browser-use needs an import format, or an export from each tool.
2. **Telling a write from a read on a click.**
   - Clicks by coordinates, and clicks on elements we never saw named, stay "maybe".
   - Better signals:
     - what the page looked like before and after, read by a vision model from the screenshots;
     - the page changing after the click (a form submit that lands on a "thanks" page);
     - the name of the element at the click point.
   - Each one costs tokens or needs data we don't keep (see 3).
3. **Screenshots, for a filmstrip replay.** The listener keeps only the text of results and drops image blocks. A filmstrip needs:
   - storage (screenshots are big);
   - thumbnails;
   - redaction before anything is shared.
4. **Privacy.** Web work is far more personal than code: WhatsApp pages, emails, typed form values, login codes in URLs. Already done: query strings are dropped from page ids, and typed text is cut to 36 characters.
   - Still needed:
     - a private mode;
     - redaction rules for page titles and typed text;
     - no cowork data in shared replays until those exist.
   - The `/api/replay` redaction doesn't cover cowork events yet.
5. **Tool results are truncated at 2,000 characters** (`listener.service.ts`). The tab footer comes last, so long results (`read_page`, `find`) lose the URL and element names.
   - We fall back to the tab's last known URL.
   - Fix: keep the footer when clipping. This is in the listener, which the lead owns.
6. **Connector names.** Many connectors have opaque ids for server names. We guess the name from the tool names (event → Calendar, batch/guide → Docs), and item titles are learned only from a create in the same session ("Doc dc2c64ba" until then). We need the real server names from the MCP configuration.
7. **Layout.** Websites have no folder tree. A force layout with one region per area works at about 50 sites, but labels collide in the web cluster at full zoom-out. Open options:
   - grouping by task or topic rather than by host;
   - a timeline layout;
   - clusters that open up as you zoom in.
8. **Research sources.** For research, the valuable view is which pages actually fed the final answer versus pages opened and dropped. That means matching claims in the agent's answer to fetched pages (citations or embeddings).
9. **Failures specific to computer use.** Not detected yet:
   - CAPTCHAs;
   - pages that never load;
   - login walls;
   - the agent clicking the same thing in a loop;
   - permission prompts it waits on.
10. **Shell detection is a fixed list of CLIs.** Missing:
    - `aws`, `gcloud`, `kubectl`, `fly`, `stripe`;
    - `ssh` commands run on remote machines;
    - database clients pointed at production.

    A general rule for "this command touches the network" would catch more, with more noise.
11. **Local apps never count as changes.** An admin panel on localhost that points at a production database would. This could become a per-host setting.
12. **Scope.** The listener only backfills the last 24 hours and only sessions inside the workspace folder, so research started from another folder doesn't show up. Cowork probably wants a view across all workspaces.
13. **One map, not two tabs.** The plan is one canvas with the code and every other area, sharing live agent dots, trails and thread replay. That touches `MapView.tsx`, so it waits for the lead's map changes to settle.
14. **Live agents on the places map.** The code map moves agents between files. The places map doesn't show agents yet: no dots moving between sites, and no trails.

## Files

- `app/server/src/cowork/classify.ts`: the tracker and classifiers. Pure functions, no Nest.
- `app/server/src/cowork/cowork.service.ts`: pairs calls with results per session and aggregates sites and pages. `GET /api/cowork[?sessionId=]`, cached for 10 s.
- `app/server/src/types.ts`: the `Cowork*` types, added only.
- `app/web/src/cowork/`: `CoworkView.tsx` (layout and panels), `WorldMap.tsx` (canvas), `data.ts` (fetching and grouping), `cowork.css`.
- `app/web/vite.config.ts`: `API_PORT` lets a second checkout run next to the main one.
