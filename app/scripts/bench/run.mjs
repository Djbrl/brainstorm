// The benchmark, end to end: generate a repo and a long thread, boot the server three ways, time its APIs, run a live
// writer against it, then measure the web app in headless Chrome at each CPU throttling rate. Prints tables, writes JSON.
//
//   node app/scripts/bench/run.mjs --files 5000 --cpu 4
//   node app/scripts/bench/run.mjs --files 1000,5000,20000 --cpu 1,4 --steps 10000 --scratch /tmp/bb --out results/
//
// Options: --files (comma list, default 1000), --cpu (comma list, default 1,4), --steps (long thread, default 10000),
// --scratch (default $TMPDIR/brainstorm-bench), --out (JSON folder, default <scratch>/results), --no-build, --no-front,
// --dpr (device pixel ratio, default 1), --window (seconds per front-end window, default 10), --live-seconds (default 20),
// --rate (live writer steps a second, default 3), --label (a name stored in the JSON, e.g. a branch).
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { cpus, loadavg, totalmem } from "node:os";
import { join } from "node:path";
import { launchChrome } from "./cdp.mjs";
import { frontRun } from "./front.mjs";
import { generateRepo } from "./gen-repo.mjs";
import { startLiveWriter, writeLongThread } from "./gen-thread.mjs";
import { freePort, list, log, parseArgs, REPO_DIR, round, scratchDir, sleep } from "./lib.mjs";
import { apiTimings, build, bundleSizes, dbSizeMb, procStats, sampler, startServer, untilQuiet, waitForThread, wsMonitor } from "./server.mjs";

const args = parseArgs();
const sizes = list(args.files, "1000");
const rates = list(args.cpu, "1,4");
const steps = Number(args.steps ?? 10_000);
const scratch = scratchDir(args.scratch);
const outDir = args.out ? join(process.cwd(), args.out) : join(scratch, "results");
const windowMs = Number(args.window ?? 10) * 1000;
const liveMs = Number(args.liveSeconds ?? 20) * 1000;
const rate = Number(args.rate ?? 3);
const dpr = Number(args.dpr ?? 1);

const cleanups = new Set();
const cleanup = async () => { for (const c of [...cleanups].reverse()) { try { await c(); } catch { /* best effort */ } } cleanups.clear(); };
process.on("SIGINT", async () => { log("interrupted: stopping the server and Chrome"); await cleanup(); process.exit(130); });

function machine() {
  const sh = (cmd, a) => { try { return execFileSync(cmd, a, { encoding: "utf8" }).trim(); } catch { return null; } };
  return {
    model: sh("sysctl", ["-n", "hw.model"]), cpu: cpus()[0]?.model, cores: cpus().length, ramGb: Math.round(totalmem() / 2 ** 30),
    os: sh("sw_vers", ["-productVersion"]) ?? process.platform, node: process.version, loadAvg: loadavg().map((x) => round(x, 2)),
    commit: sh("git", ["-C", REPO_DIR, "rev-parse", "--short", "HEAD"]), branch: sh("git", ["-C", REPO_DIR, "rev-parse", "--abbrev-ref", "HEAD"]),
  };
}

