#!/usr/bin/env node
// Brainstorm launcher: starts the server (or reuses the running one) and opens it. No dependencies.
// Used by the SessionStart hook (--background) and the /brainstorm:open and /brainstorm:stop skills.
//
//   --background   for the SessionStart hook: start if needed and return at once. Prints nothing, or one JSON line with a
//                  `systemMessage` for the user (welcome, updated, update available); plain stdout would go into Claude's context
//   --open         open the map in the browser
//   --switch       make the project the active workspace
//   --project DIR  the project (default: CLAUDE_PROJECT_DIR, then the current folder)
//   --stop         stop the running server
// It always exits 0 and prints any problem on stdout, so a skill can run it as one plain command.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
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
const DATA = process.env.CLAUDE_PLUGIN_DATA || join(homedir(), ".brainstorm");
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

/** The running Brainstorm, if any: {port, health}. */
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
  writeSync(out, `\n--- ${new Date().toISOString()} starting Brainstorm ${VERSION} on ${port} for ${PROJECT}\n`);
  const env = {
    ...process.env,
    BRAINSTORM_VERSION: VERSION, BRAINSTORM_PORT: String(port), BRAINSTORM_DATA_DIR: DATA,
    BRAINSTORM_WEB_DIR: WEB, BRAINSTORM_ROOT: PROJECT, NODE_NO_WARNINGS: "1",
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
    out.push(port ? `Brainstorm is running for this project at http://localhost:${port}. Run /brainstorm:open to see the map.` : "Brainstorm is starting. Run /brainstorm:open to see the map.");
    n.welcomed = true;
  } else if (n.lastVersion && n.lastVersion !== VERSION) {
    out.push(`Brainstorm was updated to ${VERSION}.`);
  }
  n.lastVersion = VERSION;
  if (!n.checkedAt || Date.now() - n.checkedAt > DAY) {
    n.checkedAt = Date.now();
    try {
      const latest = (await (await fetch(LATEST_URL, { signal: AbortSignal.timeout(1500) })).json()).version;
      if (latest && newer(latest, VERSION)) {
        out.push(`Brainstorm ${latest} is available (you have ${VERSION}). To update, run \`claude plugin update brainstorm@brainstorm\` in a terminal, or choose Update now in /plugin → Installed.`);
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

async function main() {
  mkdirSync(DATA, { recursive: true });
  if (!nodeOk()) {
    const msg = `Brainstorm needs Node.js 22.13 or later (you have ${process.versions.node}). Update Node, then start a new session.`;
    if (!BACKGROUND) return say(msg);
    const n = readNotices(); // once a day, not every session
    if (!n.nodeWarnedAt || Date.now() - n.nodeWarnedAt > DAY) { n.nodeWarnedAt = Date.now(); writeNotices(n); tellUser([msg]); }
    return;
  }

  let run = await running();

  if (flag("--stop")) {
    if (!run) return say("Brainstorm isn't running.");
    await stop(run);
    return say(`Brainstorm stopped (it was on port ${run.port}).`);
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
      if (!up) { console.log(`Brainstorm didn't start. Last lines of ${LOG}:`); console.log(tail(LOG)); return; }
    } else {
      if (BACKGROUND) return tellUser(await notices()); // another session is starting it
      for (let t = 0; t < 20_000 && !(run = await running()); t += 250) await sleep(250);
      if (!run) { console.log(`Brainstorm didn't start. See ${LOG}`); return; }
      port = run.port;
    }
  }
  if (BACKGROUND) return tellUser(await notices(port));
  // Someone who opens Brainstorm themselves doesn't need the welcome.
  const n = readNotices();
  if (!n.welcomed || n.lastVersion !== VERSION) writeNotices({ ...n, welcomed: true, lastVersion: VERSION });

  if (flag("--switch")) {
    const ws = await fetch(`http://127.0.0.1:${port}/api/workspace`).then((r) => r.json()).catch(() => null);
    if (ws?.root !== PROJECT) {
      const r = await fetch(`http://127.0.0.1:${port}/api/workspace`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ root: PROJECT }) });
      if (!r.ok) say(`Couldn't switch Brainstorm to ${PROJECT}: ${await r.text()}`);
    }
  }

  const url = `http://localhost:${port}/?view=map`;
  if (flag("--open")) openBrowser(url);
  say(`Brainstorm ${VERSION} is running for ${PROJECT}: ${url}`);
}

function tail(file, n = 15) {
  try { return readFileSync(file, "utf8").trimEnd().split("\n").slice(-n).join("\n"); } catch { return "(no log)"; }
}

main().catch((e) => say(`Brainstorm launcher error: ${e.message}`));
