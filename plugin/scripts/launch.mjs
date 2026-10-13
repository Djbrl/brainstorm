#!/usr/bin/env node
// Rundown launcher: starts the server (or reuses the running one) and opens it. No dependencies.
// Used by the SessionStart hook (--background) and the /rundown:open, /rundown:share and /rundown:stop skills.
//
//   --background   for the SessionStart hook: start if needed and return at once. Prints nothing, or one JSON line with a
//                  `systemMessage` for the user (welcome, updated, update available); plain stdout would go into Claude's context
//   --open         open the map: in the Claude desktop app, say so and leave it to the skill, which opens it in the app's
//                  browser pane beside the thread; elsewhere (terminal, IDE), in the default browser
//   --browser      with --open: always the default browser, in the desktop app too
//   --switch       make the project the active workspace
//   --settings     the caller has the plugin's settings (the hook does, the skills don't): restart when the key changed,
//                  also to none
//   --project DIR  the project (default: CLAUDE_PROJECT_DIR, then the current folder)
//   --stop         stop the running server
//   --share        save a thread as a replay file (.html) and a summary (.md), in Downloads: the thread named by
//                  --session ID (never another one)
// It always exits 0 and prints any problem on stdout, so a skill can run it as one plain command.
// RUNDOWN_PORT: the first port to try (default 4747). RUNDOWN_UPDATE_CHECK=0: no daily update check, whatever the
// setting (Settings in the app, kept in settings.json in the data folder) says.
import { execFileSync, spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { appendFileSync, chmodSync, closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The command line (see above), read once. A value is the word after its flag, unless that is another flag. */
export function parseFlags(argv) {
  const has = (f) => argv.includes(f);
  const value = (f) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : undefined; };
  return {
    background: has("--background"), open: has("--open"), browser: has("--browser"), switch: has("--switch"),
    settings: has("--settings"), stop: has("--stop"), share: has("--share"), project: value("--project"), session: value("--session"),
  };
}
const FLAGS = parseFlags(process.argv.slice(2));

const BACKGROUND = FLAGS.background;
const say = (msg) => { if (!BACKGROUND) console.log(msg); };

// The plugin's data folder. Claude Code passes it as CLAUDE_PLUGIN_DATA, but not to every command (a session-start hook
// once ran without it while /rundown:open had it: two servers on two folders, neither seeing the other). Without it,
// the same folder is worked out from where the plugin is installed (…/plugins/cache/<marketplace>/<plugin>/<version>
// → …/plugins/data/<plugin>-<marketplace>); ~/.rundown only for a copy run from elsewhere (a clone, a test).
export function pluginDataDir(env, pluginRoot, home) {
  if (env.CLAUDE_PLUGIN_DATA) return env.CLAUDE_PLUGIN_DATA;
  const m = /^(.*[\\/]plugins)[\\/]cache[\\/]([^\\/]+)[\\/]([^\\/]+)[\\/][^\\/]+[\\/]?$/.exec(pluginRoot);
  return m ? join(m[1], "data", `${m[3]}-${m[2]}`) : join(home, ".rundown");
}

const PLUGIN = process.env.CLAUDE_PLUGIN_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = pluginDataDir(process.env, PLUGIN, homedir());
// The marketplace it came from, as Claude Code named it here (…/plugins/cache/<marketplace>/<plugin>/<version>): "rundown",
// or "brainstorm" for someone who installed before the rename. The update command needs that name.
const MARKET = /[\\/]plugins[\\/]cache[\\/]([^\\/]+)[\\/]/.exec(PLUGIN)?.[1] ?? "rundown";
const PROJECT = resolve(FLAGS.project || process.env.CLAUDE_PROJECT_DIR || process.cwd());
// The Anthropic key comes only from the plugin's setting, never from the shell: the person gave Rundown that one.
const KEY = process.env.CLAUDE_PLUGIN_OPTION_ANTHROPIC_API_KEY || "";
const SETTINGS = FLAGS.settings;
const VERSION = JSON.parse(readFileSync(join(PLUGIN, ".claude-plugin", "plugin.json"), "utf8")).version;
const SERVER = join(PLUGIN, "build", "server.js");
const WEB = join(PLUGIN, "build", "web");
const STATE = join(DATA, "server.json");
const LOG = join(DATA, "server.log");
const LOCK = join(DATA, "launch.lock");
const NOTICES = join(DATA, "notices.json");
const SETTINGS_FILE = join(DATA, "settings.json");
const FIRST_PORT = /^\d{2,5}$/.test(process.env.RUNDOWN_PORT ?? "") ? Number(process.env.RUNDOWN_PORT) : 4747;
const LATEST_URL = "https://raw.githubusercontent.com/Djbrl/brainstorm/main/plugin/.claude-plugin/plugin.json";
const DAY = 24 * 60 * 60 * 1000;
// Claude Code inside the Claude desktop app, which has a browser pane only Claude's tools can open.
const DESKTOP = process.env.CLAUDE_CODE_ENTRYPOINT === "claude-desktop";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Which key the server runs with: an HMAC with the server's secret (from server.json).
const keyHash = (k, secret) => (!k || !secret ? null : createHmac("sha256", secret).update(`key:${k}`).digest("hex").slice(0, 12));

function nodeOk() {
  const [maj, min] = process.versions.node.split(".").map(Number);
  return maj > 23 || (maj === 23 && min >= 4) || (maj === 22 && min >= 13); // node:sqlite without a flag
}

/** What answers on `port`. With the server's secret, `verified` says it proved it knows it: it's the Rundown we
 * started, not some other program that took the port after it stopped. `{ timeout: true }`: something holds the port
 * but didn't answer in time; `{ other: true }`: something answered, but not as Rundown; null: nothing there. */
async function health(port, secret, ms = 800) {
  const challenge = randomBytes(16).toString("hex");
  let r;
  try { r = await fetch(`http://127.0.0.1:${port}/api/health?challenge=${challenge}`, { signal: AbortSignal.timeout(ms) }); } catch (e) {
    return e?.name === "TimeoutError" || e?.name === "AbortError" ? { timeout: true } : null;
  }
  try {
    if (!r.ok) return { other: true };
    const h = await r.json();
    if (!h || typeof h !== "object" || h.ok !== true) return { other: true };
    if (secret) h.verified = h.proof === createHmac("sha256", secret).update(`health:${challenge}`).digest("hex");
    return h;
  } catch { return { other: true }; }
}
const answered = (h) => h && !h.timeout && !h.other;

function readState() {
  try { return JSON.parse(readFileSync(STATE, "utf8")); } catch { return null; }
}

/** The running Rundown, if any: {port, health, secret}. Only one that proves it's ours: anything else on that port
 * is never killed, never sent the workspace, never opened. A server from before 0.6 (no secret) must at least have
 * the pid it wrote. */
async function running() {
  const st = readState();
  if (!st?.port) return null;
  let h = await health(st.port, st.secret);
  // No answer in 800 ms, but its process is alive and is our server: most likely busy (reading a long history, mapping
  // a big project), not gone. Ask again with more patience before anyone starts a second server beside it: that used to
  // happen, the new one took over server.json and the old one ran on untracked, on the same database.
  if (h?.timeout && ours(st.pid)) {
    const deadline = Date.now() + (BACKGROUND ? 1_500 : 12_000);
    while (h?.timeout && Date.now() < deadline) h = await health(st.port, st.secret, Math.min(3_000, Math.max(200, deadline - Date.now())));
  }
  // Only a timeout from our own live process means busy. An answer that isn't Rundown's (or doesn't prove the
  // secret) means the port is someone else's now: not ours, a new server starts.
  if (h?.timeout) return ours(st.pid) ? { port: st.port, health: null, secret: st.secret, pid: st.pid, busy: true } : null;
  if (!answered(h)) return null;
  if (st.secret ? !h.verified : h.pid !== st.pid) return null;
  return { port: st.port, health: h, secret: st.secret, pid: h.pid };
}

/** Whether a process is alive (signal 0 only checks). */
const alive = (pid) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
/** Whether `pid` is a Rundown server (its command runs build/server.js). Where `ps` can't tell (Windows), never. */
function ours(pid) {
  if (!Number.isInteger(pid) || pid <= 0 || !alive(pid)) return false;
  try { return /build[\\/]server\.js/.test(execFileSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8", timeout: 2_000, windowsHide: true })); } catch { return false; }
}

/** Stops a server: only one that proved it's ours, or whose process runs our server. server.json is removed only if it
 * still names that server. */
async function stop(run) {
  const pid = run.health?.pid ?? run.pid;
  if (!run.health?.verified && !ours(pid)) {
    log(`not stopping pid ${pid}: it isn't a Rundown server`);
    if (readState()?.pid === run.pid) rmSync(STATE, { force: true });
    return false;
  }
  try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ }
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline && alive(pid)) await sleep(100);
  if (readState()?.pid === pid) rmSync(STATE, { force: true });
  return true;
}

/** Only one launcher starts a server at a time (two sessions opening together). The lock holds a token, so a launcher
 * (or the server it starts) removes only its own. Returns the token, or null if another one is starting. */
function takeLock() {
  const token = `${process.pid}-${randomBytes(6).toString("hex")}`;
  const make = () => { const fd = openSync(LOCK, "wx", 0o600); try { writeSync(fd, token); } finally { closeSync(fd); } return token; };
  try { return make(); } catch {
    try {
      if (Date.now() - statSync(LOCK).mtimeMs > 20_000) {
        rmSync(LOCK, { force: true }); // its launcher is long gone
        return make();
      }
    } catch { /* raced */ }
    return null;
  }
}
function dropLock(token) {
  try { if (token && readFileSync(LOCK, "utf8") === token) rmSync(LOCK, { force: true }); } catch { /* gone */ }
}

// What the server gets from this session's environment: what it needs to run, find the agents' logs and stay quiet.
// Nothing else (tokens, cloud credentials, the session's own variables), and the Anthropic key only from the setting.
const KEEP_ENV = /^(PATH|HOME|USER|LOGNAME|LANG|LC_\w+|TMPDIR|TEMP|TMP|SHELL|DO_NOT_TRACK|RUNDOWN_\w+|CLAUDE_CONFIG_DIR|CODEX_HOME|SystemRoot|SYSTEMROOT|USERPROFILE|APPDATA|LOCALAPPDATA)$/;
export function serverEnv(from, extra) {
  const env = {};
  for (const [k, v] of Object.entries(from)) if (KEEP_ENV.test(k) && v !== undefined) env[k] = v;
  return { ...env, NO_COLOR: "1", NODE_NO_WARNINGS: "1", ...extra };
}

/** Starts a server. It picks its own port, from `port` (the last one it used, so open pages find it again) upwards,
 * and writes the real one to server.json. Returns the child, or null when it died at once (logged). */
async function start(port, lockToken) {
  try { if (existsSync(LOG) && statSync(LOG).size > 5_000_000) renameSync(LOG, LOG + ".1"); } catch { /* keep appending */ }
  const out = openSync(LOG, "a", 0o600);
  try { chmodSync(LOG, 0o600); } catch { /* not ours to change */ }
  writeSync(out, `\n--- ${new Date().toISOString()} starting Rundown ${VERSION} from port ${port} for ${PROJECT}\n`);
  const env = serverEnv(process.env, {
    RUNDOWN_VERSION: VERSION, RUNDOWN_PORT: String(port), RUNDOWN_DATA_DIR: DATA, RUNDOWN_WEB_DIR: WEB, RUNDOWN_ROOT: PROJECT,
    RUNDOWN_PLUGIN_ID: `rundown@${MARKET}`, RUNDOWN_LOCK_TOKEN: lockToken ?? "",
  });
  if (KEY) env.ANTHROPIC_API_KEY = KEY;
  // A skill has no plugin settings, so no key: the server says so if Ask is used, and the next hook (which has the
  // settings) restarts it with the key (needsRestart).
  env.RUNDOWN_NO_SETTINGS = SETTINGS ? "" : "1";
  const n = readNotices();
  if (!!n.startedWithoutSettings !== !SETTINGS) { if (SETTINGS) delete n.startedWithoutSettings; else n.startedWithoutSettings = true; writeNotices(n); }
  let died = null;
  // A young generation of 16 MB instead of Node's default (up to 64 MB a half on a 16 GB machine): the server's
  // garbage is short-lived and small, and the bigger one cost about 100 MB of resident memory for no speed
  // (docs/performance.md, "Memory").
  const child = spawn(process.execPath, ["--max-semi-space-size=16", SERVER], { cwd: DATA, env, detached: true, windowsHide: true, stdio: ["ignore", out, out] });
  child.on("error", (e) => { died = e.message; });
  child.on("exit", (code) => { died ??= `exited with code ${code}`; });
  closeSync(out);
  await sleep(300); // a server that can't even start (bad build, old Node) dies within this
  child.unref();
  if (died) { log(`the server didn't start: ${died}`); return null; }
  return child;
}

/** Waits for the server we started (`pid`) to write server.json and prove it's ours. */
async function waitUp(pid, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (readState()?.pid === pid) { const run = await running(); if (run && !run.busy) return run; }
    if (!alive(pid)) return null;
    await sleep(250);
  }
  return null;
}

