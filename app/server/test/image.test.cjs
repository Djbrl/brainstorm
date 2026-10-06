// GET /api/image: a picture an agent read, served from disk only under the guard rules (image.controller.ts).
const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdirSync, symlinkSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { makeListener, dist, line, jsonl } = require("./helpers.cjs");

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

function fakeRes() {
  const r = { headers: {}, body: undefined, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = b; } };
  return r;
}

async function setup() {
  const t = await makeListener();
  const { ImageController } = require(dist("image/image.controller.js"));
  const ctl = new ImageController(t.listener);
  const dir = join(t.tmp, "pics");
  mkdirSync(dir);
  const files = { png: join(dir, "shot.png"), upper: join(dir, "SHOT2.JPG"), unref: join(dir, "other.png"), txt: join(dir, "notes.txt"), link: join(dir, "link.png"), txtLink: join(dir, "t.txt") };
  writeFileSync(files.png, PNG); writeFileSync(files.upper, PNG); writeFileSync(files.unref, PNG); writeFileSync(files.txt, "secret");
  symlinkSync(files.txt, files.link);
  const f = join(t.projectDir, "s1.jsonl");
  writeFileSync(f, jsonl([
    line("prompt", { i: 0 }),
    ...[files.png, files.upper, files.txt, files.link].map((p, i) => line("tool", { i: i + 1, tool: "Read", input: { file_path: p } })),
  ]));
  await t.readNow(f, true);
  // Same shape as what the Codex reader stores.
  const ask = async (path, opts = {}) => {
    const site = "site" in opts ? opts.site : "same-origin", origin = opts.origin, host = opts.host ?? "127.0.0.1:4000";
    const res = fakeRes();
    try { await ctl.image(path, res, site, origin, host); return { status: 200, res }; }
    catch (e) { return { status: e.getStatus?.() ?? 500, res }; }
  };
  return { t, files, ask };
}

test("a referenced png is served with its type and the safety headers", async () => {
  const { t, files, ask } = await setup();
  try {
    const r = await ask(files.png);
    assert.equal(r.status, 200);
    assert.equal(r.res.headers["content-type"], "image/png");
    assert.equal(r.res.headers["x-content-type-options"], "nosniff");
    assert.equal(r.res.headers["cache-control"], "private, max-age=300");
    assert.deepEqual(r.res.body, PNG);
    const up = await ask(files.upper);   // extension in capitals
    assert.equal(up.status, 200);
    assert.equal(up.res.headers["content-type"], "image/jpeg");
    assert.equal((await ask(files.png, { site: "none" })).status, 200);       // a direct visit
    assert.equal((await ask(files.png, { site: undefined })).status, 200);    // curl: no headers
  } finally { await t.close(); }
});

test("anything else is a plain 404", async () => {
  const { t, files, ask } = await setup();
  try {
    assert.equal((await ask(files.unref)).status, 404, "a picture no step referenced");
    assert.equal((await ask(files.txt)).status, 404, "referenced, but not a picture");
    assert.equal((await ask(files.link)).status, 404, "a .png that is a link to a .txt");
    assert.equal((await ask(join(files.png, "..", "gone.png"))).status, 404, "not on disk");
    assert.equal((await ask("shot.png")).status, 404, "relative");
    assert.equal((await ask(undefined)).status, 404);
    assert.equal((await ask(["a", "b"])).status, 404);
    assert.equal((await ask(join(files.png, "..", "..", "pics", "other.png"))).status, 404, "resolves to an unreferenced file");
    assert.equal((await ask(files.png, { site: "cross-site" })).status, 404);
    assert.equal((await ask(files.png, { site: "same-site" })).status, 404);
    assert.equal((await ask(files.png, { site: undefined, origin: "https://evil.example" })).status, 404, "no Fetch metadata but an Origin");
    assert.equal((await ask(files.png, { host: "evil.example" })).status, 404, "DNS rebinding");
  } finally { await t.close(); }
});
