import type { DatabaseSync, StatementSync } from "node:sqlite";
import type { Step } from "../types";

// The steps a pass over calls and their results needs (failures, places): calls, edits and results only, without
// diffs, labels or risk, so a long thread costs a fraction of listSteps. Same Step shape for the fields it fills.
// `version` is a cheap stamp of a thread's steps (count and last seq, from the session/seq index): when it hasn't
// changed, anything computed from the thread's steps is still right, so callers can keep results per thread.

const prepared = new WeakMap<DatabaseSync, { steps: StatementSync; version: StatementSync }>();

function statements(db: DatabaseSync) {
  let s = prepared.get(db);
  if (!s) {
    s = {
      steps: db.prepare(`SELECT id, session_id, seq, ts, kind, text, tool, input, file_path, is_subagent, tool_use_id FROM steps
        WHERE session_id = ? AND kind IN ('tool_call', 'edit', 'tool_result') ORDER BY seq ASC`),
      version: db.prepare(`SELECT count(*) AS n, max(seq) AS last FROM steps WHERE session_id = ?`),
    };
    prepared.set(db, s);
  }
  return s;
}

type Row = { id: string; session_id: string; seq: number; ts: string; kind: Step["kind"]; text: string | null; tool: string | null;
  input: string | null; file_path: string | null; is_subagent: number; tool_use_id: string | null };

export function workSteps(db: DatabaseSync, sessionId: string): Step[] {
  return (statements(db).steps.all(sessionId) as Row[]).map((r) => ({
    id: r.id, sessionId: r.session_id, seq: r.seq, ts: r.ts, kind: r.kind,
    text: r.text ?? undefined,
    tool: r.tool ?? undefined,
    input: r.input ? JSON.parse(r.input) : undefined,
    filePath: r.file_path ?? undefined,
    isSubagent: !!r.is_subagent,
    ...(r.tool_use_id ? { toolUseId: r.tool_use_id } : {}),
  }));
}

export function stepsVersion(db: DatabaseSync, sessionId: string): string {
  const v = statements(db).version.get(sessionId) as { n: number; last: number | null };
  return `${v.n}:${v.last ?? -1}`;
}
