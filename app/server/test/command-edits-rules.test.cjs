// Which files a finished command is credited with (listener/command-edits.ts): by whole words, never another thread's
// edit, nothing for a file that did not change or a folder the map ignores.
const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { CommandEdits } = require(join(__dirname, "..", "dist", "listener", "command-edits.js"));

const ROOT = realpathSync(mkdtempSync(join(tmpdir(), "bs-cmdrules-")));
mkdirSync(join(ROOT, "src"));
for (const f of ["src/login.ts", "src/a.ts", ".env", "build", "keep.ts"]) writeFileSync(join(ROOT, f), "x\n");
test.after(() => rmSync(ROOT, { recursive: true, force: true }));

const T0 = Date.parse("2026-10-11T10:00:00Z");
const iso = (ms) => new Date(T0 + ms).toISOString();
let n = 0;

/** Runs `command` (thread `sid`, from +0 to +1 s) and returns the edited paths, relative to ROOT. */
function run(ce, command, { sid = "s1", live = true } = {}) {
  const id = `u${++n}`;
  const call = { id: `c${n}`, sessionId: sid, seq: n, ts: iso(0), kind: "tool_call", tool: "Bash", input: { command }, toolUseId: id };
  const result = { id: `r${n}`, sessionId: sid, seq: n + 1, ts: iso(1000), kind: "tool_result", toolUseId: id, text: "" };
  ce.step(call, ROOT);
  const done = ce.step(result, ROOT);
  return ce.editsFor(done, iso(1000), live).filter((s) => s.kind === "edit").map((s) => s.filePath.slice(ROOT.length + 1));
}
const make = () => new CommandEdits((p) => p.startsWith(ROOT), () => ROOT);
const changed = (ce, rel, at = 500, before = "a", after = "b") => ce.fileChanged({ path: join(ROOT, rel), before, after, at: T0 + at });

test("a changed file is matched to the command by whole words", () => {
  const ce = make();
  changed(ce, ".env"); changed(ce, "build"); changed(ce, "src/login.ts"); changed(ce, "keep.ts");
  assert.deepEqual(run(ce, "cat .env.example && npm run build && ls"), [], "'.env.example' is not '.env'; 'npm run build' names no file");
  const ce2 = make();
  changed(ce2, "src/login.ts"); changed(ce2, "keep.ts");
  assert.deepEqual(run(ce2, "npx prettier --write src/login.ts"), ["src/login.ts"], "a project path matches");
  const ce3 = make();
  changed(ce3, "src/login.ts");
  assert.deepEqual(run(ce3, "node format.js login.ts"), ["src/login.ts"], "a bare file name matches");
});

test("a file another thread edited in the window is not credited", () => {
  const ce = make();
  ce.step({ id: "e1", sessionId: "s2", seq: 1, ts: iso(400), kind: "edit", tool: "Edit", filePath: join(ROOT, "src/login.ts"), input: {} }, ROOT);
  changed(ce, "src/login.ts"); changed(ce, "keep.ts");
  assert.deepEqual(run(ce, "npx vitest run src/login.ts keep.ts"), ["keep.ts"]);
  const ce2 = make();
  ce2.step({ id: "e2", sessionId: "s2", seq: 1, ts: iso(400), kind: "edit", tool: "Edit", filePath: join(ROOT, "src/a.ts"), input: {} }, ROOT);
  assert.deepEqual(run(ce2, "sed -i s/x/y/ src/a.ts"), [], "even a file the command writes by its text");
  const ce3 = make();
  ce3.step({ id: "e3", sessionId: "s2", seq: 1, ts: iso(-600000), kind: "edit", tool: "Edit", filePath: join(ROOT, "src/a.ts"), input: {} }, ROOT);
  changed(ce3, "src/a.ts");
  assert.deepEqual(run(ce3, "sed -i s/x/y/ src/a.ts"), ["src/a.ts"], "an edit long before is not in the window");
});

test("live, a parsed write of a file that did not change is dropped; history keeps it", () => {
  const ce = make();
  assert.deepEqual(run(ce, "touch src/a.ts"), []);
  assert.deepEqual(run(ce, "sed -i s/nomatch/y/ src/a.ts"), []);
  changed(ce, "src/a.ts");
  assert.deepEqual(run(ce, "sed -i s/x/y/ src/a.ts"), ["src/a.ts"]);
  assert.deepEqual(run(make(), "touch src/a.ts", { live: false }), ["src/a.ts"]);
  assert.deepEqual(run(make(), "echo hi > src/new.ts"), ["src/new.ts"], "a file that is not there yet is a new file");
});

test("ignored folders and folder deletes give no edits", () => {
  const ce = make();
  assert.deepEqual(run(ce, "rm -rf node_modules dist .cache"), []);
  assert.deepEqual(run(ce, "echo x > dist/out.js"), []);
  assert.deepEqual(run(ce, "rm -rf src/old", { live: false }), [], "a folder without a source file name");
  assert.deepEqual(run(ce, "rm src/old.ts", { live: false }), ["src/old.ts"]);
  assert.deepEqual(run(ce, "rm -rf node_modules && npm install", { live: false }), []);
});
