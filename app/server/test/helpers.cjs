// Builds a ListenerService on a scratch database and a scratch Claude Code folder, without Nest or an HTTP server.
require("reflect-metadata");
const { mkdtempSync, mkdirSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const dist = (p) => join(__dirname, "..", "dist", p);

/**
 * A fresh service on its own database. Logs for workspace `root` go in `projectDir`. With `watch: false` (default) the
 * file watcher is closed right away and tests read files themselves (`readNow`), as live activity once `live()` is on.
 */
async function makeListener({ root = "/work/demo-repo", watch = false } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), "bs-listener-"));
  process.env.RUNDOWN_DATA_DIR = join(tmp, "data");
  process.env.RUNDOWN_CLAUDE_DIR = join(tmp, "claude");
  process.env.RUNDOWN_CODEX_DIR = join(tmp, "codex"); // never the person's real ~/.codex
  process.env.MAP_ROOT = root;
  delete process.env.SESSION_FILTER;
  const { DbService } = require(dist("core/db.service.js"));
  const { BusService } = require(dist("core/bus.service.js"));
  const { ConfigService } = require(dist("core/config.service.js"));
  const { ListenerService } = require(dist("listener/listener.service.js"));
  const projectDir = join(process.env.RUNDOWN_CLAUDE_DIR, root.replace(/[^A-Za-z0-9-]/g, "-"));
  mkdirSync(projectDir, { recursive: true });
  const sent = [];
  const gateway = { broadcast: (m) => sent.push(JSON.parse(JSON.stringify(m))) };
  const dbs = new DbService();
  const bus = new BusService();
  const cfg = new ConfigService();
  const listener = new ListenerService(dbs, bus, gateway, cfg);
  listener.onModuleInit();
  if (!watch) await listener.watcher.close();
  const t = {
    listener, dbs, bus, cfg, sent, tmp, projectDir, root,
    /** Steps go out as live activity from now on. */
    live() { listener.ready = true; },
    /** Read what `file` gained; `history` reads it quietly. */
    readNow(file, history = false) { return listener.runFile(file, history ? Infinity : 0); },
    async close() { await listener.onModuleDestroy?.(); dbs.db.close(); rmSync(tmp, { recursive: true, force: true }); },
  };
  return t;
}

let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const ts = (i) => new Date(Date.UTC(2026, 9, 1, 12, 0, i)).toISOString();

/** Claude Code log lines for a small thread. */
function line(kind, { sessionId = "s1", cwd = "/work/demo-repo", i = 0, text, tool, input, id } = {}) {
  const base = { uuid: id ?? uuid(), sessionId, cwd, timestamp: ts(i) };
  if (kind === "prompt") return { ...base, type: "user", message: { role: "user", content: text ?? "do the thing" } };
  if (kind === "text") return { ...base, type: "assistant", message: { role: "assistant", content: [{ type: "text", text: text ?? "ok" }] } };
  if (kind === "tool") return { ...base, type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: `tu_${base.uuid}`, name: tool ?? "Bash", input: input ?? { command: "ls" } }] } };
  if (kind === "edit") return { ...base, type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: `tu_${base.uuid}`, name: "Edit", input: input ?? { file_path: "/work/demo-repo/a.ts", old_string: "a", new_string: "b" } }] } };
  if (kind === "result") return { ...base, type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: input ?? "tu_x", content: text ?? "done" }] } };
  throw new Error(kind);
}
const jsonl = (lines) => lines.map((l) => JSON.stringify(l)).join("\n") + "\n";

module.exports = { makeListener, dist, line, jsonl, uuid, ts };
