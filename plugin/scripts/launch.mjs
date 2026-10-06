#!/usr/bin/env node
// Rundown launcher: starts the server (or reuses the running one) and opens it. No dependencies.
// Used by the SessionStart hook (--background) and the /rundown:open, /rundown:share and /rundown:stop skills.
//
//   --background   for the SessionStart hook: start if needed and return at once. Prints nothing, or one JSON line with a
//                  `systemMessage` for the user (welcome, updated, update available); plain stdout would go into Claude's context
//   --open         open the map in the browser
//   --switch       make the project the active workspace
//   --project DIR  the project (default: CLAUDE_PROJECT_DIR, then the current folder)
//   --stop         stop the running server
//   --share        save a thread as a replay file (.html) and a summary (.md), in Downloads: the thread named by
//                  --session ID, else the project's newest one
// It always exits 0 and prints any problem on stdout, so a skill can run it as one plain command.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const flag = (f) => argv.includes(f);
const opt = (f) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : undefined; };

const BACKGROUND = flag("--background");
const say = (msg) => { if (!BACKGROUND) console.log(msg); };

const PLUGIN = process.env.CLAUDE_PLUGIN_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = process.env.CLAUDE_PLUGIN_DATA || join(homedir(), ".rundown");
// The marketplace it came from, as Claude Code named it here (…/plugins/cache/<marketplace>/<plugin>/<version>): "rundown",
// or "brainstorm" for someone who installed before the rename. The update command needs that name.
const MARKET = /[\\/]plugins[\\/]cache[\\/]([^\\/]+)[\\/]/.exec(PLUGIN)?.[1] ?? "rundown";
const PROJECT = resolve(opt("--project") || process.env.CLAUDE_PROJECT_DIR || process.cwd());
const KEY = process.env.CLAUDE_PLUGIN_OPTION_ANTHROPIC_API_KEY || "";
const VERSION = JSON.parse(readFileSync(join(PLUGIN, ".claude-plugin", "plugin.json"), "utf8")).version;
const SERVER = join(PLUGIN, "build", "server.js");
const WEB = join(PLUGIN, "build", "web");
const STATE = join(DATA, "server.json");
const LOG = join(DATA, "server.log");
const LOCK = join(DATA, "launch.lock");
const NOTICES = join(DATA, "notices.json");
const FIRST_PORT = 4747;
const LATEST_URL = "https://raw.githubusercontent.com/Djbrl/brainstorm/main/plugin/.claude-plugin/plugin.json";
const DAY = 24 * 60 * 60 * 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const keyHash = (k) => (k ? createHash("sha256").update(k).digest("hex").slice(0, 12) : null);

function nodeOk() {
  const [maj, min] = process.versions.node.split(".").map(Number);
  return maj > 23 || (maj === 23 && min >= 4) || (maj === 22 && min >= 13); // node:sqlite without a flag
}