/** One line for the launcher in server.log (the background launcher prints nothing, so this is where its problems go). */
function log(msg) {
  try { appendFileSync(LOG, `${new Date().toISOString()} launcher: ${msg}\n`, { mode: 0o600 }); } catch { /* no log */ }
}

// ---- what the hook tells the user ----

function readNotices() { try { return JSON.parse(readFileSync(NOTICES, "utf8")); } catch { return {}; } }
function writeNotices(n) { try { writeFileSync(NOTICES, JSON.stringify(n), { mode: 0o600 }); } catch { /* next time */ } }

/** a > b, for x.y.z versions. Anything that isn't one (a dev server) is never newer nor older. */
export const newer = (a, b) => {
  const re = /^(\d+)\.(\d+)\.(\d+)/;
  const pa = re.exec(String(a)), pb = re.exec(String(b));
  if (!pa || !pb) return false;
  for (let i = 1; i <= 3; i++) if (Number(pa[i]) !== Number(pb[i])) return Number(pa[i]) > Number(pb[i]);
  return false;
};

/** Messages for the user at session start: first run, just updated, a launcher failure (once a day), a newer version
 * on GitHub (checked at most once a day). `runningVersion`: the version the server runs, when known. */
async function notices(port, runningVersion) {
  const n = readNotices();
  const out = [];
  if (!n.welcomed) {
    out.push(port ? `Rundown is running for this project at http://127.0.0.1:${port}. Run /rundown:open to see the map.` : "Rundown is starting. Run /rundown:open to see the map.");
    n.welcomed = true;
  } else if (runningVersion === VERSION && n.lastVersion && newer(VERSION, n.lastVersion)) {
    out.push(`Rundown was updated to ${VERSION}.`);
  }
  // Moves on only once this version really runs: a server too busy to restart says "updated" in a later session.
  if (runningVersion === VERSION && (!n.lastVersion || newer(VERSION, n.lastVersion))) n.lastVersion = VERSION;
  if (n.failure && (!n.failureToldAt || Date.now() - n.failureToldAt > DAY)) {
    out.push(String(n.failure));
    n.failureToldAt = Date.now();
  }
  if (updateCheck() && (!n.checkedAt || Date.now() - n.checkedAt > DAY)) {
    n.checkedAt = Date.now();
    try {
      const latest = (await (await fetch(LATEST_URL, { signal: AbortSignal.timeout(1500) })).json()).version;
      if (typeof latest === "string" && /^\d+\.\d+\.\d+$/.test(latest) && newer(latest, VERSION)) {
        out.push(`Rundown ${latest} is available (you have ${VERSION}). To update, run \`claude plugin update rundown@${MARKET}\` in a terminal, or choose Update now in /plugin → Installed.`);
      }
    } catch { /* offline: try again tomorrow */ }
  }
  writeNotices(n);
  return out;
}

