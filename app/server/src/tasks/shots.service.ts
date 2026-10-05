import { Injectable, OnModuleInit } from "@nestjs/common";
import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import { DbService } from "../core/db.service";
import { ConfigService } from "../core/config.service";

// Owned by the lead. Screenshots that tools returned (browser, computer use, simulator), read from Claude Code's
// session logs and kept in the local database, so a task's filmstrip survives Claude Code's log cleanup.
// Local only: nothing here is part of a replay export.

type Row = { step_id: string; idx: number };

@Injectable()
export class ShotsService implements OnModuleInit {
  constructor(private dbs: DbService, private cfg: ConfigService) {}

  onModuleInit() {
    const db = this.dbs.db;
    db.exec(`CREATE TABLE IF NOT EXISTS task_shots (step_id TEXT NOT NULL, idx INTEGER NOT NULL, session_id TEXT NOT NULL, media TEXT NOT NULL, data BLOB NOT NULL, PRIMARY KEY (step_id, idx))`);
    db.exec(`CREATE INDEX IF NOT EXISTS task_shots_session ON task_shots(session_id)`);
    db.exec(`CREATE TABLE IF NOT EXISTS task_shot_files (file TEXT PRIMARY KEY, offset INTEGER NOT NULL)`);
  }

  /** The session's log and its subagents' logs. */
  private logFiles(sessionId: string): string[] {
    const out: string[] = [];
    let projects: string[] = [];
    try { projects = readdirSync(this.cfg.claudeProjectsDir); } catch { return out; }
    for (const p of projects) {
      const main = join(this.cfg.claudeProjectsDir, p, `${sessionId}.jsonl`);
      if (existsSync(main)) out.push(main);
      const subs = join(this.cfg.claudeProjectsDir, p, sessionId, "subagents");
      if (existsSync(subs)) for (const f of readdirSync(subs)) if (f.endsWith(".jsonl")) out.push(join(subs, f));
    }
    return out;
  }

  /** Reads what's new in the session's logs and stores the screenshots in it. Cheap when nothing changed. */
  scan(sessionId: string) {
    const db = this.dbs.db;
    for (const file of this.logFiles(sessionId)) {
      let size: number;
      try { size = statSync(file).size; } catch { continue; }
      const row = db.prepare(`SELECT offset FROM task_shot_files WHERE file = ?`).get(file) as { offset: number } | undefined;
      let offset = row?.offset ?? 0;
      if (size < offset) offset = 0; // rewritten
      if (size === offset) continue;
      const buf = Buffer.alloc(size - offset);
      const fd = openSync(file, "r");
      try { readSync(fd, buf, 0, buf.length, offset); } finally { closeSync(fd); }
      const end = buf.lastIndexOf(0x0a) + 1; // complete lines only
      if (end === 0) continue;
      const insert = db.prepare(`INSERT OR IGNORE INTO task_shots (step_id, idx, session_id, media, data) VALUES (?, ?, ?, ?, ?)`);
      for (const line of buf.subarray(0, end).toString("utf8").split("\n")) {
        if (!line.includes('"image"') || !line.includes('"tool_result"')) continue;
        let o: any;
        try { o = JSON.parse(line); } catch { continue; }
        const content = o?.message?.content;
        if (o?.type !== "user" || !Array.isArray(content)) continue;
        content.forEach((b: any, i: number) => {
          if (b?.type !== "tool_result" || !Array.isArray(b.content)) return;
          // Same id the listener gives the result step: `${uuid}:${block index}`.
          b.content.filter((c: any) => c?.type === "image" && c.source?.type === "base64" && typeof c.source.data === "string")
            .forEach((c: any, k: number) => insert.run(`${o.uuid}:${i}`, k, o.sessionId ?? sessionId, String(c.source.media_type ?? "image/png"), Buffer.from(c.source.data, "base64")));
        });
      }
      db.prepare(`INSERT INTO task_shot_files (file, offset) VALUES (?, ?) ON CONFLICT(file) DO UPDATE SET offset = excluded.offset`).run(file, offset + end);
    }
  }

  /** Screenshot counts per result step id. */
  forSession(sessionId: string): Map<string, number> {
    const rows = this.dbs.db.prepare(`SELECT step_id, idx FROM task_shots WHERE session_id = ?`).all(sessionId) as Row[];
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.step_id, Math.max(m.get(r.step_id) ?? 0, r.idx + 1));
    return m;
  }

  /** Whether any screenshot of this result step is stored (a step's screenshots are stored together). */
  has(stepId: string): boolean {
    return !!this.dbs.db.prepare(`SELECT 1 FROM task_shots WHERE step_id = ? LIMIT 1`).get(stepId);
  }

  get(stepId: string, idx: number): { media: string; data: Uint8Array } | undefined {
    return this.dbs.db.prepare(`SELECT media, data FROM task_shots WHERE step_id = ? AND idx = ?`).get(stepId, idx) as { media: string; data: Uint8Array } | undefined;
  }
}
