// A minimal Chrome DevTools Protocol client over Node's built-in WebSocket: launch our own headless Chrome, open a page.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { log, sleep, waitFor } from "./lib.mjs";

export const CHROME_PATHS = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
].filter(Boolean);

/** Launch a private headless Chrome on `port` with its own profile folder. */
export async function launchChrome({ port, userDataDir, width = 1440, height = 900 }) {
  const bin = CHROME_PATHS.find((p) => existsSync(p));
  if (!bin) throw new Error("Chrome not found: set CHROME_PATH");
  rmSync(userDataDir, { recursive: true, force: true });
  mkdirSync(userDataDir, { recursive: true });
  const args = [
    "--headless=new", `--remote-debugging-port=${port}`, "--remote-debugging-address=127.0.0.1", `--user-data-dir=${userDataDir}`,
    `--window-size=${width},${height}`, "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--disable-sync",
    "--disable-background-networking", "--disable-component-update", "--disable-default-apps", "--mute-audio",
    "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows",
    "--enable-precise-memory-info", "about:blank",
  ];
  const child = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
  let exited = false;
  child.on("exit", () => { exited = true; });
  const version = await waitFor(async () => (await fetch(`http://127.0.0.1:${port}/json/version`)).json(), { timeoutMs: 20_000, everyMs: 100 });
  if (!version) { child.kill("SIGKILL"); throw new Error(`Chrome did not open its debug port ${port}`); }
  const conn = await connect(version.webSocketDebuggerUrl);
  return {
    version: version.Browser, conn,
    async newPage() {
      const { targetId } = await conn.send("Target.createTarget", { url: "about:blank" });
      const { sessionId } = await conn.send("Target.attachToTarget", { targetId, flatten: true });
      return new Page(conn, sessionId, targetId);
    },
    async close() {
      try { await conn.send("Browser.close", {}, null, 3000); } catch { /* already gone */ }
      conn.close();
      if (!(await waitFor(() => exited, { timeoutMs: 5000, everyMs: 50 }))) child.kill("SIGKILL");
      await sleep(200);
      rmSync(userDataDir, { recursive: true, force: true });
    },
  };
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let id = 0;
    const pending = new Map();
    const listeners = new Set();
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) {
        const p = pending.get(m.id); pending.delete(m.id); clearTimeout(p.timer);
        m.error ? p.reject(new Error(`${p.method}: ${m.error.message}`)) : p.resolve(m.result);
      } else if (m.method) for (const l of listeners) l(m);
    };
    ws.onerror = (e) => reject(new Error(`CDP socket: ${e.message ?? "error"}`));
    ws.onopen = () => resolve({
      send(method, params = {}, sessionId = null, timeoutMs = 60_000) {
        return new Promise((res, rej) => {
          const msg = { id: ++id, method, params, ...(sessionId ? { sessionId } : {}) };
          const timer = setTimeout(() => { pending.delete(msg.id); rej(new Error(`${method}: CDP timeout after ${timeoutMs} ms`)); }, timeoutMs);
          pending.set(msg.id, { resolve: res, reject: rej, timer, method });
          ws.send(JSON.stringify(msg));
        });
      },
      on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      close() { try { ws.close(); } catch { /* closed */ } },
    });
  });
}

export class Page {
  constructor(conn, sessionId, targetId) { Object.assign(this, { conn, sessionId, targetId }); }
  send(method, params = {}, timeoutMs) { return this.conn.send(method, params, this.sessionId, timeoutMs); }
  on(method, fn) { return this.conn.on((m) => { if (m.sessionId === this.sessionId && m.method === method) fn(m.params); }); }
  /** Evaluate an expression in the page and return its value (awaits promises). */
  async eval(expression, timeoutMs = 60_000) {
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, timeoutMs);
    if (r.exceptionDetails) throw new Error(`page: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  }
  async close() { try { await this.conn.send("Target.closeTarget", { targetId: this.targetId }); } catch { /* gone */ } }
}