/** Whether to look for a new version: on unless the person turned it off in Settings, or RUNDOWN_UPDATE_CHECK=0. Its
 * own setting, apart from the usage stats. When off, no request at all. */
function updateCheck() {
  if (process.env.RUNDOWN_UPDATE_CHECK === "0") return false;
  try { return JSON.parse(readFileSync(SETTINGS_FILE, "utf8"))?.updateCheck !== false; } catch { return true; }
}

function tellUser(lines) {
  if (lines.length) console.log(JSON.stringify({ systemMessage: lines.join("\n") }));
}

function openBrowser(url) {
  const [cmd, args] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  try { spawn(cmd, args, { detached: true, windowsHide: true, stdio: "ignore" }).on("error", () => {}).unref(); } catch { /* the URL is printed anyway */ }
}

/** Remembers a failure for the hook to tell once a day, or clears it once a server runs. */
function noteFailure(msg) {
  const n = readNotices();
  if (msg) { log(msg); n.failure = `Rundown couldn't start: ${msg}. Details in ${LOG}. Run /rundown:open to try again.`; n.failureFrom = "launcher"; }
  else if (n.failureFrom !== "launcher") return; // none, or the server's own (a damaged database): it stays until told
  else { delete n.failure; delete n.failureToldAt; delete n.failureFrom; }
  writeNotices(n);
}

