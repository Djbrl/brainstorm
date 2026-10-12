// Reading Claude Code logs: chunks, multibyte text, long lines, offsets, live vs history, rollback.
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, appendFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { WsMessage } from "../shared/contract";
import { makeListener, line, jsonl, type TestListener } from "./helpers";

type Row = Record<string, any>;

const rows = (t: TestListener) => t.dbs.db.prepare(`SELECT id, session_id, seq, ts, kind, text, tool, input, file_path, diff, is_subagent, tool_use_id FROM steps ORDER BY session_id, seq`).all().map((r) => ({ ...r })) as Row[];
const offset = (t: TestListener, f: string) => (t.dbs.db.prepare(`SELECT offset FROM listener_offsets WHERE file = ?`).get(f) as { offset: number } | undefined)?.offset;

/** A thread with multibyte text everywhere (2-, 3- and 4-byte characters) so small chunks cut inside characters. */
function thread(n = 40) {
  const out = [line("prompt", { i: 0, text: "Fais le café ☕ — 日本語のテスト 🚀🚀" })];
  for (let i = 1; i < n; i++) {
    out.push(line(i % 3 === 0 ? "edit" : i % 3 === 1 ? "tool" : "text", { i, text: `étape ${i} ✓ ${"é".repeat(i)} 𝄞`, input: i % 3 === 0 ? { file_path: "/work/demo-repo/ü.ts", old_string: "ä", new_string: `ö${i}🙂` } : undefined }));
  }
  return out;
}

test("small chunks and batches store exactly what one big read stores, offsets byte-exact", async () => {
  const lines = thread();
  const results = [];
  for (const [chunk, batch] of [[4 << 20, 1 << 20], [7, 13], [64, 5], [1000, 300]]) {
    const t = await makeListener();
    t.listener.tailer.chunkBytes = chunk;
    t.listener.tailer.batchBytes = batch;
    const f = join(t.projectDir, "s1.jsonl");
    writeFileSync(f, jsonl(lines));
    await t.readNow(f, true);
    assert.equal(offset(t, f), statSync(f).size, `offset for chunk ${chunk}`);
    results.push(rows(t));
    await t.close();
  }
  assert.ok(results[0].length >= 40);
  assert.ok(results[0].some((r) => r.text?.includes("日本語")));
  for (const r of results.slice(1)) assert.deepEqual(r, results[0]);
});

test("a partial last line waits; the rest is read once it is complete", async () => {
  const t = await makeListener();
  t.listener.tailer.chunkBytes = 16;
  const f = join(t.projectDir, "s1.jsonl");
  const [a, b] = [JSON.stringify(line("prompt", { i: 0, text: "première ✨" })), JSON.stringify(line("text", { i: 1, text: "deuxième 🎉" }))];
  const cut = Buffer.from(b).length - 5; // inside the 🎉's bytes area or near it
  writeFileSync(f, Buffer.concat([Buffer.from(a + "\n"), Buffer.from(b).subarray(0, cut)]));
  await t.readNow(f, true);
  assert.equal(offset(t, f), Buffer.byteLength(a + "\n"));
  assert.equal(rows(t).length, 1);
  appendFileSync(f, Buffer.concat([Buffer.from(b).subarray(cut), Buffer.from("\n")]));
  await t.readNow(f, true);
  assert.equal(offset(t, f), statSync(f).size);
  assert.deepEqual(rows(t).map((r) => r.text), ["première ✨", "deuxième 🎉"]);
  await t.close();
});

test("a line longer than the limit is skipped, wherever the chunks fall; the lines around it are kept", async () => {
  for (const chunk of [64, 100_000]) {
    const t = await makeListener();
    t.listener.tailer.chunkBytes = chunk;
    t.listener.tailer.maxLineBytes = 2_000;
    const f = join(t.projectDir, "s1.jsonl");
    writeFileSync(f, jsonl([line("prompt", { i: 0, text: "avant" }), line("text", { i: 1, text: "x".repeat(5_000) }), line("text", { i: 2, text: "après" })]));
    await t.readNow(f, true);
    assert.deepEqual(rows(t).map((r) => r.text), ["avant", "après"], `chunk ${chunk}`);
    assert.equal(offset(t, f), statSync(f).size);
    await t.close();
  }
});