async function health(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(800) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

function readState() {
  try { return JSON.parse(readFileSync(STATE, "utf8")); } catch { return null; }
}

/** The running Rundown, if any: {port, health}. */
async function running() {
  const st = readState();
  if (!st?.port) return null;
  const h = await health(st.port);
  return h ? { port: st.port, health: h } : null;
}

async function stop(run) {
  try { process.kill(run.health.pid, "SIGTERM"); } catch { /* already gone */ }
  for (let i = 0; i < 30 && (await health(run.port)); i++) await sleep(100);
  rmSync(STATE, { force: true });
  rmSync(LOCK, { force: true }); // whatever start it guarded is over
}

function portFree(port) {
  return new Promise((res) => {
    const s = createServer().once("error", () => res(false)).once("listening", () => s.close(() => res(true)));
    s.listen(port, "127.0.0.1");
  });
}
async function pickPort() {
  for (let p = FIRST_PORT; p < FIRST_PORT + 50; p++) if (await portFree(p)) return p;
  throw new Error(`no free port between ${FIRST_PORT} and ${FIRST_PORT + 49}`);
}

/** Only one launcher starts a server at a time (two sessions opening together). Returns false if another one is starting. */
function takeLock() {
  try { closeSync(openSync(LOCK, "wx")); return true; } catch {
    try { if (Date.now() - statSync(LOCK).mtimeMs > 20_000) { rmSync(LOCK, { force: true }); closeSync(openSync(LOCK, "wx")); return true; } } catch { /* raced */ }
    return false;
  }
}

async function start() {
  if (existsSync(LOG) && statSync(LOG).size > 5_000_000) renameSync(LOG, LOG + ".1");
  const port = await pickPort();
  const out = openSync(LOG, "a");
  writeSync(out, `\n--- ${new Date().toISOString()} starting Rundown ${VERSION} on ${port} for ${PROJECT}\n`);
  const env = {
    ...process.env,
    RUNDOWN_VERSION: VERSION, RUNDOWN_PORT: String(port), RUNDOWN_DATA_DIR: DATA,
    RUNDOWN_WEB_DIR: WEB, RUNDOWN_ROOT: PROJECT, NODE_NO_WARNINGS: "1",
  };
  if (KEY) env.ANTHROPIC_API_KEY = KEY;
  const child = spawn(process.execPath, [SERVER], { cwd: DATA, env, detached: true, stdio: ["ignore", out, out] });
  child.unref();
  closeSync(out);
  return port;
}

async function waitUp(port, ms) {
  for (let t = 0; t < ms; t += 250) { const h = await health(port); if (h) return h; await sleep(250); }
  return null;
}

// ---- what the hook tells the user ----

function readNotices() { try { return JSON.parse(readFileSync(NOTICES, "utf8")); } catch { return {}; } }
function writeNotices(n) { try { writeFileSync(NOTICES, JSON.stringify(n)); } catch { /* next time */ } }

const newer = (a, b) => { // a > b, for x.y.z versions
  const pa = String(a).split(/[.-]/).map(Number), pb = String(b).split(/[.-]/).map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
};

/** Messages for the user at session start: first run, just updated, a newer version on GitHub (checked at most once a day). */
async function notices(port) {
  const n = readNotices();
  const out = [];
  if (!n.welcomed) {
    out.push(port ? `Rundown is running for this project at http://localhost:${port}. Run /rundown:open to see the map.` : "Rundown is starting. Run /rundown:open to see the map.");
    n.welcomed = true;
  } else if (n.lastVersion && n.lastVersion !== VERSION) {
    out.push(`Rundown was updated to ${VERSION}.`);
  }
  n.lastVersion = VERSION;
  if (!n.checkedAt || Date.now() - n.checkedAt > DAY) {
    n.checkedAt = Date.now();
    try {
      const latest = (await (await fetch(LATEST_URL, { signal: AbortSignal.timeout(1500) })).json()).version;
      if (latest && newer(latest, VERSION)) {
        out.push(`Rundown ${latest} is available (you have ${VERSION}). To update, run \`claude plugin update rundown@${MARKET}\` in a terminal, or choose Update now in /plugin → Installed.`);
      }
    } catch { /* offline: try again tomorrow */ }
  }
  writeNotices(n);
  return out;
}

function tellUser(lines) {
  if (lines.length) console.log(JSON.stringify({ systemMessage: lines.join("\n") }));
}

function openBrowser(url) {
  const [cmd, args] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  try { spawn(cmd, args, { detached: true, stdio: "ignore" }).unref(); } catch { /* the URL is printed anyway */ }
}

/**
 * Until 0.4 the plugin was called "brainstorm", so Claude Code gave it another data folder. The first time, take over its
 * database and notices, and stop its server first (so the database is whole, and two servers don't run side by side).
 */
async function adoptOldData() {
  if (existsSync(join(DATA, "rundown.db")) || existsSync(join(DATA, "brainstorm.db"))) return;
  const olds = [process.env.CLAUDE_PLUGIN_DATA && join(dirname(DATA), "brainstorm-brainstorm"), join(homedir(), ".brainstorm")].filter(Boolean);
  for (const old of olds) {
    if (!existsSync(join(old, "brainstorm.db"))) continue;
    try {
      const st = JSON.parse(readFileSync(join(old, "server.json"), "utf8"));
      const h = await health(st.port);
      if (h?.pid) {
        process.kill(h.pid, "SIGTERM");
        for (let i = 0; i < 30 && (await health(st.port)); i++) await sleep(100);
      }
    } catch { /* not running */ }
    for (const f of ["brainstorm.db", "brainstorm.db-wal", "brainstorm.db-shm", "notices.json"]) {
      try { if (existsSync(join(old, f))) copyFileSync(join(old, f), join(DATA, f)); } catch { /* start fresh without it */ }
    }
    return;
  }
}

async function main() {
  mkdirSync(DATA, { recursive: true });
  await adoptOldData();
  if (!nodeOk()) {
    const msg = `Rundown needs Node.js 22.13 or later (you have ${process.versions.node}). Update Node, then start a new session.`;
    if (!BACKGROUND) return say(msg);
    const n = readNotices(); // once a day, not every session
    if (!n.nodeWarnedAt || Date.now() - n.nodeWarnedAt > DAY) { n.nodeWarnedAt = Date.now(); writeNotices(n); tellUser([msg]); }
    return;
  }

  let run = await running();

  if (flag("--stop")) {
    if (!run) return say("Rundown isn't running.");
    await stop(run);
    return say(`Rundown stopped (it was on port ${run.port}).`);
  }

  // A different plugin version (after an update) or a new API key: restart so the running server matches.
  // Only a launcher that has a key compares keys (the skills don't receive plugin settings, the hook does).
  if (run && (run.health.version !== VERSION || (KEY && run.health.anthropicKey !== keyHash(KEY)))) {
    await stop(run);
    run = null;
  }

  let port = run?.port;
  if (!run) {
    if (takeLock()) {
      port = await start();
      // The hook doesn't make the session wait: it leaves the lock, which goes stale after 20 s, by when the server is up.
      if (BACKGROUND) return tellUser(await notices(port));
      const up = await waitUp(port, 20_000);
      rmSync(LOCK, { force: true });
      if (!up) { console.log(`Rundown didn't start. Last lines of ${LOG}:`); console.log(tail(LOG)); return; }
    } else {
      if (BACKGROUND) return tellUser(await notices()); // another session is starting it
      for (let t = 0; t < 20_000 && !(run = await running()); t += 250) await sleep(250);
      if (!run) { console.log(`Rundown didn't start. See ${LOG}`); return; }
      port = run.port;
    }
  }
  if (BACKGROUND) return tellUser(await notices(port));
  // Someone who opens Rundown themselves doesn't need the welcome.
  const n = readNotices();
  if (!n.welcomed || n.lastVersion !== VERSION) writeNotices({ ...n, welcomed: true, lastVersion: VERSION });

  if (flag("--switch") || flag("--share")) {
    const ws = await fetch(`http://127.0.0.1:${port}/api/workspace`).then((r) => r.json()).catch(() => null);
    if (ws?.root !== PROJECT) {
      const r = await fetch(`http://127.0.0.1:${port}/api/workspace`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ root: PROJECT }) });
      if (!r.ok) say(`Couldn't switch Rundown to ${PROJECT}: ${await r.text()}`);
    }
  }

  if (flag("--share")) return share(port);

  const url = `http://localhost:${port}/`;
  if (flag("--open")) openBrowser(url);
  say(`Rundown ${VERSION} is running for ${PROJECT}: ${url}`);
}