/**
 * Until 0.4 the plugin was called "brainstorm", so Claude Code gave it another data folder. The first time, take over its
 * database and notices, and stop its server first (so the database is whole, and two servers don't run side by side).
 * Once all of it is copied, the old copies are removed; if a copy fails, the new partial copies go and the old folder
 * stays as it was.
 */
async function adoptOldData() {
  if (existsSync(join(DATA, "rundown.db")) || existsSync(join(DATA, "brainstorm.db"))) return;
  const olds = [process.env.CLAUDE_PLUGIN_DATA && join(dirname(DATA), "brainstorm-brainstorm"), join(homedir(), ".brainstorm")].filter(Boolean);
  for (const old of olds) {
    if (!existsSync(join(old, "brainstorm.db"))) continue;
    try {
      const st = JSON.parse(readFileSync(join(old, "server.json"), "utf8"));
      const h = await health(st.port);
      if (answered(h) && h.pid === st.pid && ours(h.pid)) { // the old server itself, not whatever took its port
        process.kill(h.pid, "SIGTERM");
        const deadline = Date.now() + 3_000;
        while (Date.now() < deadline && alive(h.pid)) await sleep(100);
      }
    } catch { /* not running */ }
    const files = ["brainstorm.db", "brainstorm.db-wal", "brainstorm.db-shm", "notices.json"].filter((f) => existsSync(join(old, f)));
    const copied = [];
    try {
      for (const f of files) { copyFileSync(join(old, f), join(DATA, f)); copied.push(f); }
    } catch (e) { // start fresh without it, and leave the old folder as it was
      log(`couldn't take over ${old}: ${e.message}`);
      for (const f of copied) try { rmSync(join(DATA, f), { force: true }); } catch { /* best effort */ }
      return;
    }
    // Taken over whole: the old copy would only be a second, stale history of the person's sessions.
    for (const f of [...files, "server.json"]) try { rmSync(join(old, f), { force: true }); } catch { /* left behind */ }
    return;
  }
}

