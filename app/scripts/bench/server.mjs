// Build, start and measure the Brainstorm server: startup, API timings and sizes, memory, CPU, websocket traffic.
import { execSync, spawn, execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { APP_DIR, kb, log, mb, round, sleep, waitFor } from "./lib.mjs";

/** Compile the server (tsc → app/server/dist) and the web (vite build → app/web/dist). Returns build times. */
export function build({ server = true, web = true } = {}) {
  const out = {};
  if (server) { const t = Date.now(); execSync("npx tsc -p .", { cwd: join(APP_DIR, "server"), stdio: ["ignore", "ignore", "inherit"] }); out.serverMs = Date.now() - t; }
  if (web) { const t = Date.now(); execSync("npx vite build --logLevel error", { cwd: join(APP_DIR, "web"), stdio: ["ignore", "ignore", "inherit"] }); out.webMs = Date.now() - t; }
  return out;
}

/** The production bundle, per file: raw and gzip sizes in kB (what a browser downloads on first load and on lazy views). */
export function bundleSizes() {
  const dir = join(APP_DIR, "web/dist/assets");
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).map((name) => {
    const buf = readFileSync(join(dir, name));
    return { name, kb: kb(buf.length), gzipKb: kb(gzipSync(buf).length) };
  }).sort((a, b) => b.kb - a.kb);
  const js = files.filter((f) => f.name.endsWith(".js")), css = files.filter((f) => f.name.endsWith(".css"));
  const sum = (l, k) => round(l.reduce((s, f) => s + f[k], 0));
  const html = readFileSync(join(APP_DIR, "web/dist/index.html"), "utf8");
  const entry = [...html.matchAll(/(?:src|href)="\/assets\/([^"]+)"/g)].map((m) => m[1]);
  const initial = files.filter((f) => entry.includes(f.name));
  return { files, jsKb: sum(js, "kb"), jsGzipKb: sum(js, "gzipKb"), cssKb: sum(css, "kb"), initialKb: sum(initial, "kb"), initialGzipKb: sum(initial, "gzipKb"), initialFiles: entry };
}

/** RSS (MB) and cumulative CPU seconds of a process, from ps. */
export function procStats(pid) {
  try {
    const [rss, time] = execFileSync("ps", ["-o", "rss=,time=", "-p", String(pid)], { encoding: "utf8" }).trim().split(/\s+/);
    const parts = time.split(":").map(Number); // [[hh:]mm:]ss.cc
    const cpuSec = parts.reduce((s, v) => s * 60 + v, 0);
    return { rssMb: round(Number(rss) / 1024), cpuSec };
  } catch { return null; }
}

/** Sample a process every `everyMs` until stop(): CPU% per interval (100 = one core), peak RSS. */
export function sampler(pid, everyMs = 1000) {
  const samples = [];
  let last = procStats(pid), lastT = Date.now();
  const timer = setInterval(() => {
    const s = procStats(pid), t = Date.now();
    if (!s || !last) return;
    samples.push({ cpu: (100 * (s.cpuSec - last.cpuSec)) / ((t - lastT) / 1000), rssMb: s.rssMb });
    last = s; lastT = t;
  }, everyMs);
  return {
    stop() {
      clearInterval(timer);
      const cpu = samples.map((s) => s.cpu);
      return { cpuAvg: round(cpu.reduce((a, b) => a + b, 0) / (cpu.length || 1)), cpuMax: round(Math.max(0, ...cpu)), rssMaxMb: round(Math.max(0, ...samples.map((s) => s.rssMb))), samples: samples.length };
    },
  };
}

/**
 * Start the server the way the plugin does (one process serving the API and the built web), on our own port and
 * folders, with no model keys (no network). Resolves once /api/health answers; `events` collects log milestones.
 */
