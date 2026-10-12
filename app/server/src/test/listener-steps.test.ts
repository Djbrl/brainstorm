// GET /sessions/:id/steps sends the stored JSON without parsing it: the bytes must be what JSON.stringify(listSteps) gave.
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeListener, line, jsonl } from "./helpers";
import { SessionsController } from "../listener/sessions.controller";
import { slimStep } from "../listener/step-store";

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
    line("text", { i: 7, text: Array.from({ length: 128 }, (_, c) => String.fromCharCode(c)).join("").slice(1) + " ­   ￿ �" }),
    line("text", { i: 8, text: "lone \ud800 surrogates \udfff x \ud83d" }),
    line("tool", { i: 9, tool: "Weird\u0001Tool", input: { file_path: "/work/demo-repo/dir with spaces/ñ.ts", ctl: "\u0000\u001f\u007f" } }),
  ]));
  await t.readNow(f, true);
  const L = t.listener;
  const steps = L.store.listSteps("s1");
  assert.equal(steps.find((s) => s.id.startsWith("err-1"))!.isError, true); // Step.isError, set at ingestion
  assert.equal(steps.filter((s) => s.isError).length, 1);
  L.store.updateStep(steps[1].id, { label: "Ran a command", risk: ["touches auth", odd] });
  L.store.updateStep(steps[0].id, { label: "" });
  // Rows written by older versions or other paths: odd stored values.
  t.dbs.db.prepare(`INSERT INTO steps (id, session_id, seq, ts, kind, text, input, diff, risk, is_subagent) VALUES ('x:0', 's1', 100, 't', 'tool_call', '', 'null', '', NULL, 0)`).run();
  t.dbs.db.prepare(`INSERT INTO steps (id, session_id, seq, ts, kind, input, is_subagent) VALUES ('x:1', 's1', 101, 't', 'tool_call', '{"a":[1,2,{"b":"c"}],"d":1.5}', 1)`).run();

  const full = JSON.stringify(L.store.listSteps("s1"));
  assert.equal(L.store.listStepsJson("s1"), full);
  assert.deepEqual(JSON.parse(L.store.listStepsJson("s1")), JSON.parse(full));
  for (const after of [-1, 0, 2, 5, 100, 101, 1000]) {
    assert.equal(L.store.listStepsJson("s1", after), JSON.stringify(L.store.listSteps("s1").filter((s) => s.seq > after)), `afterSeq ${after}`);
  }
  assert.equal(L.store.listStepsJson("nope"), "[]");
  // Sent a page at a time: the same bytes, whatever the page size.
  for (const pageSize of [1, 2, 3, 500]) for (const after of [undefined, -1, 2, 101]) for (const slim of [false, true]) {
    assert.equal([...L.store.stepsJsonPages("s1", after, { slim, pageSize })].join(""), L.store.listStepsJson("s1", after, { slim }), `page ${pageSize} after ${after} slim ${slim}`);
  }
  assert.equal([...L.store.stepsJsonPages("nope")].join(""), "[]");

  // The controller sends the slim text (edits without what their diff repeats) as JSON; a bad afterSeq is ignored.
  const slim = L.store.listStepsJson("s1", undefined, { slim: true });
  assert.deepEqual(JSON.parse(slim), JSON.parse(JSON.stringify(L.store.listSteps("s1").map(slimStep))));
  const c = new SessionsController(L.store);
  const res = () => ({ body: undefined as string | undefined, ct: undefined as string | undefined, type(t: string) { this.ct = t; return this; }, send(b: string) { this.body = b; return this; },
    write(b: string) { this.body = (this.body ?? "") + b; return true; }, end() { return this; }, on() { return this; }, once() { return this; }, removeListener() { return this; } });
  for (const [q, expected] of [[undefined, slim], ["3", L.store.listStepsJson("s1", 3, { slim: true })], ["abc", slim], ["", slim]]) {
    const r = res();
    c.steps("s1", q as string, r as never);
    assert.equal(r.ct, "application/json");
    assert.equal(r.body, expected, `afterSeq=${q}`);
  }
  // The whole input of a trimmed edit, on its own.
  const edit = L.store.listSteps("s1").find((s) => s.kind === "edit")!;
  const r = res();
  c.input(edit.id, r as never);
  assert.deepEqual(JSON.parse(r.body!), { input: edit.input });
  assert.throws(() => c.input("nope", res() as never), /Not Found/);
  await t.close();
});

test("updateStep can store a label without broadcasting it", async () => {
  const t = await makeListener();
  const f = join(t.projectDir, "s1.jsonl");
  writeFileSync(f, jsonl([line("tool", { i: 1 })]));
  await t.readNow(f, true);
  const [step] = t.listener.store.listSteps("s1");
  t.listener.store.updateStep(step.id, { label: "quiet" }, { broadcast: false });
  const updates = () => t.sent.filter((m) => m.type === "step-update");
  assert.equal(updates().length, 0);
  assert.equal(t.listener.store.getStep(step.id)!.label, "quiet");
  t.listener.store.updateStep(step.id, { label: "loud", risk: ["x"] });
  assert.deepEqual(updates(), [{ type: "step-update", id: step.id, label: "loud", risk: ["x"] }]);
  await t.close();
});

test("an edit gets its risk flags when stored, from history as live, and the live message matches the stored step", async () => {
  const t = await makeListener({ root: "/work/demo-repo" });
  const auth = { file_path: "/work/demo-repo/src/auth/login.ts", old_string: "a", new_string: "b" };
  const old = join(t.projectDir, "old.jsonl");
  writeFileSync(old, jsonl([line("prompt", { sessionId: "old", i: 1 }), line("edit", { sessionId: "old", i: 2, input: auth })]));
  await t.readNow(old, true);
  assert.deepEqual(t.listener.store.listSteps("old").find((s) => s.kind === "edit")?.risk, ["touches auth"]);
  t.live();
  const now = join(t.projectDir, "now.jsonl");
  writeFileSync(now, jsonl([line("prompt", { sessionId: "now", i: 3 }), line("edit", { sessionId: "now", i: 4, input: { ...auth, file_path: "/work/demo-repo/.env" } })]));
  await t.readNow(now);
  const sent = t.sent.find((m) => m.type === "step" && m.step.kind === "edit") as { step: { risk?: string[] } } | undefined;
  assert.deepEqual(sent?.step.risk, ["touches .env"]);
  assert.equal(JSON.stringify(sent?.step), JSON.stringify(t.listener.store.listSteps("now").find((s) => s.kind === "edit")));
  await t.close();
});
