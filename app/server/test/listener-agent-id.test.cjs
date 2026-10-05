// Which subagent a step comes from (agent_id) is stored, read back on every path, and filled in once for older steps.
const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { makeListener, line, jsonl, dist } = require("./helpers.cjs");

/** A subagent's log line: same thread, marked as a sidechain with its agent id. */
const sub = (agentId, kind, opts) => ({ ...line(kind, opts), isSidechain: true, agentId });

/** A thread with a main log and two subagents working at once, read as history. */
async function threadWithSubagents(t) {
  const main = join(t.projectDir, "s1.jsonl");
  writeFileSync(main, jsonl([
    line("prompt", { i: 0, text: "split the work" }),
    line("tool", { i: 1, tool: "Agent", input: { description: "one" } }),
    line("tool", { i: 2, tool: "Agent", input: { description: "two" } }),
  ]));
  const dir = join(t.projectDir, "s1", "subagents");
  mkdirSync(dir, { recursive: true });
  const a1 = join(dir, "agent-a1.jsonl");
  const a2 = join(dir, "agent-a2.jsonl");
  writeFileSync(a1, jsonl([
    sub("a1", "prompt", { i: 3, text: "do part one" }),
    { ...sub("a1", "text", { i: 4 }), message: { role: "assistant", content: [{ type: "thinking", thinking: "hmm" }, { type: "text", text: "on it" }, { type: "tool_use", id: "tu_r1", name: "Read", input: { file_path: "/work/demo-repo/a.ts" } }] } },
    sub("a1", "result", { i: 5, input: "tu_r1", text: "file body" }),
    sub("a1", "edit", { i: 6 }),
  ]));
  writeFileSync(a2, jsonl([
    sub("a2", "prompt", { i: 3, text: "do part two" }),
    sub("a2", "tool", { i: 4, tool: "Bash", input: { command: "npm test" } }),
    sub("a2", "result", { i: 5, input: "tu_x", text: "Exit code 1\nfailed\n" + "x".repeat(1000) }),
  ]));
  for (const f of [main, a1, a2]) await t.readNow(f, true);
  return { main, a1, a2 };
}

const agentIds = (db) => Object.fromEntries(db.prepare(`SELECT id, agent_id FROM steps`).all().map((r) => [r.id, r.agent_id]));
/** Every stored column but agent_id, and the offsets: what the backfill must leave alone. */
const rest = (db) => ({
  steps: db.prepare(`SELECT * FROM steps ORDER BY session_id, seq`).all().map(({ agent_id, ...r }) => ({ ...r })),
  offsets: db.prepare(`SELECT * FROM listener_offsets ORDER BY file`).all().map((r) => ({ ...r })),
});

