// GET /sessions/:id/steps sends the stored JSON without parsing it: the bytes must be what JSON.stringify(listSteps) gave.
const test = require("node:test");
const assert = require("node:assert/strict");
const { writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { makeListener, line, jsonl, dist } = require("./helpers.cjs");

test("the steps JSON is byte for byte the serialized step objects, and afterSeq returns the tail", async () => {
  const t = await makeListener();
  const f = join(t.projectDir, "s1.jsonl");
  const odd = 'quotes " and \\ backslash, tab\t, nl\n, cr\r, nul \u0000, bell \u0007, line sep  , emoji 🧪, accents éàü, 日本';
  writeFileSync(f, jsonl([
    line("prompt", { i: 0, text: odd }),
    line("tool", { i: 1, tool: "Bash", input: { command: "echo hi", n: 1e21, neg: -0, big: 12345678901234567890, nested: [1, "two", { three: null }], empty: "", t: true } }),
    line("result", { i: 2, text: "ok " + odd, input: "tu_1" }),
    { type: "user", uuid: "err-1", sessionId: "s1", cwd: "/work/demo-repo", timestamp: "2026-10-01T12:00:03.000Z", message: { content: [{ type: "tool_result", tool_use_id: "tu_9", is_error: true, content: "boom" }] } },
    line("edit", { i: 4, input: { file_path: "/work/demo-repo/a.ts", old_string: "before " + odd, new_string: "after" } }),
    { type: "assistant", uuid: "sub-1", sessionId: "s1", isSidechain: true, agentId: "a1", cwd: "/work/demo-repo", timestamp: "2026-10-01T12:00:05.000Z", message: { content: [{ type: "thinking", thinking: "hmm" }, { type: "text", text: "from a subagent" }] } },
    line("text", { i: 6, text: "" }), // empty text: no step
  ]));
  await t.readNow(f, true);
  const L = t.listener;
  const steps = L.listSteps("s1");
  L.updateStep(steps[1].id, { label: "Ran a command", risk: ["touches auth", odd] });
  L.updateStep(steps[0].id, { label: "" });
  // Rows written by older versions or other paths: odd stored values.
  t.dbs.db.prepare(`INSERT INTO steps (id, session_id, seq, ts, kind, text, input, diff, risk, is_subagent) VALUES ('x:0', 's1', 100, 't', 'tool_call', '', 'null', '', NULL, 0)`).run();
  t.dbs.db.prepare(`INSERT INTO steps (id, session_id, seq, ts, kind, input, is_subagent) VALUES ('x:1', 's1', 101, 't', 'tool_call', '{"a":[1,2,{"b":"c"}],"d":1.5}', 1)`).run();

  const full = JSON.stringify(L.listSteps("s1"));
  assert.equal(L.listStepsJson("s1"), full);
  assert.deepEqual(JSON.parse(L.listStepsJson("s1")), JSON.parse(full));
  for (const after of [-1, 0, 2, 5, 100, 101, 1000]) {
    assert.equal(L.listStepsJson("s1", after), JSON.stringify(L.listSteps("s1").filter((s) => s.seq > after)), `afterSeq ${after}`);
  }
  assert.equal(L.listStepsJson("nope"), "[]");

  // The controller sends that text as JSON; a bad afterSeq is ignored.
  const { SessionsController } = require(dist("listener/sessions.controller.js"));
  const c = new SessionsController(L);
  const res = () => ({ body: undefined, ct: undefined, type(t) { this.ct = t; return this; }, send(b) { this.body = b; return this; } });
  for (const [q, expected] of [[undefined, full], ["3", L.listStepsJson("s1", 3)], ["abc", full], ["", full]]) {
    const r = res();
    c.steps("s1", q, r);
    assert.equal(r.ct, "application/json");
    assert.equal(r.body, expected, `afterSeq=${q}`);
  }
  await t.close();
});

test("updateStep can store a label without broadcasting it", async () => {
  const t = await makeListener();
  const f = join(t.projectDir, "s1.jsonl");
  writeFileSync(f, jsonl([line("tool", { i: 1 })]));
  await t.readNow(f, true);
  const [step] = t.listener.listSteps("s1");
  t.listener.updateStep(step.id, { label: "quiet" }, { broadcast: false });
  assert.equal(t.sent.length, 0);
  assert.equal(t.listener.getStep(step.id).label, "quiet");
  t.listener.updateStep(step.id, { label: "loud", risk: ["x"] });
  assert.deepEqual(t.sent, [{ type: "step-update", id: step.id, label: "loud", risk: ["x"] }]);
  await t.close();
});
