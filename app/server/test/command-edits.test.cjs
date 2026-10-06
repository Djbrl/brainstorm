// Files an agent changes through a shell command become edits of its thread (listener/command-edits.ts): from the
// command alone in history, with the diff the mapper saw when live.
require("reflect-metadata");
const test = require("node:test");
const assert = require("node:assert/strict");
const { writeFileSync, appendFileSync } = require("node:fs");
const { join } = require("node:path");
const { makeListener, line, jsonl } = require("./helpers.cjs");

const ROOT = "/work/demo-repo";
const SCRIPT = "python3 - <<'PY'\nfrom pathlib import Path\np=Path('app.vue'); s=p.read_text()\np.write_text(s.replace('Hi', 'Hi dad'))\nPY";

function thread(t, i0, command, id) {
  return [
    line("tool", { sessionId: "s1", cwd: ROOT, i: i0, tool: "Bash", input: { command }, id }),
    line("result", { sessionId: "s1", cwd: ROOT, i: i0 + 1, input: `tu_${id}`, text: "" }),
  ];
}

test("history: a command that writes a file is an edit of the thread, without a diff, with its result", async () => {
  const t = await makeListener({ root: ROOT });
  const f = join(t.projectDir, "s1.jsonl");
  writeFileSync(f, jsonl([line("prompt", { sessionId: "s1", cwd: ROOT, i: 0, text: "say hi to dad" }), ...thread(t, 1, SCRIPT, "c1"), ...thread(t, 3, "cat src/a.ts > /tmp/copy.ts", "c2")]));
  await t.readNow(f, true);
  const steps = t.listener.listSteps("s1");
  const edits = steps.filter((s) => s.kind === "edit");
  assert.equal(edits.length, 1, "the /tmp copy isn't the project's");
  assert.equal(edits[0].filePath, `${ROOT}/app.vue`);
  assert.equal(edits[0].tool, "Edit");
  assert.equal(edits[0].input.byCommand, true);
  assert.equal(edits[0].diff, undefined);
  assert.ok(steps.some((s) => s.kind === "tool_result" && s.toolUseId === edits[0].toolUseId), "paired with a result");
  assert.ok(edits[0].seq > steps.find((s) => s.kind === "tool_result").seq, "after the command's result");
  await t.close();
});

test("live: the diff comes from what the mapper saw change while the command ran; a file it names that changed counts too", async () => {
  const t = await makeListener({ root: ROOT });
  t.live();
  const f = join(t.projectDir, "s1.jsonl");
  writeFileSync(f, jsonl([line("prompt", { sessionId: "s1", cwd: ROOT, i: 0, text: "go" })]));
  await t.readNow(f);
  const now = Date.now();
  const start = new Date(now - 2000).toISOString(), end = new Date(now - 500).toISOString();
  const call = line("tool", { sessionId: "s1", cwd: ROOT, i: 1, tool: "Bash", input: { command: `${SCRIPT}\nnpx prettier --write app.css` }, id: "c3" });
  call.timestamp = start;
  const result = line("result", { sessionId: "s1", cwd: ROOT, i: 2, input: "tu_c3", text: "" });
  result.timestamp = end;
  // The mapper saw both files change while it ran, and an unrelated one the command doesn't name.
  t.bus.emit("file-content", { path: `${ROOT}/app.vue`, before: "<h1>Hi</h1>\n<p>a</p>\n", after: "<h1>Hi dad</h1>\n<p>a</p>\n", at: now - 1500 });
  t.bus.emit("file-content", { path: `${ROOT}/app.css`, before: "a{color:red}", after: "a {\n  color: red;\n}", at: now - 1000 });
  t.bus.emit("file-content", { path: `${ROOT}/other.ts`, before: "x", after: "y", at: now - 1000 });
  appendFileSync(f, jsonl([call, result]));
  await t.readNow(f);
  await new Promise((r) => setTimeout(r, 1800)); // live command edits wait for the mapper
  const edits = t.listener.listSteps("s1").filter((s) => s.kind === "edit");
  assert.deepEqual(edits.map((e) => e.filePath).sort(), [`${ROOT}/app.css`, `${ROOT}/app.vue`]);
  const vue = edits.find((e) => e.filePath.endsWith("app.vue"));
  assert.deepEqual(vue.diff, { before: "<h1>Hi</h1>\n<p>a</p>\n", after: "<h1>Hi dad</h1>\n<p>a</p>\n" });
  assert.ok(t.sent.some((m) => m.type === "step" && m.step.id === vue.id), "broadcast live");
  await t.close();
});
