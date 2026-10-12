import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "./sqlite";
import { migrate, SCHEMA_VERSION } from "./schema";

const version = (db: DatabaseSync) => (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
const cols = (db: DatabaseSync, t: string) => (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);

test("a database from before the migrations (the oldest shape, no user_version) is brought up to date, once", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, cwd TEXT NOT NULL, title TEXT NOT NULL, started_at TEXT NOT NULL, last_event_at TEXT NOT NULL,
    custom_title INTEGER NOT NULL DEFAULT 0, title_set INTEGER NOT NULL DEFAULT 0)`);
  db.exec(`CREATE TABLE steps (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, seq INTEGER NOT NULL, ts TEXT NOT NULL, kind TEXT NOT NULL,
    text TEXT, tool TEXT, input TEXT, file_path TEXT, diff TEXT, label TEXT, risk TEXT, is_subagent INTEGER NOT NULL DEFAULT 0)`);
  db.exec(`CREATE TABLE listener_offsets (file TEXT PRIMARY KEY, offset INTEGER NOT NULL)`);
  db.exec(`INSERT INTO sessions (id, cwd, title, started_at, last_event_at) VALUES ('a', '/r', 't', '2026-01-01', '2026-01-01'), ('b', '/r', 't', '2026-01-01', '2026-01-01')`);
  db.exec(`INSERT INTO steps (id, session_id, seq, ts, kind) VALUES ('a1', 'a', 0, '2026-01-01', 'edit'), ('b1', 'b', 0, '2026-01-01', 'prompt')`);
  db.exec(`INSERT INTO steps (id, session_id, seq, ts, kind, input) VALUES ('a2', 'a', 1, '2026-01-01', 'tool_result', '{"isError":true,"toolUseId":"t"}'),
    ('a3', 'a', 2, '2026-01-01', 'tool_result', 'not json'), ('a4', 'a', 3, '2026-01-01', 'tool_result', NULL)`);
  migrate(db);
  assert.equal(version(db), SCHEMA_VERSION);
  assert.ok(["worked", "harness"].every((c) => cols(db, "sessions").includes(c)));
  assert.ok(["tool_use_id", "agent_id"].every((c) => cols(db, "steps").includes(c)));
  assert.ok(["ino", "head"].every((c) => cols(db, "listener_offsets").includes(c)));
  assert.deepEqual(db.prepare("SELECT id, worked, harness FROM sessions ORDER BY id").all().map((r) => ({ ...r })),
    [{ id: "a", worked: 1, harness: "claude" }, { id: "b", worked: 0, harness: "claude" }]);
  // Step.isError from what older rows kept in input.isError.
  assert.deepEqual(db.prepare("SELECT id FROM steps WHERE is_error = 1").all().map((r) => r.id), ["a2"]);
  for (const t of ["settings", "source_versions", "ask_answers", "attention_hooks", "task_shots", "task_shot_files"]) assert.ok(cols(db, t).length, t);
  db.exec(`UPDATE sessions SET harness = NULL WHERE id = 'b'`);
  migrate(db); // up to date: nothing runs again
  assert.equal((db.prepare("SELECT harness FROM sessions WHERE id = 'b'").get() as { harness: string | null }).harness, null);
});

test("a new database gets every table", () => {
  const db = new DatabaseSync(":memory:");
  migrate(db);
  assert.equal(version(db), SCHEMA_VERSION);
  assert.ok(cols(db, "steps").includes("agent_id"));
  const plan = db.prepare("EXPLAIN QUERY PLAN SELECT * FROM sessions ORDER BY last_event_at DESC").all().map((r) => String(r.detail)).join(" ");
  assert.match(plan, /sessions_last_event/);
});
