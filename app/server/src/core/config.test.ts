// app/.env: read by a dev server, a scratch data folder or not; never by the plugin's server.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadDevEnv } from "./config";

const envFile = () => {
  const f = join(mkdtempSync(join(tmpdir(), "rundown-env-")), ".env");
  writeFileSync(f, "RUNDOWN_TEST_FROM_ENV=yes\nRUNDOWN_MAX_FILES=12\n");
  return f;
};
const clean = () => { for (const k of ["RUNDOWN_TEST_FROM_ENV", "RUNDOWN_MAX_FILES", "RUNDOWN_DATA_DIR", "RUNDOWN_VERSION", "RUNDOWN_PLUGIN_ID"]) delete process.env[k]; };

test("a dev server reads app/.env, also on a scratch data folder; what is already set wins", () => {
  clean();
  process.env.RUNDOWN_DATA_DIR = mkdtempSync(join(tmpdir(), "rundown-data-"));
  process.env.RUNDOWN_MAX_FILES = "99";
  loadDevEnv(envFile());
  assert.equal(process.env.RUNDOWN_TEST_FROM_ENV, "yes");
  assert.equal(process.env.RUNDOWN_MAX_FILES, "99");
  clean();
});

test("the plugin's server never reads a .env", () => {
  for (const [k, v] of [["RUNDOWN_VERSION", "0.9.1"], ["RUNDOWN_PLUGIN_ID", "rundown@rundown"]]) {
    clean();
    process.env.RUNDOWN_DATA_DIR = "/plugin/data";
    process.env[k] = v;
    loadDevEnv(envFile());
    assert.equal(process.env.RUNDOWN_TEST_FROM_ENV, undefined, k);
  }
  clean();
});

test("no .env is fine", () => {
  clean();
  assert.doesNotThrow(() => loadDevEnv(join(tmpdir(), "rundown-no-such-folder", ".env")));
});