test("an over-long line still being written: the offset stays before it", async () => {
  const t = await makeListener();
  t.listener.tailer.chunkBytes = 64;
  t.listener.tailer.maxLineBytes = 500;
  const f = join(t.projectDir, "s1.jsonl");
  const first = JSON.stringify(line("prompt", { i: 0, text: "avant" })) + "\n";
  writeFileSync(f, first + JSON.stringify(line("text", { i: 1, text: "y".repeat(3000) })).slice(0, 2000));
  await t.readNow(f, true);
  assert.equal(offset(t, f), Buffer.byteLength(first));
  assert.equal(rows(t).length, 1);
  await t.close();
});

test("history is stored quietly; what a file gains after it was listed goes out live, labels riding on the step", async () => {
  const t = await makeListener();
  t.live();
  t.listener.tailer.chunkBytes = 50; // many chunks: the read yields often
  t.listener.tailer.batchBytes = 50;
  t.bus.on("step", (s) => { s.label = `label ${s.seq}`; }); // what the reader does in its bus handler
  const f = join(t.projectDir, "s1.jsonl");
  writeFileSync(f, jsonl(thread(30)));
  const listed = statSync(f).size;
  t.listener.tailer.historyEnd.set(f, listed);
  const reading = t.listener.tailer.runFile(f, listed); // the backfill
  await new Promise((r) => setImmediate(r));
  appendFileSync(f, jsonl([line("text", { i: 99, text: "en direct" })]));
  const live = t.listener.tailer.runFile(f, t.listener.tailer.historyEnd.get(f) ?? 0); // chokidar "change" during the read
  await Promise.all([reading, live]);
  const steps = t.sent.filter((m) => m.type === "step").map((m) => m.step);
  assert.deepEqual(steps.map((s) => s.text), ["en direct"]);
  assert.equal(steps[0].label, `label ${steps[0].seq}`);
  assert.equal(offset(t, f), statSync(f).size);
  assert.equal(t.listener.tailer.historyEnd.has(f), false);
  await t.close();
});

test("a live file is broadcast in order, the session before its first step", async () => {
  const t = await makeListener();
  t.live();
  t.inner.isListening = true;
  const f = join(t.projectDir, "s2.jsonl");
  writeFileSync(f, jsonl([line("prompt", { sessionId: "s2", i: 0, text: "go" }), line("tool", { sessionId: "s2", i: 1 }), line("text", { sessionId: "s2", i: 2 })]));
  await t.readNow(f);
  assert.deepEqual(t.sent.map((m) => m.type), ["session", "step", "step", "step"]);
  assert.equal((t.sent[0] as Extract<WsMessage, { type: "session" }>).session.title, "go");
  assert.deepEqual(t.sent.slice(1).map((m) => (m as Extract<WsMessage, { type: "step" }>).step.seq), [0, 1, 2]);
  await t.close();
});

test("a database error rolls the batch back: no rows, offset and seqs unchanged, retried cleanly", async () => {
  const lines = thread(20);
  const clean = await makeListener();
  const fc = join(clean.projectDir, "s1.jsonl");
  writeFileSync(fc, jsonl(lines));
  await clean.readNow(fc, true);
  const expected = rows(clean);
  await clean.close();

  const t = await makeListener();
  t.listener.tailer.batchBytes = 1500;
  const f = join(t.projectDir, "s1.jsonl");
  writeFileSync(f, jsonl(lines));
  const st = (t.listener.store as unknown as { st: { insertStep: { run: (...a: any[]) => unknown } } }).st;
  const stmt = st.insertStep;
  const run = stmt.run.bind(stmt);
  let calls = 0;
  st.insertStep = { run: (...a: any[]) => { if (++calls === 8) { const e = Object.assign(new Error("disk I/O error"), { code: "ERR_SQLITE_ERROR" }); throw e; } return run(...a); } };
  await t.readNow(f, true);
  const partial = rows(t);
  const off = offset(t, f);
  assert.ok(off! > 0 && off! < statSync(f).size, "stopped at a batch boundary");
  assert.ok(partial.length > 0);
  assert.deepEqual(partial, expected.slice(0, partial.length));
  assert.equal((t.listener.writer as unknown as { nextSeq: Map<string, number> }).nextSeq.get("s1"), partial.length);
  st.insertStep = stmt;
  await t.readNow(f, true);
  assert.deepEqual(rows(t), expected);
  assert.equal(offset(t, f), statSync(f).size);
  await t.close();
});
