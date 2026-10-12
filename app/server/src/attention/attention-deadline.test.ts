import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DbService } from "../core/db.service";
import { BusService } from "../core/bus.service";
import type { Step } from "../shared/contract";
import { AttentionService } from "./attention.service";

test("the sweep runs when a thread's state can next change by itself, not every 2 s", () => {
  process.env.RUNDOWN_DATA_DIR = mkdtempSync(join(tmpdir(), "bs-attention-"));
  const dbs = new DbService();
  const bus = new BusService();
  const att = new AttentionService(bus, { broadcast() {} } as any, { listSessions: () => [{ id: "a" }] } as any, dbs);
  att.onModuleInit();
  const a = att as any;
  const now = Date.now();
  assert.ok(a.timerAt <= now + 2_000 + 50, "the first sweep, soon after boot");
  // Nothing tracked: at most SWEEP_MAX_MS away.
  assert.equal(a.nextDeadline(now), now + 10_000);
  // A step a second ago: the next threshold is 4 s after it (a finished turn, or thinking).
  const step: Step = { id: "s0", sessionId: "a", seq: 0, ts: new Date(now - 1_000).toISOString(), kind: "tool_call", tool: "Edit", toolUseId: "t", isSubagent: false };
  dbs.db.prepare(`INSERT INTO steps (id, session_id, seq, ts, kind, tool, tool_use_id, is_subagent) VALUES (?, ?, 0, ?, 'tool_call', 'Edit', 't', 0)`).run(step.id, "a", step.ts);
  bus.emit("step", step);
  const lastTs = Date.parse(step.ts);
  assert.equal(a.nextDeadline(now), lastTs + 4_001);
  assert.equal(a.nextDeadline(lastTs + 4_001), lastTs + 12_001); // then the quiet call's guessed permission
  assert.ok(a.timerAt <= lastTs + 4_001);
  att.onModuleDestroy(); // cleared: never fires again
});