test("a subagent step's agentId is stored and read back on every path", async () => {
  const t = await makeListener();
  await threadWithSubagents(t);
  const L = t.listener;
  const steps = L.listSteps("s1");
  const subs = steps.filter((s) => s.isSubagent);
  assert.equal(subs.length, 9);
  assert.ok(subs.every((s) => s.agentId === "a1" || s.agentId === "a2"));
  assert.ok(steps.filter((s) => !s.isSubagent).every((s) => !("agentId" in s)));
  assert.deepEqual(subs.map((s) => [s.kind, s.agentId]), [
    ["prompt", "a1"], ["thinking", "a1"], ["text", "a1"], ["tool_call", "a1"], ["tool_result", "a1"], ["edit", "a1"],
    ["prompt", "a2"], ["tool_call", "a2"], ["tool_result", "a2"],
  ]);
  // The column, getStep, stepsBefore, the reader's backfill list, the JSON the web loads, the light steps.
  const ids = agentIds(t.dbs.db);
  for (const s of steps) assert.equal(ids[s.id], s.agentId ?? null);
  for (const s of subs) assert.equal(L.getStep(s.id).agentId, s.agentId);
  const last = steps[steps.length - 1];
  assert.deepEqual(L.stepsBefore(last.id, 100), steps.slice(0, -1));
  assert.ok(L.unlabeledSteps(100).filter((s) => s.isSubagent).every((s) => s.agentId));
  assert.equal(L.listStepsJson("s1"), JSON.stringify(steps));
  assert.equal(L.listStepsJson("s1", 4), JSON.stringify(steps.filter((s) => s.seq > 4)));
  const { workSteps } = require(dist("core/work-steps.js"));
  const light = workSteps(t.dbs.db, "s1");
  assert.ok(light.length > 0);
  for (const s of light) assert.equal(s.agentId, steps.find((x) => x.id === s.id).agentId);
  // Live, the step objects sent out carry it too.
  t.live();
  writeFileSync(join(t.projectDir, "s1", "subagents", "agent-a2.jsonl"), jsonl([sub("a2", "text", { i: 9, text: "done" })]), { flag: "a" });
  await t.readNow(join(t.projectDir, "s1", "subagents", "agent-a2.jsonl"));
  const sent = t.sent.filter((m) => m.type === "step").map((m) => m.step);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].agentId, "a2");
  assert.equal(JSON.stringify(L.getStep(sent[0].id)), JSON.stringify(sent[0]));
  await t.close();
});

test("the steps JSON of steps without an agent id is what it was before the column existed", async () => {
  const t = await makeListener();
  await threadWithSubagents(t);
  // As before 5 Oct 2026: subagent steps stored without their id.
  t.dbs.db.exec(`UPDATE steps SET agent_id = NULL WHERE agent_id LIKE 'a2'`);
  // rowToStep as it was, key for key.
  const before = (row) => ({
    id: row.id, sessionId: row.session_id, seq: row.seq, ts: row.ts, kind: row.kind,
    text: row.text ?? undefined, tool: row.tool ?? undefined, input: row.input ? JSON.parse(row.input) : undefined,
    filePath: row.file_path ?? undefined, diff: row.diff ? JSON.parse(row.diff) : undefined,
    label: row.label ?? undefined, risk: row.risk ? JSON.parse(row.risk) : undefined,
    isSubagent: !!row.is_subagent,
    ...(row.tool_use_id ? { toolUseId: row.tool_use_id } : {}),
  });
  const rows = t.dbs.db.prepare(`SELECT * FROM steps WHERE session_id = 's1' ORDER BY seq`).all();
  assert.equal(rows.filter((r) => r.agent_id === null).length, 3 + 3); // the main thread's three steps and a2's three
  // Today's: the same, with agentId after isSubagent when there is one.
  const now = (r) => {
    const { toolUseId, ...head } = before(r);
    return { ...head, ...(r.agent_id ? { agentId: r.agent_id } : {}), ...(toolUseId ? { toolUseId } : {}) };
  };
  assert.equal(t.listener.listStepsJson("s1"), JSON.stringify(rows.map(now)));
  for (const r of rows.filter((r) => r.agent_id === null)) {
    assert.equal(t.listener.listStepsJson("s1", r.seq - 1).split(',{"id":')[0].slice(1).replace(/]$/, ""), JSON.stringify(before(r)), r.id);
  }
  // A thread with no subagents: byte for byte what it was.
  const f = join(t.projectDir, "s2.jsonl");
  writeFileSync(f, jsonl([line("prompt", { sessionId: "s2", text: "hi" }), line("tool", { sessionId: "s2", i: 1 }), line("result", { sessionId: "s2", i: 2, input: "tu_1" }), line("edit", { sessionId: "s2", i: 3 })]));
  await t.readNow(f, true);
  const rows2 = t.dbs.db.prepare(`SELECT * FROM steps WHERE session_id = 's2' ORDER BY seq`).all();
  assert.equal(rows2.length, 4);
  assert.equal(t.listener.listStepsJson("s2"), JSON.stringify(rows2.map(before)));
  assert.ok(!t.listener.listStepsJson("s2").includes("agentId"));
  await t.close();
});