async function benchSize(files, ports) {
  const r = { files, steps, errors: [], loadAvg: loadavg().map((x) => round(x, 1)) };
  const runDir = join(scratch, `run-${files}`);
  rmSync(runDir, { recursive: true, force: true });
  const claudeDir = join(runDir, "claude", "projects");
  mkdirSync(claudeDir, { recursive: true });

  let t = Date.now();
  const manifest = generateRepo({ files, out: join(scratch, `repo-${files}`) });
  r.repo = { root: manifest.root, files: manifest.count, imports: manifest.edges, folders: manifest.folders, genMs: Date.now() - t };
  const expectedNodes = Math.min(manifest.count, 800); // see "MAX_FILES" in the mapper: the map stops at 800 files

  const boot = async (name, dataDir) => {
    const s = await startServer({ port: ports.server, dataDir, claudeDir, root: manifest.root });
    cleanups.add(s.stop);
    return s;
  };

  // A. Empty logs: the map alone.
  let server = await boot("empty", join(runDir, "data-empty"));
  r.bootEmpty = { ...server.events, ...(await untilQuiet(server.pid, server.events.spawnAt)) };
  let s = sampler(server.pid); await sleep(5000);
  r.bootEmpty.rest = { ...s.stop(), ...procStats(server.pid) };
  await server.stop(); cleanups.delete(server.stop);

  // B. Cold: a 10k-step thread nobody has read yet (first launch on a busy project).
  t = Date.now();
  const long = writeLongThread({ manifest, claudeDir, steps });
  r.thread = { sessionId: long.sessionId, steps: long.steps, mainSteps: long.main, subagentSteps: long.subagents, subagents: long.agents, genMs: Date.now() - t };
  const dataDir = join(runDir, "data");
  server = await boot("cold", dataDir);
  r.bootCold = { ...server.events };
  const coldWait = await waitForThread(server.base, long.sessionId, long.lastTs, 600_000);
  r.bootCold.threadReadyMs = coldWait == null ? null : Date.now() - server.events.spawnAt;
  if (coldWait == null) r.errors.push("cold boot: the long thread never showed up in /api/sessions within 600 s");
  Object.assign(r.bootCold, await untilQuiet(server.pid, server.events.spawnAt));
  s = sampler(server.pid); await sleep(5000);
  r.bootCold.rest = { ...s.stop(), ...procStats(server.pid) };
  r.bootCold.dbMb = dbSizeMb(dataDir);
  await server.stop(); cleanups.delete(server.stop);

  // C. Warm restart: the same database (the everyday case). This server stays up for the rest.
  server = await boot("warm", dataDir);
  r.bootWarm = { ...server.events };
  const warmWait = await waitForThread(server.base, long.sessionId, long.lastTs, 300_000);
  r.bootWarm.threadReadyMs = warmWait == null ? null : Date.now() - server.events.spawnAt;
  Object.assign(r.bootWarm, await untilQuiet(server.pid, server.events.spawnAt));
  s = sampler(server.pid); await sleep(5000);
  r.bootWarm.rest = { ...s.stop(), ...procStats(server.pid) };

  // APIs the page loads at boot and when a thread opens.
  r.api = await apiTimings(server.base, long.sessionId);
  r.afterApi = procStats(server.pid);

  // Live writer against the server alone: CPU, websocket traffic, latency from log line to message.
  const ws = wsMonitor(server.base);
  await sleep(500);
  ws.reset();
  const lw = startLiveWriter({ manifest, claudeDir, rate });
  s = sampler(server.pid);
  await sleep(liveMs);
  const writer = await lw.stop();
  await sleep(1000); // let the last lines arrive
  r.live = { server: s.stop(), ws: ws.snapshot(), writer: { steps: writer.steps, lines: writer.lines, kb: round(writer.bytes / 1024), bursts: writer.bursts, edits: writer.edits, stepsPerSec: round(writer.steps / ((writer.stoppedAt - writer.startedAt) / 1000)) }, ...procStats(server.pid) };
  ws.close();

  // Front-end, once per CPU rate.
  r.front = [];
  if (args.front !== false) {
    const chrome = await launchChrome({ port: ports.chrome, userDataDir: join(runDir, "chrome") });
    cleanups.add(chrome.close);
    r.chrome = chrome.version;
    try {
      for (const cpu of rates) {
        log(`front-end: ${files} files at ${cpu}x CPU`);
        r.front.push(await frontRun({
          chrome, base: server.base, cpu, dpr, windowMs, expectedNodes, threadId: long.sessionId,
          liveWriter: () => startLiveWriter({ manifest, claudeDir, rate, seed: 3 + cpu }), serverSampler: () => sampler(server.pid),
        }));
      }
    } finally { await chrome.close(); cleanups.delete(chrome.close); }
  }
  r.end = procStats(server.pid);
  r.loadAvgEnd = loadavg().map((x) => round(x, 1));
  if (server.exited) r.errors.push(`server exited: ${JSON.stringify(server.exited)}`);
  r.serverLogTail = server.logLines.filter((l) => /\b(WARN|ERROR)\b/.test(l)).slice(-15);
  r.peakRssMb = Math.max(...[r.bootEmpty, r.bootCold, r.bootWarm].map((b) => b?.peakRssMb ?? 0), r.afterApi?.rssMb ?? 0,
    r.live?.server?.rssMaxMb ?? 0, ...r.front.map((x) => x.live?.serverDuringFront?.rssMaxMb ?? 0));
  await server.stop(); cleanups.delete(server.stop);
  return r;
}

// ---- report ----

const v = (x, unit = "") => (x == null ? "–" : `${x}${unit}`);
function table(headers, rows) {
  const w = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (cells) => cells.map((c, i) => String(c).padEnd(w[i])).join("  ");
  return [line(headers), line(w.map((n) => "-".repeat(n))), ...rows.map(line)].join("\n");
}

