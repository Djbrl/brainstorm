// Front-end measurements in our own headless Chrome: time to the first map render, frame times and long tasks in
// 10-second windows (at rest, panning and zooming, while the live writer runs, while a thread replays), JS heap.
import { log, percentile, round, sleep, waitFor } from "./lib.mjs";

/**
 * Runs in the page before any of its scripts. Counts canvas fill() calls per animation frame (each file on the map is
 * one fill in the default theme), so "first render" is the first frame that paints at least `threshold` fills.
 * Records every frame's duration (rAF to rAF) and every long task (main thread busy over 50 ms).
 */
const probe = (threshold) => `(() => {
  const B = window.__bench = { frames: [], longtasks: [], fills: 0, firstRenderAt: null, threshold: ${threshold} };
  const proto = CanvasRenderingContext2D.prototype, fill = proto.fill;
  proto.fill = function (...a) { B.fills++; return fill.apply(this, a); };
  let last = null, lastFills = 0;
  const loop = (t) => {
    if (last !== null) B.frames.push([last, t - last]);
    last = t;
    const drawn = B.fills - lastFills; lastFills = B.fills;
    if (B.firstRenderAt === null && drawn >= B.threshold) B.firstRenderAt = performance.now();
    if (B.frames.length > 40000) B.frames.splice(0, 20000);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) B.longtasks.push([e.startTime, e.duration]); }).observe({ type: "longtask", buffered: true }); } catch {}
  B.window = (a, b) => ({ frames: B.frames.filter(([t]) => t >= a && t < b).map((f) => f[1]), longtasks: B.longtasks.filter(([s]) => s >= a && s < b) });
})();`;

/** Frame and long-task stats for a window [a, b) of page time (ms). */
async function windowStats(page, a, b) {
  const { frames, longtasks } = await page.eval(`__bench.window(${a}, ${b})`);
  const secs = (b - a) / 1000;
  return {
    seconds: round(secs), fps: round(frames.length / secs), frameP50: round(percentile(frames, 50)), frameP95: round(percentile(frames, 95)),
    frameMax: round(Math.max(0, ...frames)), framesOver50ms: frames.filter((f) => f > 50).length,
    longTasks: longtasks.length, longTaskMs: round(longtasks.reduce((s, [, d]) => s + d, 0)), longestTaskMs: round(Math.max(0, ...longtasks.map(([, d]) => d))),
  };
}

const now = (page) => page.eval("performance.now()");
const heapMb = async (page) => { try { const h = await page.send("Runtime.getHeapUsage"); return round(h.usedSize / 1048576); } catch { return null; } };

/** Measure `fn` running for `ms` in the page: frame/long-task stats over exactly that window. */
async function measure(page, ms, during) {
  const a = await now(page);
  const done = during ? during(ms) : sleep(ms);
  await done;
  const b = await now(page);
  return { ...(await windowStats(page, a, b)), heapMb: await heapMb(page) };
}

/** A point on the map canvas with nothing drawn around it, so a drag pans the map instead of dragging a file. */
async function emptySpot(page) {
  return page.eval(`(() => {
    const c = document.querySelector(".map-wrap canvas"); if (!c) return null;
    const r = c.getBoundingClientRect(), k = c.width / r.width, ctx = c.getContext("2d");
    for (let i = 0; i < 400; i++) {
      const x = r.left + r.width * (0.3 + 0.4 * Math.random()), y = r.top + r.height * (0.25 + 0.5 * Math.random());
      const el = document.elementFromPoint(x, y); if (el !== c) continue;
      const d = ctx.getImageData((x - r.left - 6) * k, (y - r.top - 6) * k, 12 * k, 12 * k).data;
      let empty = true; for (let j = 3; j < d.length; j += 4) if (d[j] > 0) { empty = false; break; }
      if (empty) return { x, y };
    }
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, fallback: true };
  })()`);
}