async function main() {
  mkdirSync(DATA, { recursive: true });
  await adoptOldData();
  if (!nodeOk()) return tooOldNode();
  if (FLAGS.stop) return stopCommand();
  if (BACKGROUND) return sessionStartCommand();
  const run = await ensureRunning();
  if (!run) return;
  if (run.busy) return say(`Rundown is busy (still reading, it doesn't answer yet) on http://127.0.0.1:${run.port}/. Try again in a moment, or run /rundown:stop and open it again.`);
  welcomed(run);
  if (FLAGS.share) return shareCommand(run.port);
  return openCommand(run);
}

/** Node is too old for the server: say so (the hook: once a day, not every session). */
function tooOldNode() {
  const msg = `Rundown needs Node.js 22.13 or later (you have ${process.versions.node}). Update Node, then start a new session.`;
  if (!BACKGROUND) return say(msg);
  const n = readNotices();
  if (!n.nodeWarnedAt || Date.now() - n.nodeWarnedAt > DAY) { n.nodeWarnedAt = Date.now(); writeNotices(n); tellUser([msg]); }
}

/** --stop: stop the running server, only if it's ours. */
async function stopCommand() {
  const run = await running();
  if (!run) return say("Rundown isn't running.");
  if (!(await stop(run))) return say(`Rundown isn't running (process ${run.pid} on port ${run.port} isn't Rundown, so it was left alone).`);
  return say(`Rundown stopped (it was on port ${run.port}).`);
}

