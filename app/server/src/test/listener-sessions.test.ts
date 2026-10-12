// listSessions: the cached list must show exactly what the old query showed, before and after changes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import { makeListener, line, jsonl, type TestListener } from "./helpers";
import type { Session } from "../shared/contract";

type Row = Record<string, any>;
import { promptTitle, ListenerService } from "../listener/listener.service";
import { migrate } from "../core/schema";

/** The listing as it was computed before the cache (a scan of every step per call). */
function legacyList(t: TestListener) {
  const L = t.listener;
  const db = t.dbs.db;
  const rows = db.prepare(`SELECT * FROM sessions ORDER BY last_event_at DESC`).all() as Row[];
  const sessions = rows.map((r) => (L.store as unknown as { rowToSession(r: Row): Session }).rowToSession(r.custom_title ? r : { ...r, title: promptTitle(r.title) ?? "(untitled session)" }));
  const worked = new Set(db.prepare(`SELECT DISTINCT session_id FROM steps WHERE kind IN ('tool_call', 'edit')`).all().map((r) => (r as Row).session_id));
  const idle = (s: Session) => !worked.has(s.id) && (s.title.startsWith("/") || s.title === "(untitled session)");
  const shown = sessions.filter((s) => !idle(s));
  return shown.filter((s) => L.project.isWithinRoot(s.cwd));
}

async function fixture() {
  const t = await makeListener({ root: "/work/demo-repo" });
  const f = (id: string) => join(t.projectDir, `${id}.jsonl`);
  const write = (id: string, lines: unknown[]) => writeFileSync(f(id), jsonl(lines));
  write("worked", [line("prompt", { sessionId: "worked", i: 1, text: "fix the bug" }), line("tool", { sessionId: "worked", i: 2 })]);
  write("slash", [line("prompt", { sessionId: "slash", i: 3, text: "<command-name>/compact</command-name>" }), line("text", { sessionId: "slash", i: 4 })]);
  write("untitled", [line("text", { sessionId: "untitled", i: 5 })]);
  write("outside", [line("prompt", { sessionId: "outside", cwd: "/elsewhere", i: 6, text: "hi" }), line("edit", { sessionId: "outside", cwd: "/elsewhere", i: 7, input: { file_path: "/elsewhere/a.ts", old_string: "a", new_string: "b" } })]);
  write("worktree", [line("prompt", { sessionId: "worktree", cwd: "/work/demo-repo/.claude/worktrees/x", i: 8, text: "in a worktree" }), line("text", { sessionId: "worktree", i: 9 })]);
  write("talk", [line("prompt", { sessionId: "talk", i: 10, text: "just a question" }), line("text", { sessionId: "talk", i: 11 })]);
  writeFileSync(f("custom"), jsonl([line("prompt", { sessionId: "custom", i: 12, text: "/review" })]) + JSON.stringify({ type: "custom-title", sessionId: "custom", customTitle: "My title" }) + "\n");
  for (const id of ["worked", "slash", "untitled", "outside", "worktree", "talk", "custom"]) await t.readNow(f(id), true);
  return { t, f };
}

test("the cached list matches the old query, and follows new steps, titles and workspace changes", async (ctx) => {
  const { t, f } = await fixture();
  const L = t.listener;
  const ids = (list: Session[]) => list.map((s) => s.id);
  assert.deepEqual(L.store.listSessions(), legacyList(t));
  assert.deepEqual(ids(L.store.listSessions()).sort(), ["custom", "talk", "worked", "worktree"]);

  // The slash-command thread does some work: it shows up (the cache is dropped on the worked flip).
  appendFileSync(f("slash"), jsonl([line("edit", { sessionId: "slash", i: 20 })]));
  await t.readNow(f("slash"));
  assert.ok(ids(L.store.listSessions()).includes("slash"));
  assert.deepEqual(L.store.listSessions(), legacyList(t));

  // A new untitled thread, then its title arrives.
  writeFileSync(f("late"), jsonl([line("text", { sessionId: "late", i: 21 })]));
  await t.readNow(f("late"));
  assert.deepEqual(L.store.listSessions(), legacyList(t));
  appendFileSync(f("late"), jsonl([line("prompt", { sessionId: "late", i: 22, text: "now with a title" })]));
  await t.readNow(f("late"));
  assert.ok(ids(L.store.listSessions()).includes("late"));
  assert.deepEqual(L.store.listSessions(), legacyList(t));

  // Another workspace: the list follows.
  t.inner.setRoot("/elsewhere");
  assert.deepEqual(ids(L.store.listSessions()), ["outside"]);
  assert.deepEqual(L.store.listSessions(), legacyList(t));
  t.inner.setRoot("/work/demo-repo");
  assert.deepEqual(L.store.listSessions(), legacyList(t));

  // Status is worked out on each call, not cached.
  ctx.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-01T12:00:12Z") });
  assert.equal(L.store.listSessions().find((s) => s.id === "talk")!.status, "running");
  ctx.mock.timers.tick(3 * 60_000);
  assert.equal(L.store.listSessions().find((s) => s.id === "talk")!.status, "idle");
  ctx.mock.timers.reset();
  // Returned objects are fresh: callers may change them.
  L.store.listSessions()[0]!.title = "changed";
  assert.notEqual(L.store.listSessions()[0]!.title, "changed");
  await t.close();
});

