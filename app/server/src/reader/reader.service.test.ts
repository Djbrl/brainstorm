// Run: npx tsc -p . && node --test dist/
import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DbService } from "../core/db.service";
import { BusService } from "../core/bus.service";
import type { Step, WsMessage } from "../types";
import { ReaderService } from "./reader.service";

function setup(nemotron = false) {
  process.env.BRAINSTORM_DATA_DIR = mkdtempSync(join(tmpdir(), "bs-reader-"));
  const dbs = new DbService();
  dbs.db.exec(`CREATE TABLE steps (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, seq INTEGER NOT NULL, ts TEXT NOT NULL, kind TEXT NOT NULL,
    text TEXT, tool TEXT, input TEXT, file_path TEXT, diff TEXT, label TEXT, risk TEXT, is_subagent INTEGER NOT NULL DEFAULT 0, tool_use_id TEXT)`);
  dbs.db.exec(`CREATE INDEX steps_label ON steps(kind, label)`);
  const sent: WsMessage[] = [];
  const bus = new BusService();
  const gateway = { broadcast: (m: WsMessage) => sent.push(m) };
  const listener = { getStep: (id: string) => { const r = dbs.db.prepare(`SELECT * FROM steps WHERE id = ?`).get(id) as any; return r && { id: r.id, sessionId: r.session_id, seq: r.seq, ts: r.ts, kind: r.kind, filePath: r.file_path ?? undefined, label: r.label ?? undefined }; } };
  const llm = { enabled: nemotron, complete: async () => ({ text: "Tidies the todo list", tokensIn: 0, tokensOut: 0 }) };
  const reader = new ReaderService(bus, dbs, gateway as any, { defaultRoot: "/r" } as any, llm as any, listener as any, {} as any);
  (reader as any).log = { log() {}, warn() {} };
  bus.on("step", (s) => (reader as any).onStep(s));
  const insert = (s: Step) => dbs.db.prepare(`INSERT INTO steps (id, session_id, seq, ts, kind, file_path, label) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(s.id, s.sessionId, s.seq, s.ts, s.kind, s.filePath ?? null, s.label ?? null);
  const label = (id: string) => ({ ...(dbs.db.prepare(`SELECT label, risk FROM steps WHERE id = ?`).get(id) as { label: string | null; risk: string | null }) });
  return { bus, sent, reader, insert, label };
}

const edit: Step = { id: "s1", sessionId: "a", seq: 0, ts: "2026-10-05T00:00:00.000Z", kind: "edit", filePath: "/r/src/auth/login.ts" };

test("a live step carries its heuristic label in the same emit, stored without a step-update", () => {
  const { bus, sent, insert, label } = setup();
  const step = { ...edit };
  insert(step);
  bus.emit("step", step); // the listener broadcasts this same object right after
  assert.equal(step.label, "Edit login.ts");
  assert.deepEqual(step.risk, ["touches auth"]);
  assert.deepEqual(label("s1"), { label: "Edit login.ts", risk: JSON.stringify(["touches auth"]) });
  assert.equal(sent.length, 0);
});

test("a later AI label still goes out as a step-update", async () => {
  const { bus, sent, insert, label } = setup(true);
  const step = { ...edit };
  insert(step);
  bus.emit("step", step);
  await new Promise((r) => setImmediate(r));
  assert.equal(label("s1").label, "Tidies the todo list");
  assert.deepEqual(sent, [{ type: "step-update", id: "s1", label: "Tidies the todo list", risk: ["touches auth"] }]);
});

test("relabelBadSteps replaces an echoed label and leaves good ones", () => {
  const { reader, sent, insert, label } = setup();
  insert({ ...edit, id: "good", label: "Edit login.ts" });
  insert({ ...edit, id: "bad", label: "Return ONLY the label, nothing else. Rules: at most 8 words, plain English, present tense" });
  (reader as any).relabelBadSteps();
  assert.equal(label("good").label, "Edit login.ts");
  assert.equal(label("bad").label, "Edit login.ts");
  assert.deepEqual(sent.map((m) => m.type === "step-update" && m.id), ["bad"]);
});
