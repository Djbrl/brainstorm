// Anonymous usage counts: off until a yes, never from a dev build, locked off by DO_NOT_TRACK, and the report holds only
// counts (no paths, no names). fetch is a fake: nothing leaves the machine.
import "reflect-metadata";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Step } from "../shared/contract";
import { BusService } from "../core/bus.service";
import { DbService } from "../core/db.service";
import { SettingsService } from "../core/settings.service";
import { UsageService } from "./usage.service";

const env = { ...process.env };
afterEach(() => { process.env = { ...env }; });
delete process.env.DO_NOT_TRACK;
delete process.env.RUNDOWN_USAGE;

type Sent = { url: string; body: Record<string, any> };
function setup({ status = 200 } = {}) {
  process.env.RUNDOWN_DATA_DIR = mkdtempSync(join(tmpdir(), "rundown-usage-"));
  delete process.env.DO_NOT_TRACK; delete process.env.RUNDOWN_USAGE; delete process.env.RUNDOWN_USAGE_DEV;
  const sent: Sent[] = [];
  globalThis.fetch = (async (url: string, init: { body: string }) => { sent.push({ url: String(url), body: JSON.parse(init.body) }); return new Response(null, { status }); }) as typeof fetch;
  const bus = new BusService();
  const settings = new SettingsService(new DbService());
  const usage = new UsageService(settings, bus);
  usage.onModuleInit();
  const report = () => (usage as unknown as { report(): Promise<void> }).report();
  const step = (sessionId: string) => bus.emit("step", { id: "x", sessionId, seq: 1, ts: "", kind: "edit" } as Step);
  return { usage, bus, settings, sent, report, step, done: () => usage.onModuleDestroy() };
}

test("off until the person says yes: nothing is counted", () => {
  const t = setup();
  t.usage.bump("op");
  t.step("a");
  assert.deepEqual(t.usage.status().pending, {});
  assert.equal(t.usage.status().asked, false);
  t.done();
});

test("once on, uses and live agent work are counted; off again forgets them", () => {
  const t = setup();
  t.usage.setEnabled(true);
  t.usage.bump("op"); t.usage.bump("op"); t.step("a"); t.step("a"); t.step("b");
  t.bus.emit("workspace", { root: "/work/x" } as never);
  assert.deepEqual(t.usage.status().pending, { op: 2, st: 3, pj: 1, se: 2 });
  t.usage.setEnabled(false);
  assert.deepEqual(t.usage.status().pending, {});
  t.done();
});

test("DO_NOT_TRACK and RUNDOWN_USAGE=off lock it off whatever the setting", () => {
  const t = setup();
  t.usage.setEnabled(true);
  process.env.DO_NOT_TRACK = "1";
  t.usage.bump("op");
  assert.equal(t.usage.status().enabled, false);
  assert.equal(t.usage.status().locked, "DO_NOT_TRACK is set");
  delete process.env.DO_NOT_TRACK;
  process.env.RUNDOWN_USAGE = "off";
  assert.equal(t.usage.status().locked, "RUNDOWN_USAGE is off");
  assert.deepEqual(t.usage.status().pending, {});
  t.done();
});

test("a dev build never reports", async () => {
  const t = setup();
  delete process.env.RUNDOWN_VERSION;
  t.usage.setEnabled(true);
  t.usage.bump("op");
  await t.report();
  assert.equal(t.sent.length, 0);
  assert.equal(t.usage.status().sends, false);
  t.done();
});

test("a release reports once a day: counts only, then starts afresh", async () => {
  const t = setup();
  process.env.RUNDOWN_VERSION = "0.9.1";
  t.usage.setEnabled(true);
  t.usage.setTheme("metro");
  t.usage.setTheme("../../etc"); // not a theme: ignored
  t.usage.bump("th"); t.step("a");
  await t.report();
  assert.equal(t.sent.length, 1);
  const { body } = t.sent[0];
  assert.deepEqual(Object.keys(body).sort(), ["c", "id", "kind", "os", "tm", "v"]);
  assert.deepEqual([body.kind, body.v, body.tm, body.c], ["new", "0.9.1", "metro", { th: 1, st: 1, se: 1 }]);
  assert.match(body.id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(t.usage.status().pending, {});
  await t.report(); // same day: nothing more
  assert.equal(t.sent.length, 1);
  t.done();
});

test("a refused report keeps the counts for the next try", async () => {
  const t = setup({ status: 500 });
  process.env.RUNDOWN_VERSION = "0.9.1";
  t.usage.setEnabled(true);
  t.usage.bump("sh");
  await t.report();
  assert.deepEqual(t.usage.status().pending, { sh: 1 });
  assert.equal(t.usage.status().lastSent, null);
  t.done();
});

test("forget asks the site to delete the install's reports, then makes a new id", async () => {
  const t = setup();
  process.env.RUNDOWN_VERSION = "0.9.1";
  t.usage.setEnabled(true);
  t.usage.bump("op");
  await t.report();
  const id = t.sent[0].body.id;
  const r = await t.usage.forget();
  assert.equal(r.deleted, true);
  assert.match(t.sent[1].url, /\/api\/usage-forget$/);
  assert.deepEqual(t.sent[1].body, { id });
  assert.equal(t.settings.get("usage.id"), null);
  t.done();
});
