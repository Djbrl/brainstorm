// listSessions: the cached list must show exactly what the old query showed, before and after changes.
const test = require("node:test");
const assert = require("node:assert/strict");
const { writeFileSync, appendFileSync } = require("node:fs");
const { join, resolve, sep, relative, basename } = require("node:path");
const { makeListener, line, jsonl, dist } = require("./helpers.cjs");

/** The listing as it was computed before the cache (a scan of every step per call). */
function legacyList(t) {
  const { promptTitle } = require(dist("listener/listener.service.js"));
  const L = t.listener;
  const db = t.dbs.db;
  const rows = db.prepare(`SELECT * FROM sessions ORDER BY last_event_at DESC`).all();
  const sessions = rows.map((r) => L.rowToSession(r.custom_title ? r : { ...r, title: promptTitle(r.title) ?? "(untitled session)" }));
  const worked = new Set(db.prepare(`SELECT DISTINCT session_id FROM steps WHERE kind IN ('tool_call', 'edit')`).all().map((r) => r.session_id));
  const idle = (s) => !worked.has(s.id) && (s.title.startsWith("/") || s.title === "(untitled session)");
  const shown = sessions.filter((s) => !idle(s));
  return shown.filter((s) => L.isWithinRoot(s.cwd));
}

async function fixture() {
  const t = await makeListener({ root: "/work/demo-repo" });
  const f = (id) => join(t.projectDir, `${id}.jsonl`);
  const write = (id, lines) => writeFileSync(f(id), jsonl(lines));
  write("worked", [line("prompt", { sessionId: "worked", i: 1, text: "fix the bug" }), line("tool", { sessionId: "worked", i: 2 })]);
  write("slash", [line("prompt", { sessionId: "slash", i: 3, text: "<command-name>/compact</command-name>" }), line("text", { sessionId: "slash", i: 4 })]);
  write("untitled", [line("text", { sessionId: "untitled", i: 5 })]);
  write("outside", [line("prompt", { sessionId: "outside", cwd: "/elsewhere", i: 6, text: "hi" }), line("edit", { sessionId: "outside", cwd: "/elsewhere", i: 7 })]);
  write("worktree", [line("prompt", { sessionId: "worktree", cwd: "/work/demo-repo/.claude/worktrees/x", i: 8, text: "in a worktree" }), line("text", { sessionId: "worktree", i: 9 })]);
  write("talk", [line("prompt", { sessionId: "talk", i: 10, text: "just a question" }), line("text", { sessionId: "talk", i: 11 })]);
  writeFileSync(f("custom"), jsonl([line("prompt", { sessionId: "custom", i: 12, text: "/review" })]) + JSON.stringify({ type: "custom-title", sessionId: "custom", customTitle: "My title" }) + "\n");
  for (const id of ["worked", "slash", "untitled", "outside", "worktree", "talk", "custom"]) await t.readNow(f(id), true);
  return { t, f };
}

test("the cached list matches the old query, and follows new steps, titles and workspace changes", async (ctx) => {
  const { t, f } = await fixture();
  const L = t.listener;
  const ids = (list) => list.map((s) => s.id);
  assert.deepEqual(L.listSessions(), legacyList(t));
  assert.deepEqual(ids(L.listSessions()).sort(), ["custom", "talk", "worked", "worktree"]);

  // The slash-command thread does some work: it shows up (the cache is dropped on the worked flip).
  appendFileSync(f("slash"), jsonl([line("edit", { sessionId: "slash", i: 20 })]));
  await t.readNow(f("slash"));
  assert.ok(ids(L.listSessions()).includes("slash"));
  assert.deepEqual(L.listSessions(), legacyList(t));

  // A new untitled thread, then its title arrives.
  writeFileSync(f("late"), jsonl([line("text", { sessionId: "late", i: 21 })]));
  await t.readNow(f("late"));
  assert.deepEqual(L.listSessions(), legacyList(t));
  appendFileSync(f("late"), jsonl([line("prompt", { sessionId: "late", i: 22, text: "now with a title" })]));
  await t.readNow(f("late"));
  assert.ok(ids(L.listSessions()).includes("late"));
  assert.deepEqual(L.listSessions(), legacyList(t));

  // Another workspace: the list follows.
  L.setRoot("/elsewhere");
  assert.deepEqual(ids(L.listSessions()), ["outside"]);
  assert.deepEqual(L.listSessions(), legacyList(t));
  L.setRoot("/work/demo-repo");
  assert.deepEqual(L.listSessions(), legacyList(t));

  // Status is worked out on each call, not cached.
  ctx.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-01T12:00:12Z") });
  assert.equal(L.listSessions().find((s) => s.id === "talk").status, "running");
  ctx.mock.timers.tick(3 * 60_000);
  assert.equal(L.listSessions().find((s) => s.id === "talk").status, "idle");
  ctx.mock.timers.reset();
  // Returned objects are fresh: callers may change them.
  L.listSessions()[0].title = "changed";
  assert.notEqual(L.listSessions()[0].title, "changed");
  await t.close();
});

test("the worked flag is filled in for a database from before it existed", async () => {
  const { t } = await fixture();
  const expected = t.listener.listSessions();
  t.dbs.db.exec(`ALTER TABLE sessions DROP COLUMN worked`);
  const { ListenerService } = require(dist("listener/listener.service.js"));
  const again = new ListenerService(t.dbs, t.bus, { broadcast() {} }, t.cfg);
  again.onModuleInit();
  await again.watcher.close();
  again.offsets = t.listener.offsets;
  assert.deepEqual(again.listSessions(), expected);
  const worked = t.dbs.db.prepare(`SELECT id FROM sessions WHERE worked = 1 ORDER BY id`).all().map((r) => r.id);
  assert.deepEqual(worked, ["outside", "worked"]);
  await t.close();
});