/** --background (the SessionStart hook): start the server if needed and tell the user what's new, without waiting. */
async function sessionStartCommand() {
  const run = await ensureRunning();
  return tellUser(await notices(run && !run.busy ? run.port : undefined, run?.health?.version));
}

/** Someone who opens Rundown themselves doesn't need the welcome (nor the "updated" notice for this version). */
function welcomed(run) {
  const n = readNotices();
  if (!n.welcomed || (run.health.version === VERSION && n.lastVersion !== VERSION && newer(VERSION, n.lastVersion ?? "0.0.0"))) {
    writeNotices({ ...n, welcomed: true, ...(run.health.version === VERSION ? { lastVersion: VERSION } : {}) });
  }
}

/** /rundown:open (and a plain run): with --switch, make this project the shown one; with --open, open the map; say
 * where it runs. */
async function openCommand(run) {
  const port = run.port;
  // The project the server shows (a restart keeps the saved one): this one only after --switch.
  const ws = await fetch(`http://127.0.0.1:${port}/api/workspace`).then((r) => r.json()).catch(() => null);
  let root = ws?.root ?? null;
  if (FLAGS.switch) {
    root = PROJECT;
    if (ws?.root !== PROJECT) {
      const r = await fetch(`http://127.0.0.1:${port}/api/workspace`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ root: PROJECT }) }).catch(() => null);
      if (!r?.ok) {
        const body = r ? await r.text() : "no answer";
        let msg = body; try { msg = JSON.parse(body).message ?? body; } catch { /* plain text */ }
        say(`Couldn't switch Rundown to ${PROJECT}: ${msg}`);
        root = ws?.root ?? null;
      }
    }
  }

  const url = `http://127.0.0.1:${port}/`;
  const pane = FLAGS.open && DESKTOP && !FLAGS.browser;
  if (FLAGS.open && !pane) openBrowser(url);
  say(root ? `Rundown ${run.health.version} is running for ${root}: ${url}` : `Rundown ${run.health.version} is running: ${url}`);
  if (pane) say(`Open it in the browser pane: ${url}`);
}

/** Whether the running server should be replaced by this launcher's: only by a newer version (an older launcher, still
 * loaded in another session, never restarts it), or, from the hook (which has the settings), for another key, or when a
 * skill started it without the settings and there is a key to give it. */
const needsRestart = (run) => newer(VERSION, run.health.version) ||
  (SETTINGS && run.health.version === VERSION && ((keyHash(KEY, run.secret) ?? null) !== (run.health.anthropicKey ?? null) ||
    (!!KEY && !!readNotices().startedWithoutSettings)));