export async function startServer({ port, dataDir, claudeDir, root, timeoutMs = 120_000 }) {
  const env = {
    PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, LANG: process.env.LANG ?? "en_US.UTF-8",
    PORT: String(port), BRAINSTORM_PORT: String(port), BRAINSTORM_DATA_DIR: dataDir, CLAUDE_PROJECTS_DIR: claudeDir,
    BRAINSTORM_ROOT: root, MAP_ROOT: root, BRAINSTORM_WEB_DIR: join(APP_DIR, "web/dist"), BRAINSTORM_VERSION: "bench",
    ...(process.env.BRAINSTORM_MAX_FILES ? { BRAINSTORM_MAX_FILES: process.env.BRAINSTORM_MAX_FILES } : {}), // the map's file cap
  };
  const t0 = Date.now();
  const child = spawn(process.execPath, [join(APP_DIR, "server/dist/main.js")], { env, stdio: ["ignore", "pipe", "pipe"] });
  const events = { spawnAt: t0 };
  const logLines = [];
  const onLine = (line) => {
    logLines.push(`${Date.now() - t0}ms ${line}`);
    if (logLines.length > 400) logLines.shift();
    const m = /built map for .*?: (\d+) files, (\d+) edges, (\d+) modules in (\d+)ms/.exec(line);
    if (m && !events.mapBuilt) events.mapBuilt = { atMs: Date.now() - t0, files: +m[1], edges: +m[2], modules: +m[3], buildMs: +m[4] };
    if (/backfill complete/.test(line) && !events.watcherReadyMs) events.watcherReadyMs = Date.now() - t0;
    if (/backfill: read \d+ recent/.test(line) && !events.backfillRecentMs) events.backfillRecentMs = Date.now() - t0;
    if (/ on http:\/\/localhost:/.test(line) && !events.listeningMs) events.listeningMs = Date.now() - t0;
  };
  for (const stream of [child.stdout, child.stderr]) {
    let buf = "";
    stream.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { onLine(buf.slice(0, i)); buf = buf.slice(i + 1); } });
  }
  let exited = null;
  child.on("exit", (code, sig) => { exited = { code, sig, atMs: Date.now() - t0 }; });
  const base = `http://127.0.0.1:${port}`;
  const ok = await waitFor(async () => { if (exited) throw new Error("exited"); return (await fetch(`${base}/api/health`)).ok; }, { timeoutMs, everyMs: 50 });
  events.healthMs = ok ? Date.now() - t0 : null;
  // CPU seconds the server used to get there: steadier than wall time when other work shares the machine.
  if (ok) events.healthCpuSec = procStats(child.pid)?.cpuSec ?? null;
  if (!ok) log(`server did not answer /api/health in ${timeoutMs} ms`, exited ? `(exited ${JSON.stringify(exited)})` : "", "\n" + logLines.slice(-20).join("\n"));
  return {
    child, pid: child.pid, base, events, logLines, get exited() { return exited; },
    async stop() {
      if (exited) return;
      child.kill("SIGTERM");
      const gone = await waitFor(() => exited, { timeoutMs: 5000, everyMs: 50 });
      if (!gone) { child.kill("SIGKILL"); await waitFor(() => exited, { timeoutMs: 3000, everyMs: 50 }); }
    },
  };
}

/** GET a URL: time to the full body, body size, status. A timeout or error is recorded, not thrown. */
export async function timeGet(url, timeoutMs = 60_000) {
  const t = performance.now();
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    const buf = Buffer.from(await r.arrayBuffer());
    return { ms: round(performance.now() - t), kb: kb(buf.length), status: r.status, body: buf };
  } catch (e) {
    return { ms: round(performance.now() - t), error: e.name === "TimeoutError" ? `timeout after ${timeoutMs} ms` : e.message };
  }
}

/** Every API the web app loads at boot (lib/live.tsx), plus what opening a thread loads. Cold call then warm call. */
export async function apiTimings(base, sessionId) {
  const boot = ["workspace", "sessions", "map", "failures", "agents", "attention"];
  const thread = sessionId ? [`sessions/${sessionId}/steps`, `tasks/${sessionId}`, `cowork?sessionId=${sessionId}`] : [];
  const out = {};
  for (const p of [...boot, ...thread]) {
    const cold = await timeGet(`${base}/api/${p}`);
    const warm = await timeGet(`${base}/api/${p}`);
    const key = p.replace(sessionId ?? "\0", ":id").replace(/\?.*/, "");
    out[key] = { coldMs: cold.ms, warmMs: warm.ms, kb: cold.kb, status: cold.status, ...(cold.error ? { error: cold.error } : {}) };
  }
  // The six boot calls fired together, as the page does.
  const t = performance.now();
  await Promise.all(boot.map((p) => timeGet(`${base}/api/${p}`)));
  out.bootParallelMs = round(performance.now() - t);
  return out;
}

