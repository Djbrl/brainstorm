import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DbService } from "./db.service";

test("the data folder and the database are readable by this account only", { skip: process.platform === "win32" }, () => {
  const dir = join(mkdtempSync(join(tmpdir(), "rd-db-")), "data");
  mkdirSync(dir, { mode: 0o755 });
  writeFileSync(join(dir, "rundown.db"), "", { mode: 0o644 });
  process.env.RUNDOWN_DATA_DIR = dir;
  const dbs = new DbService();
  dbs.db.exec("CREATE TABLE t (x); INSERT INTO t VALUES (1)");
  assert.equal(statSync(dir).mode & 0o777, 0o700);
  for (const f of ["rundown.db", "rundown.db-wal", "rundown.db-shm"]) assert.equal(statSync(join(dir, f)).mode & 0o777, 0o600, f);
  dbs.db.close();
});
