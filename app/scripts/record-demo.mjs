#!/usr/bin/env node
// Records the hosted demo (brainstorm-next): one replay file with the thread(s), the map, the saved answers, and the demo's
// extras the product app doesn't need: the agents' moves played back on the Map and a recorded setup run.
//
//   node app/scripts/record-demo.mjs --server http://127.0.0.1:<port> --session <id>[,<id>] [--until <ISO time>]
//                                    [--moves-from <ISO>] [--moves-to <ISO>] [--out app/web/public/replay-next.json]
//
// It asks a running Rundown server (started with the demo project as its project and a fresh RUNDOWN_DATA_DIR that holds a
// copy of redact.json) for its normal export (GET /api/replay, GET /api/workspace, GET /api/workspace/suggestions), adds
// the extras from Claude Code's own logs, then redacts the whole file with the server's redaction list (the same
// RUNDOWN_DATA_DIR must be set here) and writes the home folder as "~". Needs the server built (app/server/dist).
// See docs/demo.md.
import { createRequire } from "node:module";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, "../server/dist");
if (!existsSync(join(dist, "replay/redact.js"))) { console.error("Build the server first: cd app/server && npm run build"); process.exit(1); }
const require = createRequire(import.meta.url);
const { redactReplayJson } = require(join(dist, "replay/redact.js"));
const { summarizePlaces } = require(join(dist, "cowork/cowork.service.js"));
const { CODE_SEARCH_TOOLS } = require(join(dist, "shared/tools.js"));
const { inside } = require(join(dist, "shared/paths.js"));

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const server = args.server, session = args.session;
if (!server || !session) { console.error("Usage: record-demo.mjs --server http://127.0.0.1:<port> --session <id>[,<id>] [--until ISO] [--moves-from ISO] [--moves-to ISO] [--out file]"); process.exit(1); }
if (!process.env.RUNDOWN_DATA_DIR) { console.error("Set RUNDOWN_DATA_DIR to the server's data folder (it holds redact.json)."); process.exit(1); }
const until = args.until, movesFrom = args["moves-from"], movesTo = args["moves-to"] ?? until;
const out = resolve(args.out ?? resolve(here, "../web/public/replay-next.json"));
const claudeDir = process.env.RUNDOWN_CLAUDE_DIR ?? process.env.CLAUDE_PROJECTS_DIR ?? join(homedir(), ".claude", "projects");

const get = async (path) => { const r = await fetch(new URL(path, server)); if (!r.ok) throw new Error(`${path}: ${r.status}`); return r.json(); };

const status = await get("/api/workspace");
const replay = await get(`/api/replay?sessionId=${encodeURIComponent(session)}`);

// The recording stops at `until`: steps, the Places summary and the export time.
if (until) {
  replay.steps = replay.steps.filter((st) => st.ts <= until);
  replay.cowork = Object.fromEntries(replay.sessions.map((s) => [s.id, summarizePlaces([s.id], (id) => replay.steps.filter((st) => st.sessionId === id))]));
  replay.exportedAt = until;
}

/** Which subagent wrote each log line: uuid → {id, name}, from Claude Code's subagents/agent-<id>.jsonl (+ .meta.json). */
function subagentIndex(sessionId) {
  const index = new Map();
  let projects = [];
  try { projects = readdirSync(claudeDir); } catch { return index; }
  for (const proj of projects) {
    const dir = join(claudeDir, proj, sessionId, "subagents");
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".jsonl"))) {
      const id = f.replace(/^agent-/, "").replace(/\.jsonl$/, "");
      let name = `Subagent ${id.slice(0, 6)}`;
      try { name = JSON.parse(readFileSync(join(dir, `agent-${id}.meta.json`), "utf8")).description || name; } catch { /* no meta */ }
      for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
        const m = /"uuid":"([^"]+)"/.exec(line);
        if (m) index.set(m[1], { id, name });
      }
    }
  }
  return index;
}

function actionOf(step) {
  const t = step.tool ?? "";
  if (step.kind === "edit") return t === "Write" ? "write" : "edit";
  if (step.kind !== "tool_call") return undefined;
  if (t === "Read") return "read";
  if (CODE_SEARCH_TOOLS.has(t)) return "search";
  return undefined; // runs, delegations etc. have no file to stand on
}

// The agents' moves on files of the map, in time order, played back by the web's lib/preview.ts.
const files = new Set(replay.map.files.map((f) => f.path));
const moves = [];
for (const s of replay.sessions) {
  const subs = subagentIndex(s.id);
  for (const st of replay.steps) {
    if (st.sessionId !== s.id || !st.filePath || !files.has(st.filePath)) continue;
    if ((movesFrom && st.ts < movesFrom) || (movesTo && st.ts > movesTo)) continue;
    const action = actionOf(st);
    if (!action) continue;
    const sub = st.isSubagent ? subs.get(st.id.split(":")[0]) : undefined;
    moves.push({ id: sub?.id ?? s.id, name: sub ? `Subagent · ${sub.name}` : s.title, isSubagent: !!sub, sessionId: s.id, file: st.filePath, action, ts: st.ts });
  }
}
replay.agentMoves = moves.sort((a, b) => a.ts.localeCompare(b.ts));

// The setup run, as the server reports it now (only this project in the suggestions, no other folders).
const suggestions = (await get("/api/workspace/suggestions")).filter((w) => inside(status.root ?? "", w.root));
replay.setupPreview = { status, suggestions };

const { json, count } = redactReplayJson(JSON.stringify(replay));
const home = homedir();
const final = JSON.stringify(JSON.parse(json), (_k, v) => (typeof v === "string" ? v.split(home).join("~") : v));
writeFileSync(out, final);
console.log(`${out}: ${replay.sessions.length} thread(s), ${replay.steps.length} steps, ${moves.length} agent moves, ${count} redactions`);
