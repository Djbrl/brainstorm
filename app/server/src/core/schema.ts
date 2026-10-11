// Every table in Rundown's database, in one place, and the migrations that bring an older database up to date. The
// database's `PRAGMA user_version` is how many migrations it has had; each new one runs once, in order, in a
// transaction with that count. Never edit a migration that shipped: add one at the end.
import type { DatabaseSync } from "node:sqlite";
import { maskSecrets } from "../privacy/mask";

const columns = (db: DatabaseSync, table: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);

const MIGRATIONS: ((db: DatabaseSync) => void)[] = [
  // 1. Everything before user_version was used: the tables as each module made them (a database from any earlier version
  // may lack some columns, so they're added when missing), and the one-off fixes the listener used to run at start.
  (db) => {
    db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`);
    // The listener: threads, their steps, and how far each log was read.
    db.exec(`CREATE TABLE IF NOT EXISTS listener_offsets (file TEXT PRIMARY KEY, offset INTEGER NOT NULL)`);
    db.exec(`CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY, cwd TEXT NOT NULL, title TEXT NOT NULL,
      started_at TEXT NOT NULL, last_event_at TEXT NOT NULL,
      custom_title INTEGER NOT NULL DEFAULT 0, title_set INTEGER NOT NULL DEFAULT 0
    )`);
    db.exec(`CREATE TABLE IF NOT EXISTS steps (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, seq INTEGER NOT NULL, ts TEXT NOT NULL, kind TEXT NOT NULL,
      text TEXT, tool TEXT, input TEXT, file_path TEXT, diff TEXT, label TEXT, risk TEXT,
      is_subagent INTEGER NOT NULL DEFAULT 0
    )`);
    // `sessions.worked`, kept up to date as steps are stored, instead of a scan of every step per list.
    if (!columns(db, "sessions").includes("worked")) {
      db.exec(`ALTER TABLE sessions ADD COLUMN worked INTEGER NOT NULL DEFAULT 0`);
      db.exec(`UPDATE sessions SET worked = 1 WHERE id IN (SELECT DISTINCT session_id FROM steps WHERE kind IN ('tool_call', 'edit'))`);
    }
    // Which coding agent a thread ran in.
    if (!columns(db, "sessions").includes("harness")) db.exec(`ALTER TABLE sessions ADD COLUMN harness TEXT`);
    const stepCols = columns(db, "steps");
    // Pairs a tool result with its call exactly (older rows are paired by order).
    if (!stepCols.includes("tool_use_id")) db.exec(`ALTER TABLE steps ADD COLUMN tool_use_id TEXT`);
    // Which subagent a step comes from, so parallel subagents stay apart after a reload. Steps stored before then get
    // theirs from their logs, once (listener/agent-ids.ts).
    if (!stepCols.includes("agent_id")) db.exec(`ALTER TABLE steps ADD COLUMN agent_id TEXT`);
    // Which file an offset is in, to notice a log replaced or cut short (listener openLog).
    const offsetCols = columns(db, "listener_offsets");
    if (!offsetCols.includes("ino")) db.exec(`ALTER TABLE listener_offsets ADD COLUMN ino INTEGER`);
    if (!offsetCols.includes("head")) db.exec(`ALTER TABLE listener_offsets ADD COLUMN head TEXT`);
    db.exec(`CREATE INDEX IF NOT EXISTS steps_session_seq ON steps(session_id, seq)`);
    db.exec(`CREATE INDEX IF NOT EXISTS steps_label ON steps(kind, label)`);
    // "was this file touched by a step?" for the picture endpoint (image/).
    db.exec(`CREATE INDEX IF NOT EXISTS steps_file ON steps(file_path)`);
    // The reading version of each agent's logs: a change has its threads read again (listener rereadChangedSources).
    db.exec(`CREATE TABLE IF NOT EXISTS source_versions (harness TEXT PRIMARY KEY, version INTEGER NOT NULL)`);
    // Ask's answers, kept to answer the same question again.
    db.exec(`CREATE TABLE IF NOT EXISTS ask_answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question TEXT NOT NULL, step_id TEXT NOT NULL DEFAULT '', file_path TEXT NOT NULL DEFAULT '',
      file_hash TEXT NOT NULL DEFAULT '', request TEXT NOT NULL, response TEXT NOT NULL, created_at TEXT NOT NULL)`);
    db.exec(`CREATE INDEX IF NOT EXISTS ask_answers_key ON ask_answers(question, step_id, file_path)`);
    // The last hook each thread sent (attention): a restart still knows a thread waits on the person.
    db.exec(`CREATE TABLE IF NOT EXISTS attention_hooks (session_id TEXT PRIMARY KEY, signal TEXT NOT NULL, at INTEGER NOT NULL)`);
    // Screenshots from Claude in Chrome's steps, and how far each log was read for them.
    db.exec(`CREATE TABLE IF NOT EXISTS task_shots (step_id TEXT NOT NULL, idx INTEGER NOT NULL, session_id TEXT NOT NULL, media TEXT NOT NULL, data BLOB NOT NULL, PRIMARY KEY (step_id, idx))`);
    db.exec(`CREATE INDEX IF NOT EXISTS task_shots_session ON task_shots(session_id)`);
    db.exec(`CREATE TABLE IF NOT EXISTS task_shot_files (file TEXT PRIMARY KEY, offset INTEGER NOT NULL)`);
    // Compacted-conversation recaps were stored as prompts; they read as the agent's text.
    db.exec(`UPDATE steps SET kind = 'text' WHERE kind = 'prompt' AND text LIKE 'This session is being continued from a previous conversation%'`);
    // Claude Code's threads were stored with harness NULL (so a re-read of its logs, which deletes by harness, would
    // have kept them); titles are masked like every other text; times ahead of the clock were kept. Each ran once
    // before, marked in `settings`.
    const done = (key: string) => !!db.prepare(`SELECT 1 FROM settings WHERE key = ?`).get(key);
    if (!done("listener: harness claude")) db.exec(`UPDATE sessions SET harness = 'claude' WHERE harness IS NULL`);
    if (!done("listener: titles masked")) {
      const set = db.prepare(`UPDATE sessions SET title = ? WHERE id = ?`);
      for (const r of db.prepare(`SELECT id, title FROM sessions`).all() as { id: string; title: string }[]) {
        const masked = maskSecrets(r.title);
        if (masked !== r.title) set.run(masked, r.id);
      }
    }
    if (!done("listener: no future times")) {
      const now = new Date().toISOString();
      db.prepare(`UPDATE sessions SET last_event_at = ? WHERE julianday(last_event_at) > julianday(?)`).run(now, now);
    }
  },
  // 2. Step.isError, a column of its own: set at ingestion from now on; older rows had it only as input.isError.
  (db) => {
    if (!columns(db, "steps").includes("is_error")) db.exec(`ALTER TABLE steps ADD COLUMN is_error INTEGER NOT NULL DEFAULT 0`);
    db.exec(`UPDATE steps SET is_error = 1 WHERE kind = 'tool_result' AND input IS NOT NULL AND json_valid(input) AND json_extract(input, '$.isError') = 1`);
  },
];

/** The number of migrations: a database at this user_version is up to date. */
export const SCHEMA_VERSION = MIGRATIONS.length;

/** Brings the database up to date. A database newer than this build (a downgrade) is left as it is. */
export function migrate(db: DatabaseSync): void {
  const at = (db.prepare(`PRAGMA user_version`).get() as { user_version: number }).user_version;
  for (let v = at; v < MIGRATIONS.length; v++) {
    db.exec("BEGIN IMMEDIATE");
    try {
      MIGRATIONS[v](db);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec("COMMIT");
    } catch (e) { try { db.exec("ROLLBACK"); } catch { /* already rolled back */ } throw e; }
  }
}