function report(results) {
  const serverRows = results.map((r) => [
    r.files, v(r.bootEmpty?.mapBuilt?.files), v(r.bootEmpty?.mapBuilt?.buildMs), `${v(r.bootEmpty?.healthMs)}/${v(r.bootEmpty?.quietAtMs)}`, `${v(r.bootEmpty?.healthCpuSec)}/${v(r.bootEmpty?.cpuSec)}`, v(r.bootCold?.healthMs), `${v(r.bootCold?.healthCpuSec)}/${v(r.bootCold?.cpuSec)}`, v(r.bootCold?.threadReadyMs), v(r.bootWarm?.threadReadyMs),
    `${v(r.api?.map?.coldMs)}/${v(r.api?.map?.kb)}`, v(r.api?.sessions?.coldMs), `${v(r.api?.failures?.coldMs)}/${v(r.api?.failures?.warmMs)}`,
    `${v(r.api?.["sessions/:id/steps"]?.coldMs)}/${v(r.api?.["sessions/:id/steps"] ? round(r.api["sessions/:id/steps"].kb / 1024) : null)}`,
    `${v(r.bootEmpty?.peakRssMb)}/${v(r.bootWarm?.peakRssMb)}/${v(r.afterApi?.rssMb)}/${v(r.peakRssMb)}`,
    `${v(r.bootWarm?.rest?.cpuAvg)}/${v(r.live?.server?.cpuAvg)}/${v(r.live?.server?.cpuMax)}`,
    `${v(r.live?.ws?.perSec)}/${v(r.live?.ws?.avgBytes)}`, `${v(r.live?.ws?.stepLatencyMs?.p50)}/${v(r.live?.ws?.stepLatencyMs?.p95)}`,
  ]);
  const serverTable = table(["files", "mapped", "build ms", "boot empty/quiet", "CPU s empty", "boot cold", "CPU s cold", "thread cold", "thread warm", "map ms/KB", "sessions ms", "failures cold/warm", "steps ms/MB", "RSS empty/warm/api/peak MB", "CPU% rest/live/max", "ws msg/s / B", "latency p50/p95"], serverRows);
  const f = (w) => (w ? `${v(w.fps)}fps ${v(w.frameP50)}/${v(w.frameP95)}ms LT${v(w.longTaskMs)} cpu${v(w.mainThreadCpuPct)}%` : "–");
  const frontRows = results.flatMap((r) => (r.front ?? []).map((x) => [
    r.files, `${x.cpu}x`, `${v(x.loadCold?.firstRenderMs)}/${v(x.load?.firstRenderMs)}`, f(x.settle), f(x.rest), f(x.panZoom), f(x.live), f(x.replay),
    `${v(x.threadOpen?.readyMs)}/${v(x.threadOpen?.longestTaskMs)}/${v(x.threadOpen?.stepsFetches)}x`, `${v(x.rest?.heapMb)}/${v(x.replay?.heapMb)}`, x.errors.length ? x.errors.join("; ").slice(0, 60) : "",
  ]));
  const frontTable = table(["files", "cpu", "1st render cold/warm ms", "settle (10s)", "rest", "pan/zoom", "live", "replay 4x", "thread open ms/longest/fetches", "heap rest/replay MB", "errors"], frontRows);
  return `Server (times in ms; "boot" = spawn to /api/health; "quiet" = spawn until its CPU stays under 5%; "CPU s" = server CPU seconds at health/at quiet; "thread" = spawn until /api/sessions lists the long thread complete)\n${serverTable}\n\nFront-end (fps, frame p50/p95 ms, LT = long-task ms in the window, cpu = page main-thread CPU % of the window)\n${frontTable}`;
}

// ---- main ----

const started = new Date();
const result = { label: args.label ?? null, startedAt: started.toISOString(), machine: machine(), options: { sizes, rates, steps, windowMs, liveMs, rate, dpr }, results: [] };
try {
  if (args.build !== false) { log("building server and web"); result.build = build(); }
  result.bundle = bundleSizes();
  const taken = new Set();
  const ports = { server: await freePort(4900, taken), chrome: await freePort(9620, taken) };
  result.ports = ports;
  for (const files of sizes) {
    log(`=== ${files} files ===`);
    try { result.results.push(await benchSize(files, ports)); }
    catch (e) { log(`${files} files failed: ${e.stack}`); result.results.push({ files, errors: [e.message] }); await cleanup(); }
  }
} finally {
  await cleanup();
  result.finishedAt = new Date().toISOString();
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `bench-${sizes.join("-")}f-${started.toISOString().replace(/[:.]/g, "-").slice(0, 19)}.json`);
  writeFileSync(file, JSON.stringify(result, null, 2));
  if (result.bundle) console.log(`Bundle: ${result.bundle.jsKb} KB JS (${result.bundle.jsGzipKb} KB gzip), first load ${result.bundle.initialKb} KB (${result.bundle.initialGzipKb} KB gzip); biggest: ${result.bundle.files.slice(0, 4).map((x) => `${x.name} ${x.kb} KB`).join(", ")}\n`);
  console.log(report(result.results));
  for (const r of result.results) if (r.errors?.length) console.log(`\n${r.files} files: ${r.errors.join("; ")}`);
  console.log(`\nLoad average (1/5/15 min) at each size's start: ${result.results.map((r) => `${r.files}: ${r.loadAvg?.join("/")}`).join(", ")} on ${result.machine.cores} cores`);
  console.log(`\nJSON: ${file}`);
}
