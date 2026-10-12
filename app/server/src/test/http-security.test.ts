// The HTTP guards, against the real server booted in a child process on a scratch data folder (main.ts wires them, so
// a unit test of local.ts alone wouldn't catch one left out): only localhost Host names, writes only as JSON from this
// machine's pages, the CSP on every answer, and /api/open's refusals.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { WebSocket } from "ws";

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "rundown-http-")));
const project = join(scratch, "project");
const web = join(scratch, "web");
let server: ChildProcess;
let port = 0;
let out = "";

before(async () => {
  mkdirSync(project); mkdirSync(web);
  writeFileSync(join(project, "notes.md"), "# notes");
  writeFileSync(join(scratch, "outside.md"), "not the project's");
  writeFileSync(join(web, "index.html"), "<!doctype html><title>Rundown</title>");
  // 4921-4925 is this suite's range: the plugin's port search goes up from the first if another run holds it.
  server = spawn(process.execPath, [resolve(__dirname, "..", "main.js")], {
    env: {
      PATH: process.env.PATH, HOME: scratch, RUNDOWN_PORT: "4921", RUNDOWN_DATA_DIR: join(scratch, "data"), RUNDOWN_ROOT: project,
      RUNDOWN_WEB_DIR: web, RUNDOWN_CLAUDE_DIR: join(scratch, "claude"), RUNDOWN_CODEX_DIR: join(scratch, "codex"),
      RUNDOWN_UPDATE_CHECK: "0", RUNDOWN_USAGE: "off", RUNDOWN_VERSION: "0.0.0-test", NO_COLOR: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  mkdirSync(join(scratch, "data"), { recursive: true });
  server.stdout!.on("data", (b) => { out += b; });
  server.stderr!.on("data", (b) => { out += b; });
  const end = Date.now() + 20_000;
  while (!port) {
    const m = /http:\/\/127\.0\.0\.1:(\d+)/.exec(out);
    if (m) port = Number(m[1]);
    else if (server.exitCode !== null || Date.now() > end) throw new Error(`the server didn't start:\n${out}`);
    else await new Promise((r) => setTimeout(r, 50));
  }
});

after(() => {
  server?.kill("SIGTERM");
  rmSync(scratch, { recursive: true, force: true });
});

type Res = { status: number; headers: Record<string, string | string[] | undefined>; body: string };
function call(method: string, path: string, { host = `127.0.0.1:${port}`, headers = {}, body }: { host?: string; headers?: Record<string, string>; body?: string } = {}): Promise<Res> {
  return new Promise((ok, fail) => {
    const req = request({ host: "127.0.0.1", port, method, path, headers: { host, ...headers } }, (res) => {
      let data = "";
      res.on("data", (c) => { data += c; });
      res.on("end", () => ok({ status: res.statusCode ?? 0, headers: res.headers, body: data }));
    });
    req.on("error", fail);
    if (body !== undefined) req.write(body);
    req.end();
  });
}
const json = (o: unknown, origin?: string) => ({ headers: { "content-type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify(o) });

test("a Host header that isn't this machine is refused (DNS rebinding)", async () => {
  for (const host of ["evil.example", "evil.example:4921", "127.0.0.1.evil.example", "localhost.evil.example"]) assert.equal((await call("GET", "/api/health", { host })).status, 403, host);
  for (const host of [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`, `web.rundown.localhost:${port}`]) assert.equal((await call("GET", "/api/health", { host })).status, 200, host);
});

test("a write that isn't JSON is refused: a form or a no-cors fetch from another site has nothing to say", async () => {
  for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x"]) {
    const r = await call("POST", "/api/usage/event", { headers: { "content-type": type }, body: "name=op" });
    assert.equal(r.status, 403, type);
  }
  assert.equal((await call("PUT", "/api/usage", { body: '{"enabled":true}' })).status, 403); // no content type
});

test("a JSON write from another site's page is refused; from this machine's it goes through", async () => {
  for (const origin of ["https://evil.example", "http://localhost.evil.example", "null"]) assert.equal((await call("POST", "/api/usage/event", json({ name: "op" }, origin))).status, 403, origin);
  assert.equal((await call("POST", "/api/usage/event", json({ name: "op" }, `http://localhost:${port}`))).status, 204);
  assert.equal((await call("POST", "/api/usage/event", json({ name: "op" }))).status, 204); // a script: no Origin
});

test("every answer carries the CSP, nosniff and no-referrer; pages can't be framed", async () => {
  for (const path of ["/", "/thread/abc/step/1", "/api/health"]) {
    const r = await call("GET", path);
    const csp = String(r.headers["content-security-policy"]);
    assert.match(csp, /default-src 'self'/, path);
    assert.match(csp, /frame-ancestors 'none'/, path);
    assert.match(csp, /script-src 'self'(;|$)/, path); // no inline scripts, no eval
    assert.ok(csp.includes(`connect-src 'self' ws://127.0.0.1:${port}`), csp);
    assert.equal(r.headers["x-content-type-options"], "nosniff");
    assert.equal(r.headers["referrer-policy"], "no-referrer");
  }
  assert.match((await call("GET", "/")).body, /<title>Rundown<\/title>/);
  assert.equal((await call("GET", "/assets/missing-chunk.js")).status, 404);
});

test("/api/open refuses what it shouldn't open, over HTTP too", async () => {
  const open = async (path: unknown, origin?: string) => (await call("POST", "/api/open", json({ path }, origin))).status;
  assert.equal(await open("notes.md"), 400);                          // not a full path
  assert.equal(await open(join(project, "missing.md")), 400);         // not there
  assert.equal(await open(join(scratch, "outside.md")), 403);         // outside the project
  assert.equal(await open(join(project, "notes.md"), "https://evil.example"), 403); // another site
  assert.equal((await call("POST", "/api/open", { headers: { "content-type": "text/plain" }, body: JSON.stringify({ path: join(project, "notes.md") }) })).status, 403);
});

test("the live feed refuses another site's page and a foreign Host", async () => {
  const opens = (headers: Record<string, string>) => new Promise<boolean>((ok) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers });
    ws.on("open", () => { ws.close(); ok(true); });
    ws.on("error", () => ok(false));
  });
  assert.equal(await opens({ origin: "https://evil.example" }), false);
  assert.equal(await opens({ host: "evil.example" }), false);
  assert.equal(await opens({ origin: `http://localhost:${port}` }), false); // a page needs the live token
  assert.equal(await opens({}), true); // a local tool
});