/** The running server, started or restarted as needed: {port, health, secret} or {busy: true, port}, or null. */
async function ensureRunning() {
  let run = await running();
  // A server too busy to answer is left alone: it's up, and it will answer (a restart for a new version waits).
  if (run?.busy || (run && !needsRestart(run))) return run;
  const token = takeLock();
  if (!token) { // another launcher is starting or restarting it
    if (BACKGROUND) return run;
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      await sleep(250);
      const r = await running();
      if (r && (r.busy || !needsRestart(r))) return r;
    }
    say(`Rundown didn't start. See ${LOG}`);
    return null;
  }
  let handedOver = false;
  try {
    // With the lock: someone else may have just started or restarted it.
    run = await running();
    if (run?.busy || (run && !needsRestart(run))) return run;
    const prevPort = run?.port ?? readState()?.port;
    if (run && !(await stop(run))) run = null;
    const child = await start(Number.isInteger(prevPort) ? prevPort : FIRST_PORT, token);
    if (!child) {
      noteFailure("the server stopped as it started");
      if (!BACKGROUND) { console.log(`Rundown didn't start. Last lines of ${LOG}:`); console.log(tail(LOG)); }
      return null;
    }
    // The hook doesn't make the session wait: the server removes the lock once it's up (it goes stale after 20 s).
    if (BACKGROUND) { handedOver = true; noteFailure(null); return null; }
    const up = await waitUp(child.pid, 20_000);
    if (!up) {
      noteFailure("the server didn't answer within 20 seconds");
      console.log(`Rundown didn't start. Last lines of ${LOG}:`); console.log(tail(LOG));
      return null;
    }
    noteFailure(null);
    return up;
  } finally {
    if (!handedOver) dropLock(token);
  }
}

/** --share: saves the thread (--session) as a replay file and a Markdown summary, and says where. */
async function shareCommand(port) {
  const sid = FLAGS.session;
  const dir = existsSync(join(homedir(), "Downloads")) ? join(homedir(), "Downloads") : join(DATA, "shares");
  mkdirSync(dir, { recursive: true });
  const get = async (path, id) => fetch(`http://127.0.0.1:${port}${path}${id ? `?sessionId=${encodeURIComponent(id)}` : ""}`);
  const saved = [];
  // No id, or one the skill couldn't fill in: never guess another thread.
  if (!sid || sid.includes("$")) return say("Couldn't save the replay: Claude Code didn't say which thread this is. Run /rundown:open and use Share in the thread instead.");
  for (const path of ["/api/share", "/api/export.md"]) {
    // A thread Rundown hasn't read yet (it just started): wait for it a little, never fall back to another thread.
    let r;
    const deadline = Date.now() + 8_000;
    for (;;) {
      r = await get(path, sid).catch(() => null);
      if (r?.status !== 404 || Date.now() >= deadline) break;
      await sleep(500);
    }
    if (!r) return say("Couldn't save the replay: Rundown didn't answer.");
    if (r.status === 404) return say(`Couldn't save the replay: Rundown couldn't find this thread (${sid}). Try again in a moment, or run /rundown:open and use Share in the thread.`);
    if (!r.ok) return say(`Couldn't save the replay: ${await r.text()}`);
    // Only a plain file name, in that folder: never a path the answer names ("../.zshrc").
    const ext = path.endsWith(".md") ? ".md" : ".html";
    const given = basename(/filename="([^"]+)"/.exec(r.headers.get("content-disposition") ?? "")?.[1] ?? "").replace(/[^\w.\-]/g, "_");
    const name = given && !given.startsWith(".") && given.endsWith(ext) ? given : `rundown-replay${ext}`;
    writeFileSync(join(dir, name), Buffer.from(await r.arrayBuffer()));
    saved.push(join(dir, name));
  }
  say(`Saved this thread:\n- Replay (opens in any browser, nothing to install): ${saved[0]}\n- Summary (Markdown): ${saved[1]}`);
  say("Both include the thread's prompts, messages, commands and code changes. Secrets, emails, your home folder and computer name are masked; screenshots are never included.");
}

function tail(file, n = 15) {
  try { return readFileSync(file, "utf8").trimEnd().split("\n").slice(-n).join("\n"); } catch { return "(no log)"; }
}

if (!process.env.RUNDOWN_LAUNCH_NO_MAIN) main().catch((e) => {
  try { mkdirSync(DATA, { recursive: true }); noteFailure(`launcher error: ${e.message}`); } catch { /* nowhere to write */ }
  say(`Rundown launcher error: ${e.message}`);
});
