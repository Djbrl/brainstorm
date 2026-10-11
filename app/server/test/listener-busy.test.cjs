// Another program holding the database's write lock (sqlite3 open in a transaction, a backup, a second server on the
// same folder): the listener waits for it (busy_timeout), and a chunk that still can't be stored is read again on its
// own a moment later, not when the log next grows. Nothing is lost, nothing crashes.
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { writeFileSync, appendFileSync } = require("node:fs");
const { join } = require("node:path");
const { makeListener, line, jsonl, dist } = require("./helpers.cjs");

const until = async (cond, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!cond()) { if (Date.now() > end) throw new Error("timed out"); await new Promise((r) => setTimeout(r, 20)); }
};

/** A second process takes the write lock and keeps it `ms`; resolves once it holds it, with a promise for its exit. */
function holdLock(file, ms) {
  const code = `const { DatabaseSync } = require("node:sqlite"); const db = new DatabaseSync(${JSON.stringify(file)});
    db.exec("PRAGMA busy_timeout = 5000"); db.exec("BEGIN IMMEDIATE"); db.exec("CREATE TABLE IF NOT EXISTS lock_probe (x)");
    process.stdout.write("locked\\n"); setTimeout(() => { db.exec("COMMIT"); db.close(); }, ${ms});`;
  const child = spawn(process.execPath, ["--no-warnings", "-e", code], { stdio: ["ignore", "pipe", "inherit"] });
  const exited = new Promise((r) => child.on("exit", r));
  return new Promise((resolve, reject) => {
    child.stdout.on("data", (d) => { if (String(d).includes("locked")) resolve({ exited }); });
    child.on("error", reject);
  });
}

test("a write lock held 1.5 s by another program: the steps wait for it, none is lost", async () => {
  const t = await makeListener();
  try {
    t.live();
    const f = join(t.projectDir, "s1.jsonl");
    writeFileSync(f, jsonl([line("prompt", { i: 0 }), line("tool", { i: 1 })]));
    await t.readNow(f);
    assert.equal(t.listener.store.listSteps("s1").length, 2);
    const { exited } = await holdLock(join(process.env.RUNDOWN_DATA_DIR, "rundown.db"), 1500);
    appendFileSync(f, jsonl([line("text", { i: 2, text: "during the lock" }), line("tool", { i: 3 })]));
    await t.readNow(f);
    assert.equal(t.listener.store.listSteps("s1").length, 4);
    await exited;
  } finally { await t.close(); }
});

test("a lock held past the timeout: the chunk is read again a moment later without the log growing", async () => {
  const t = await makeListener();
  try {
    t.live();
    t.dbs.db.exec("PRAGMA busy_timeout = 50"); // give up fast, as a lock held longer than 5 s would
    const f = join(t.projectDir, "s2.jsonl");
    const { exited } = await holdLock(join(process.env.RUNDOWN_DATA_DIR, "rundown.db"), 1200);
    writeFileSync(f, jsonl([line("prompt", { sessionId: "s2", i: 0 }), line("tool", { sessionId: "s2", i: 1 }), line("text", { sessionId: "s2", i: 2, text: "last words" })]));
    await t.readNow(f);
    assert.equal(t.listener.store.listSteps("s2").length, 0, "the lock is held: nothing stored yet");
    await exited;
    await until(() => t.listener.store.listSteps("s2").length === 3, 5000);
    assert.deepEqual(t.listener.store.listSteps("s2").map((s) => s.seq), [0, 1, 2]);
    assert.equal(t.sent.filter((m) => m.type === "step" && m.step.sessionId === "s2").length, 3, "each step announced once");
  } finally { await t.close(); }
});

test("safely: a timer's failure is logged, sync or async, never thrown", async () => {
  const { safely } = require(dist("core/safely.js"));
  const warned = [];
  const log = { warn: (m) => warned.push(m) };
  safely(log, "sync", () => { throw new Error("database is locked"); });
  safely(log, "async", async () => { throw new Error("database or disk is full"); });
  safely(log, "fine", () => 1);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(warned, ["sync failed: database is locked", "async failed: database or disk is full"]);
});
