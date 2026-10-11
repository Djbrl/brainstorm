import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSettings, UpdatesService } from "./updates.service";

const service = () => { const s = new UpdatesService(); s.file = join(mkdtempSync(join(tmpdir(), "rundown-updates-")), "settings.json"); return s; };

test("update notifications are on by default, and turn off and on again", () => {
  const s = service();
  assert.deepEqual(s.status(), { enabled: true, locked: null });
  assert.equal(s.setEnabled(false).enabled, false);
  assert.equal(readSettings(s.file).updateCheck, false);
  assert.equal(statSync(s.file).mode & 0o777, 0o600);
  assert.equal(s.setEnabled(true).enabled, true);
});

test("the setting keeps the file's other keys, and a damaged file reads as the default", () => {
  const s = service();
  writeFileSync(s.file, JSON.stringify({ other: 1 }));
  s.setEnabled(false);
  assert.deepEqual(readSettings(s.file), { other: 1, updateCheck: false });
  writeFileSync(s.file, "{not json");
  assert.equal(s.status().enabled, true);
});

test("RUNDOWN_UPDATE_CHECK=0 forces it off", () => {
  const s = service();
  process.env.RUNDOWN_UPDATE_CHECK = "0";
  try { assert.deepEqual(s.status(), { enabled: false, locked: "RUNDOWN_UPDATE_CHECK=0 is set" }); } finally { delete process.env.RUNDOWN_UPDATE_CHECK; }
});