/** Drag the map around and zoom in and out for `ms`. */
async function panZoom(page, ms) {
  const t0 = Date.now();
  let i = 0, events = 0;
  const mouse = (p) => { events++; return page.send("Input.dispatchMouseEvent", p); };
  while (Date.now() - t0 < ms) {
    const spot = (await emptySpot(page)) ?? { x: 720, y: 450 };
    const dir = i % 2 ? 1 : -1;
    await mouse({ type: "mouseMoved", x: spot.x, y: spot.y });
    await mouse({ type: "mousePressed", x: spot.x, y: spot.y, button: "left", buttons: 1, clickCount: 1 });
    let x = spot.x, y = spot.y;
    for (let k = 0; k < 20 && Date.now() - t0 < ms; k++) { x += 6 * dir; y += 3 * dir; await mouse({ type: "mouseMoved", x, y, button: "left", buttons: 1 }); await sleep(16); }
    await mouse({ type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
    for (let k = 0; k < 10 && Date.now() - t0 < ms; k++) { await mouse({ type: "mouseWheel", x, y, deltaX: 0, deltaY: (i % 4 < 2 ? -1 : 1) * 100 }); await sleep(30); }
    i++;
  }
  return events;
}

/** Resource timing for the API calls the page made (ms from navigation start to the end of the body). */
async function apiResources(page) {
  return page.eval(`performance.getEntriesByType("resource").filter((e) => e.name.includes("/api/")).map((e) => ({
    path: new URL(e.name).pathname.replace(/[0-9a-f-]{36}/, ":id"), startMs: Math.round(e.startTime), endMs: Math.round(e.responseEnd),
    kb: Math.round((e.encodedBodySize || e.transferSize) / 102.4) / 10 }))`);
}

/**
 * The whole front-end run at one CPU throttling rate. `liveWriter()` starts the live writer and returns its stop().
 * `threadId` is the long thread to replay. Every step catches its own failure, so one broken phase doesn't hide the rest.
 */
export async function frontRun({ chrome, base, cpu, expectedNodes, threadId, liveWriter, serverSampler, dpr = 1, windowMs = 10_000 }) {
  const out = { cpu, dpr, errors: [] };
  const page = await chrome.newPage();
  const scale = Math.max(1, cpu);
  try {
    await page.send("Page.enable");
    await page.send("Runtime.enable");
    await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: dpr, mobile: false });
    await page.send("Emulation.setCPUThrottlingRate", { rate: cpu });
    await page.send("Page.addScriptToEvaluateOnNewDocument", { source: probe(Math.max(10, Math.floor(expectedNodes * 0.5))) });

    // 1. Load the project map twice: a cold browser cache (first visit), then warm (every later visit). The rest of
    // the run continues on the warm page.
    const load = async () => {
      await page.send("Page.navigate", { url: `${base}/` });
      const at = await waitFor(() => page.eval("__bench.firstRenderAt"), { timeoutMs: 60_000 * scale, everyMs: 200 });
      const nav = await page.eval(`(() => { const n = performance.getEntriesByType("navigation")[0]; return n ? { domContentLoadedMs: Math.round(n.domContentLoadedEventEnd), loadMs: Math.round(n.loadEventEnd) } : {}; })()`).catch(() => ({}));
      // Anything not from our server (web fonts): it blocks the first paint when it's a stylesheet.
      const external = await page.eval(`performance.getEntriesByType("resource").filter((e) => !e.name.startsWith(location.origin)).map((e) => ({ url: e.name.slice(0, 80), ms: Math.round(e.responseEnd - e.startTime) }))`).catch(() => []);
      return { firstRenderMs: at ? round(at) : null, ...nav, external, api: await apiResources(page).catch(() => []) };
    };
    out.loadCold = await load();
    const warm = await load();
    out.load = warm;
    const rendered = warm.firstRenderMs;
    if (!rendered) {
      out.errors.push(`map never rendered within ${60 * scale} s`);
      out.load.bodyText = (await page.eval("document.body.innerText.slice(0, 300)").catch(() => "")) || "";
      return out;
    }
    // The 10 s after the first render (the layout is still settling), then 10 s at rest.
    const waitUntil = rendered + windowMs - (await now(page));
    if (waitUntil > 0) await sleep(waitUntil + 100);
    out.settle = await windowStats(page, rendered, rendered + windowMs).catch((e) => ({ error: e.message }));
    out.settle.heapMb = await heapMb(page);
    out.rest = await measure(page, windowMs);

    // 2. Panning and zooming.
    try { let events = 0; out.panZoom = await measure(page, windowMs, async (ms) => { events = await panZoom(page, ms); }); out.panZoom.inputEvents = events; }
    catch (e) { out.errors.push(`pan/zoom: ${e.message}`); }
    await sleep(1500);

    // 3. The live writer appending to a running thread, map at rest.
    try {
      const writer = liveWriter();
      const s = serverSampler?.();
      out.live = await measure(page, windowMs);
      out.live.serverDuringFront = s?.stop();
      out.live.writer = await writer.stop();
    } catch (e) { out.errors.push(`live: ${e.message}`); }

    // 4. Open the long thread and replay it at 4x.
    try {
      await page.send("Page.navigate", { url: `${base}/thread/${threadId}` });
      const t0 = Date.now();
      const ready = await waitFor(() => page.eval(`(() => { const b = [...document.querySelectorAll("button.dock-replay")].find((x) => /Replay/.test(x.textContent)); return b && !b.disabled ? performance.now() : null; })()`), { timeoutMs: 120_000 * scale, everyMs: 250 });
      const api = (await apiResources(page).catch(() => [])).filter((r) => r.path.includes("/sessions/") || r.path.includes("/tasks/") || r.path.includes("/cowork"));
      const stepsCalls = api.filter((r) => r.path.endsWith("/steps"));
      out.threadOpen = { readyMs: ready ? round(ready) : null, wallMs: Date.now() - t0, stepsFetches: stepsCalls.length, stepsMb: round(stepsCalls.reduce((s, r) => s + r.kb, 0) / 1024), api };
      if (!ready) { out.errors.push(`thread ${threadId} never became replayable within ${120 * scale} s`); return out; }
      const openWindow = await windowStats(page, 0, ready).catch(() => null);
      if (openWindow) Object.assign(out.threadOpen, { longTasks: openWindow.longTasks, longTaskMs: openWindow.longTaskMs, longestTaskMs: openWindow.longestTaskMs });
      out.threadOpen.heapMb = await heapMb(page);
      await sleep(1000);
      await page.eval(`[...document.querySelectorAll("button.dock-replay")].find((x) => /Replay/.test(x.textContent)).click()`);
      await waitFor(() => page.eval(`!!document.querySelector(".rp-speed button")`), { timeoutMs: 10_000 * scale });
      await page.eval(`[...document.querySelectorAll(".rp-speed button")].find((b) => b.textContent.trim() === "4×")?.click()`);
      const pos = () => page.eval(`document.querySelector(".rp-slider input")?.value ?? null`).then(Number).catch(() => null);
      const p0 = await pos();
      out.replay = await measure(page, windowMs);
      const p1 = await pos();
      out.replay.beatsAdvanced = p0 != null && p1 != null ? p1 - p0 : null;
      out.replay.beatsTotal = await page.eval(`Number(document.querySelector(".rp-slider input")?.max ?? 0) + 1`).catch(() => null);
    } catch (e) { out.errors.push(`replay: ${e.message}`); }
    return out;
  } catch (e) {
    out.errors.push(e.message);
    return out;
  } finally {
    await page.send("Emulation.setCPUThrottlingRate", { rate: 1 }).catch(() => {});
    await page.close();
    if (out.errors.length) log(`front (cpu ${cpu}x): ${out.errors.join("; ")}`);
  }
}