/** Saves the thread as a replay file and a Markdown summary, and says where. */
async function share(port) {
  const sid = opt("--session");
  const dir = existsSync(join(homedir(), "Downloads")) ? join(homedir(), "Downloads") : join(DATA, "shares");
  mkdirSync(dir, { recursive: true });
  const get = async (path, id) => fetch(`http://127.0.0.1:${port}${path}${id ? `?sessionId=${encodeURIComponent(id)}` : ""}`);
  const saved = [];
  for (const path of ["/api/share", "/api/export.md"]) {
    // A session id the skill couldn't fill in (or one Rundown hasn't read yet) falls back to the newest thread.
    let r = await get(path, sid && !sid.includes("$") ? sid : undefined);
    if (r.status === 404 && sid) r = await get(path);
    if (!r.ok) return say(`Couldn't save the replay: ${await r.text()}`);
    const name = /filename="([^"]+)"/.exec(r.headers.get("content-disposition") ?? "")?.[1] ?? `rundown-replay${path.endsWith(".md") ? ".md" : ".html"}`;
    writeFileSync(join(dir, name), Buffer.from(await r.arrayBuffer()));
    saved.push(join(dir, name));
  }
  say(`Saved this thread:\n- Replay (opens in any browser, nothing to install): ${saved[0]}\n- Summary (Markdown): ${saved[1]}`);
  say("Both include the thread's prompts, messages, commands and code changes. Secrets, emails, your home folder and computer name are masked; screenshots are never included.");
}

function tail(file, n = 15) {
  try { return readFileSync(file, "utf8").trimEnd().split("\n").slice(-n).join("\n"); } catch { return "(no log)"; }
}

main().catch((e) => say(`Rundown launcher error: ${e.message}`));
