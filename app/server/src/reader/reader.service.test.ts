// Run: npx tsc -p . && node --test dist/
import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DbService } from "../core/db.service";
import { BusService } from "../core/bus.service";
import type { Step } from "../shared/contract";
import { ReaderService } from "./reader.service";

function setup() {
  process.env.RUNDOWN_DATA_DIR = mkdtempSync(join(tmpdir(), "bs-reader-"));
  const dbs = new DbService();
  const bus = new BusService();
  const reader = new ReaderService(bus, dbs);
  (reader as any).log = { log() {}, warn() {} };
  bus.on("step", (s) => (reader as any).onStep(s));
  const insert = (s: Step) => dbs.db.prepare(`INSERT INTO steps (id, session_id, seq, ts, kind, file_path) VALUES (?, ?, ?, ?, ?, ?)`).run(s.id, s.sessionId, s.seq, s.ts, s.kind, s.filePath ?? null);
  const stored = (id: string) => ({ ...(dbs.db.prepare(`SELECT label, risk FROM steps WHERE id = ?`).get(id) as { label: string | null; risk: string | null }) });
  return { bus, insert, stored };
}

const edit: Step = { id: "s1", sessionId: "a", seq: 0, ts: "2026-10-05T00:00:00.000Z", kind: "edit", filePath: "/r/src/auth/login.ts" };

test("a risky edit carries its risk flags in the same emit, stored without a step-update", () => {
  const { bus, insert, stored } = setup();
  const step = { ...edit };
  insert(step);
  bus.emit("step", step); // the listener broadcasts this same object right after
  assert.deepEqual(step.risk, ["touches auth"]);
  assert.deepEqual(stored("s1"), { label: null, risk: JSON.stringify(["touches auth"]) });
});

test("an ordinary edit gets no flags and no label", () => {
  const { bus, insert, stored } = setup();
  const step = { ...edit, id: "s2", filePath: "/r/src/todo.ts" };
  insert(step);
  bus.emit("step", step);
  assert.equal(step.risk, undefined);
  assert.deepEqual(stored("s2"), { label: null, risk: null });
});