test("the backfill gives older subagent steps their id from their logs, changes nothing else, and runs once", async () => {
  const t = await makeListener();
  await t.listener.agentIdsDone; // the listener's own pass, on an empty database: nothing to do, and recorded as done
  const db = t.dbs.db;
  assert.ok(db.prepare(`SELECT value FROM settings WHERE key = 'agent_ids_backfilled'`).get());
  await threadWithSubagents(t);
  const expected = agentIds(db);
  // A database from before: no ids, the pass not done; one subagent log is gone since.
  db.exec(`UPDATE steps SET agent_id = NULL; DELETE FROM settings`);
  db.prepare(`INSERT INTO listener_offsets (file, offset) VALUES (?, 500)`).run(join(t.projectDir, "s1", "subagents", "agent-gone.jsonl"));
  db.prepare(`INSERT INTO steps (id, session_id, seq, ts, kind, text, is_subagent) VALUES ('gone-1:0', 's1', 50, 't', 'text', 'x', 1)`).run();
  const others = rest(db);

  const { backfillAgentIds } = require(dist("listener/agent-ids.js"));
  // Small reads: lines cross chunk boundaries; one line is too long to have been stored and is skipped.
  const r = await backfillAgentIds(db, { chunkBytes: 97, maxLineBytes: 600 });
  const longLine = Object.entries(expected).filter(([id, a]) => a && !agentIds(db)[id]).map(([id]) => id);
  assert.equal(longLine.length, 1); // a2's long result
  assert.deepEqual(r, { files: 2, missing: 1, filled: 9 - longLine.length });
  const again = await backfillAgentIds(db); // done: not run again
  assert.equal(again, undefined);
  // The full pass (as the listener runs it): every id back as stored live, the step from the gone log left alone.
  db.exec(`DELETE FROM settings`);
  const r2 = await backfillAgentIds(db);
  assert.deepEqual(r2, { files: 2, missing: 1, filled: longLine.length });
  assert.deepEqual(agentIds(db), { ...expected, "gone-1:0": null });
  assert.deepEqual(rest(db), others);
  // Idempotent: a third pass fills nothing and changes nothing.
  db.exec(`DELETE FROM settings`);
  assert.deepEqual(await backfillAgentIds(db), { files: 2, missing: 1, filled: 0 });
  assert.deepEqual(agentIds(db), { ...expected, "gone-1:0": null });
  assert.deepEqual(rest(db), others);
  await t.close();
});

test("only the part of a log that was stored is read, and a listener runs the pass once, at start", async () => {
  const t = await makeListener();
  const { a1 } = await threadWithSubagents(t);
  const db = t.dbs.db;
  await t.listener.agentIdsDone;
  const expected = agentIds(db);
  db.exec(`UPDATE steps SET agent_id = NULL; DELETE FROM settings`);
  // The log grew after it was read: the new lines aren't steps yet, they are left for the listener.
  writeFileSync(a1, jsonl([sub("a1", "text", { i: 20, text: "later" })]), { flag: "a" });

  const { ListenerService } = require(dist("listener/listener.service.js"));
  const start = async () => {
    const l = new ListenerService(t.dbs, t.bus, { broadcast() {} }, t.cfg);
    l.onModuleInit();
    await l.watcher.close();
    await l.agentIdsDone;
    await l.onModuleDestroy();
  };
  await start();
  assert.deepEqual(agentIds(db), expected);
  assert.equal(db.prepare(`SELECT count(*) AS n FROM steps`).get().n, Object.keys(expected).length);
  // Recorded as done: the next start doesn't run it again.
  const someSub = Object.keys(expected).find((id) => expected[id]);
  db.prepare(`UPDATE steps SET agent_id = NULL WHERE id = ?`).run(someSub);
  await start();
  assert.equal(agentIds(db)[someSub], null);
  await t.close();
});