/** Listen to /ws like a page does: messages per second, bytes per message, per type; step latency (log line written → message). */
export function wsMonitor(base) {
  const ws = new WebSocket(base.replace("http", "ws") + "/ws");
  const byType = {};
  const latencies = [];
  let total = 0, bytes = 0, t0 = Date.now(), open = false;
  ws.onopen = () => { open = true; };
  ws.onmessage = (e) => {
    const size = Buffer.byteLength(e.data);
    total++; bytes += size;
    let type = "?";
    try {
      const m = JSON.parse(e.data);
      type = m.type;
      if (m.type === "step" && m.step?.ts) latencies.push(Date.now() - Date.parse(m.step.ts));
    } catch { /* not JSON */ }
    const b = (byType[type] ??= { count: 0, bytes: 0, maxBytes: 0 });
    b.count++; b.bytes += size; b.maxBytes = Math.max(b.maxBytes, size);
  };
  return {
    get open() { return open; },
    reset() { for (const k of Object.keys(byType)) delete byType[k]; latencies.length = 0; total = 0; bytes = 0; t0 = Date.now(); },
    snapshot() {
      const secs = (Date.now() - t0) / 1000;
      const sorted = [...latencies].sort((a, b) => a - b);
      const q = (p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : null);
      return {
        seconds: round(secs), messages: total, perSec: round(total / secs), kbPerSec: kb(bytes / secs), avgBytes: total ? Math.round(bytes / total) : 0,
        byType: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, { count: v.count, avgBytes: Math.round(v.bytes / v.count), maxBytes: v.maxBytes }])),
        stepLatencyMs: { p50: q(0.5), p95: q(0.95), max: sorted.at(-1) ?? null, n: sorted.length },
      };
    },
    close() { try { ws.close(); } catch { /* closed */ } },
  };
}

/** Wait until the server lists the long thread with its last step (the listener has read the whole log). */
export async function waitForThread(base, sessionId, lastTs, timeoutMs) {
  const t0 = Date.now();
  const hit = await waitFor(async () => {
    const r = await fetch(`${base}/api/sessions`, { signal: AbortSignal.timeout(timeoutMs) });
    const list = await r.json();
    const s = list.find((x) => x.id === sessionId);
    return s && s.lastEventAt >= lastTs ? s : null;
  }, { timeoutMs, everyMs: 200 });
  return hit ? Date.now() - t0 : null;
}

/**
 * After boot: how long until the server goes quiet (CPU under `pct`% for `quiet` samples in a row), and its peak RSS
 * meanwhile. Work the server does after it answers (watching the repo, reading history) shows up here, not in "boot".
 */
export async function untilQuiet(pid, sinceMs, { pct = 5, quiet = 4, everyMs = 500, timeoutMs = 180_000 } = {}) {
  let last = procStats(pid), lastT = Date.now(), calm = 0, peak = last?.rssMb ?? 0;
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    await sleep(everyMs);
    const s = procStats(pid), t = Date.now();
    if (!s || !last) return { quietAtMs: null, peakRssMb: peak };
    const cpu = (100 * (s.cpuSec - last.cpuSec)) / ((t - lastT) / 1000);
    peak = Math.max(peak, s.rssMb);
    calm = cpu < pct ? calm + 1 : 0;
    last = s; lastT = t;
    if (calm >= quiet) return { quietAtMs: t - quiet * everyMs - sinceMs, peakRssMb: peak, cpuSec: s.cpuSec };
  }
  return { quietAtMs: null, peakRssMb: peak, timeout: true };
}

export const dbSizeMb = (dataDir) => { try { return mb(statSync(join(dataDir, "brainstorm.db")).size + (existsSync(join(dataDir, "brainstorm.db-wal")) ? statSync(join(dataDir, "brainstorm.db-wal")).size : 0)); } catch { return null; } };