test("the worked flag is filled in for a database from before it existed", async () => {
  const { t } = await fixture();
  const expected = t.listener.store.listSessions();
  t.dbs.db.exec(`ALTER TABLE sessions DROP COLUMN worked; PRAGMA user_version = 0`);
  migrate(t.dbs.db);
  const again = new ListenerService(t.dbs, t.bus, { broadcast() {} }, t.cfg, t.state);
  again.onModuleInit();
  await again.watcher.close();
  (again.tailer as unknown as { offsets: unknown }).offsets = t.listener.tailer.offsets;
  assert.deepEqual(again.store.listSessions(), expected);
  const worked = t.dbs.db.prepare(`SELECT id FROM sessions WHERE worked = 1 ORDER BY id`).all().map((r) => (r as Row).id);
  assert.deepEqual(worked, ["outside", "worked"]);
  await t.close();
});

test("a thread from another project that edits this one's files is a visitor here: listed, and read live", async () => {
  const { t, f } = await fixture();
  const L = t.listener;
  const ids = () => L.store.listSessions().map((s) => s.id);
  assert.ok(!ids().includes("orch"));
  // An orchestrator in its own folder edits a file of the demo repo: from that step on, it's listed here too.
  writeFileSync(f("orch"), jsonl([line("prompt", { sessionId: "orch", cwd: "/orchestrator", i: 30, text: "fix the demo" }),
    line("edit", { sessionId: "orch", cwd: "/orchestrator", i: 31, input: { file_path: "/work/demo-repo/a.ts", old_string: "a", new_string: "c" } })]));
  await t.readNow(f("orch"), true);
  assert.ok(ids().includes("orch"));
  // Opening the demo repo again finds it from the stored steps; its own project lists it as its own.
  t.inner.setRoot("/work/demo-repo");
  await t.inner.project.visitorsFound; // found a moment after the project opens
  assert.ok(ids().includes("orch"));
  assert.ok(t.inner.scope().guests!.ids.has("orch"));
  t.inner.setRoot("/orchestrator");
  assert.deepEqual(ids(), ["orch"]);
  await t.close();
});

test("a sibling project whose folder name starts the same (app-backend, app.v2) is not read; a subfolder is", async () => {
  const t = await makeListener({ root: "/work/demo-repo" });
  t.live();
  t.inner.isListening = true;
  const files: Record<string, string> = {};
  for (const [id, cwd] of [["backend", "/work/demo-repo-backend"], ["v2", "/work/demo-repo.v2"], ["src", "/work/demo-repo/src"], ["own", "/work/demo-repo"]]) {
    const dir = join(t.cfg.claudeProjectsDir, cwd.replace(/[^A-Za-z0-9]/g, "-"));
    mkdirSync(dir, { recursive: true });
    files[id] = join(dir, `${id}.jsonl`);
    writeFileSync(files[id], jsonl([line("prompt", { sessionId: id, cwd, i: 1, text: `in ${id}` }), line("tool", { sessionId: id, cwd, i: 2 })]));
  }
  const claude = t.inner.sources.find((s) => s.harness === "claude")!;
  assert.deepEqual(claude.list(t.inner.scope()).map((f) => basename(f.path, ".jsonl")).sort(), ["own", "src"]);
  for (const f of Object.values(files)) await t.readNow(f);
  const stored = t.dbs.db.prepare(`SELECT id FROM sessions ORDER BY id`).all().map((r) => (r as Row).id);
  assert.deepEqual(stored, ["own", "src"]);
  assert.deepEqual([...new Set(t.sent.filter((m) => m.type === "step").map((m) => (m as { step: { sessionId: string } }).step.sessionId))].sort(), ["own", "src"]);
  await t.close();
});

test("a custom title read before any step doesn't stamp the thread with now (its times come from its steps)", async () => {
  const t = await makeListener({ root: "/work/demo-repo" });
  const f = join(t.projectDir, "renamed.jsonl");
  writeFileSync(f, JSON.stringify({ type: "custom-title", sessionId: "renamed", customTitle: "Named first" }) + "\n");
  await t.readNow(f, true);
  assert.equal(t.listener.store.listSessions().find((s) => s.id === "renamed"), undefined); // only a name: not listed yet
  const steps = [line("prompt", { sessionId: "renamed", i: 1, text: "go" }), line("edit", { sessionId: "renamed", i: 2 })] as { timestamp: string }[];
  appendFileSync(f, jsonl(steps));
  await t.readNow(f, true);
  const row = t.dbs.db.prepare(`SELECT title, started_at, last_event_at FROM sessions WHERE id = 'renamed'`).get() as Row;
  assert.deepEqual([row.title, row.started_at, row.last_event_at], ["Named first", steps[0].timestamp, steps[1].timestamp]);
  assert.ok(Date.parse(row.last_event_at) < Date.now() - 60_000);
  assert.ok(t.listener.store.listSessions().some((s) => s.id === "renamed"));
  await t.close();
});
