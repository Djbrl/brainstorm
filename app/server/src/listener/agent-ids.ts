import { closeSync, openSync, readSync, statSync } from "node:fs";
import { basename, dirname, sep } from "node:path";
import type { DatabaseSync } from "node:sqlite";

// Steps stored before 5 Oct 2026 have no agent_id: it was live only. Without it, a reloaded thread can't tell parallel
// subagents apart. This fills it in once, from the subagent logs the steps came from
// (<project>/<sessionId>/subagents/agent-<id>.jsonl, every line carries its agentId). It only sets agent_id where it is
// missing: no step is added, and seq, offsets and everything else stay as they are. A log that is gone is skipped.

/** The settings key that records the pass is done. */
export const AGENT_IDS_DONE = "agent_ids_backfilled";

export type AgentIdsResult = { files: number; missing: number; filled: number };

const NL = 0x0a;
const yieldToLoop = () => new Promise<void>((r) => setImmediate(r));

/** Fill agent_id on stored subagent steps from their logs, a chunk of a file per transaction, yielding in between.
 * Resolves undefined when it already ran (or was stopped: it runs again next time; every update is idempotent). */
export async function backfillAgentIds(
  db: DatabaseSync,
  opts: { stopped?: () => boolean; chunkBytes?: number; maxLineBytes?: number } = {},
): Promise<AgentIdsResult | undefined> {
  const stopped = opts.stopped ?? (() => false);
  const chunkBytes = opts.chunkBytes ?? 1024 * 1024;
  const maxLineBytes = opts.maxLineBytes ?? 16 * 1024 * 1024;
  db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`);
  if (db.prepare(`SELECT 1 FROM settings WHERE key = ?`).get(AGENT_IDS_DONE)) return undefined;

  // Threads with subagent steps still missing their id, and the subagent logs of those threads read so far.
  const sessions = new Set((db.prepare(`SELECT DISTINCT session_id AS s FROM steps WHERE is_subagent = 1 AND agent_id IS NULL`).all() as { s: string }[]).map((r) => r.s));
  const marker = `${sep}subagents${sep}`;
  const files = (db.prepare(`SELECT file, offset FROM listener_offsets`).all() as { file: string; offset: number }[])
    .filter((f) => f.file.includes(marker) && f.file.endsWith(".jsonl") && sessions.has(basename(dirname(dirname(f.file)))));

  const update = db.prepare(`UPDATE steps SET agent_id = ? WHERE id = ? AND agent_id IS NULL AND is_subagent = 1`);
  const result: AgentIdsResult = { files: 0, missing: 0, filled: 0 };
  const apply = (pairs: [string, string][]) => {
    if (!pairs.length) return;
    db.exec("BEGIN");
    try {
      for (const [agentId, id] of pairs) result.filled += Number(update.run(agentId, id).changes);
      db.exec("COMMIT");
    } catch (e) {
      try { db.exec("ROLLBACK"); } catch { /* already rolled back */ }
      throw e;
    }
  };

  for (const f of files) {
    if (stopped()) return undefined;
    let fd: number | undefined;
    try {
      let end: number;
      try { end = Math.min(f.offset, statSync(f.file).size); fd = openSync(f.file, "r"); } catch { result.missing++; continue; }
      result.files++;
      const buf = Buffer.allocUnsafe(chunkBytes);
      let pos = 0;
      let pending: Buffer | null = null;
      let skipping = false; // inside a line too long to have been stored
      while (pos < end) {
        const n = readSync(fd, buf, 0, Math.min(chunkBytes, end - pos), pos);
        if (n <= 0) break;
        pos += n;
        let data = buf.subarray(0, n);
        if (skipping) {
          const nl = data.indexOf(NL);
          if (nl === -1) continue;
          skipping = false;
          data = data.subarray(nl + 1);
        }
        const work: Buffer = pending ? Buffer.concat([pending, data]) : data;
        pending = null;
        const pairs: [string, string][] = [];
        let s = 0;
        for (let e = work.indexOf(NL); e !== -1; s = e + 1, e = work.indexOf(NL, s)) {
          if (e > s && e - s <= maxLineBytes) idsOfLine(work.toString("utf8", s, e), pairs);
        }
        const rest = work.subarray(s);
        if (rest.length > maxLineBytes) skipping = true;
        else if (rest.length) pending = Buffer.from(rest);
        if (stopped()) return undefined;
        apply(pairs);
        await yieldToLoop();
      }
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  }
  if (stopped()) return undefined;
  db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .run(AGENT_IDS_DONE, JSON.stringify({ at: new Date().toISOString(), ...result }));
  return result;
}

/** The step ids a subagent's log line made (`<uuid>:<block index>`, as the listener names them) with its agentId. A
 * block that made no step names an id that isn't there, which updates nothing. */
function idsOfLine(text: string, out: [string, string][]) {
  let o: { type?: string; uuid?: unknown; isSidechain?: unknown; agentId?: unknown; message?: { content?: unknown } };
  try { o = JSON.parse(text); } catch { return; }
  if (!o || (o.type !== "user" && o.type !== "assistant") || o.isSidechain !== true) return;
  if (typeof o.uuid !== "string" || typeof o.agentId !== "string" || !o.agentId) return;
  const content = o.message?.content;
  const blocks = Array.isArray(content) ? content.length : 1;
  for (let i = 0; i < blocks; i++) out.push([o.agentId, `${o.uuid}:${i}`]);
}
