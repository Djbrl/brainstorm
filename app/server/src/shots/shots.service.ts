import { Injectable } from "@nestjs/common";
import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import { DbService } from "../core/db.service";
import { ConfigService } from "../core/config.service";
import { StepsStore } from "../listener/step-store";

// Screenshots that tools returned (browser, computer use, simulator), read from Claude Code's
// session logs and kept in the local database, so they survive Claude Code's log cleanup. The step panel shows them
// (web follow/content/ToolView.tsx). Local only: nothing here is part of a replay export.

const SHOT_MISS_MS = 30 * 1000;

/** The image types a shot may have. Anything else a log claims (text/html, image/svg+xml...) is dropped: it would be
 *  served from the app's own origin. */
export const SHOT_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

@Injectable()
export class ShotsService {
  /** Shots asked for and not found, by `stepId:idx` → when to look again, so a missing one doesn't rescan the logs on every request. */
  private missed = new Map<string, number>();

  constructor(private dbs: DbService, private cfg: ConfigService, private store: StepsStore) {}

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

  /** Reads what's new in the session's logs and stores the screenshots in it. Cheap when nothing changed. A log is
   * read CHUNK_BYTES at a time (a long thread's log is hundreds of MB), each chunk's complete lines stored with the
   * offset after them; a line longer than MAX_LINE_BYTES is skipped. */
  scan(sessionId: string) {
    for (const file of this.logFiles(sessionId)) {
      let size: number;
      try { size = statSync(file).size; } catch { continue; }
      const row = this.dbs.stmt(`SELECT offset FROM task_shot_files WHERE file = ?`).get(file) as { offset: number } | undefined;
      let offset = row?.offset ?? 0;
      if (size < offset) offset = 0; // rewritten
      if (size === offset) continue;
      let fd: number;
      try { fd = openSync(file, "r"); } catch { continue; }
      try {
        let pending: Buffer | null = null; // the start of a line the last chunk cut
        let skipping = false; // inside a line too long to keep: dropped up to its end
        let pos = offset;
        while (pos < size) {
          const chunk = Buffer.allocUnsafe(Math.min(this.chunkBytes, size - pos));
          const n = readSync(fd, chunk, 0, chunk.length, pos);
          if (n <= 0) break;
          pos += n;
          let work: Buffer = pending ? Buffer.concat([pending, chunk.subarray(0, n)]) : chunk.subarray(0, n);
          pending = null;
          if (skipping) {
            const nl = work.indexOf(0x0a);
            if (nl === -1) continue;
            skipping = false;
            work = work.subarray(nl + 1);
          }
          const end = work.lastIndexOf(0x0a) + 1; // complete lines only
          if (end > 0) {
            this.storeLines(work.subarray(0, end), sessionId);
            this.saveOffset(file, pos - (work.length - end));
          }
          const rest = work.subarray(end);
          if (rest.length > this.maxLineBytes) skipping = true;
          else if (rest.length) pending = Buffer.from(rest); // a copy: the chunk isn't kept alive
        }
      } finally { closeSync(fd); }
    }
  }

  /** Bytes read at a time, and the longest line kept (fields so tests can make them small). */
  chunkBytes = 4 * 1024 * 1024;
  maxLineBytes = 32 * 1024 * 1024;

  private saveOffset(file: string, offset: number) {
    this.dbs.stmt(`INSERT INTO task_shot_files (file, offset) VALUES (?, ?) ON CONFLICT(file) DO UPDATE SET offset = excluded.offset`).run(file, offset);
  }

  /** The screenshots in some complete log lines, stored. */
  private storeLines(buf: Buffer, sessionId: string) {
    const insert = this.dbs.stmt(`INSERT OR IGNORE INTO task_shots (step_id, idx, session_id, media, data) VALUES (?, ?, ?, ?, ?)`);
    let s = 0;
    for (let e = buf.indexOf(0x0a, s); s < buf.length; s = e + 1, e = buf.indexOf(0x0a, s)) {
      if (e === -1) e = buf.length;
      const line = buf.toString("utf8", s, e);
      if (!line.includes('"image"') || !line.includes('"tool_result"')) continue;
      let o: any;
      try { o = JSON.parse(line); } catch { continue; }
      const content = o?.message?.content;
      if (o?.type !== "user" || !Array.isArray(content)) continue;
      content.forEach((b: any, i: number) => {
        if (b?.type !== "tool_result" || !Array.isArray(b.content)) return;
        // Same id the listener gives the result step: `${uuid}:${block index}`.
        b.content.filter((c: any) => c?.type === "image" && c.source?.type === "base64" && typeof c.source.data === "string")
          .forEach((c: any, k: number) => {
            const media = String(c.source.media_type ?? "image/png").toLowerCase();
            if (SHOT_TYPES.has(media)) insert.run(`${o.uuid}:${i}`, k, o.sessionId ?? sessionId, media, Buffer.from(c.source.data, "base64"));
          });
      });
    }
  }

  /** A screenshot a tool returned. The step panel asks for them by result step id, so on a miss this reads what's new
   * in that step's session logs (only new bytes) and looks once more. */
  shot(stepId: string, idx: number): { media: string; data: Uint8Array } | undefined {
    const hit = this.get(stepId, idx);
    if (hit) return hit;
    const key = `${stepId}:${idx}`;
    const now = Date.now();
    if ((this.missed.get(key) ?? 0) > now) return undefined;
    // A step's screenshots are stored together: if some are here, this one doesn't exist (the step panel probes one past the last).
    const sessionId = this.has(stepId) ? undefined : this.store.getStep(stepId)?.sessionId;
    if (sessionId) {
      this.scan(sessionId);
      const found = this.get(stepId, idx);
      if (found) { this.missed.delete(key); return found; }
    }
    if (this.missed.size > 2000) for (const [k, until] of this.missed) if (until <= now) this.missed.delete(k);
    this.missed.set(key, now + SHOT_MISS_MS);
    return undefined;
  }

  /** Whether any screenshot of this result step is stored (a step's screenshots are stored together). */
  has(stepId: string): boolean {
    return !!this.dbs.stmt(`SELECT 1 FROM task_shots WHERE step_id = ? LIMIT 1`).get(stepId);
  }

  get(stepId: string, idx: number): { media: string; data: Uint8Array } | undefined {
    return this.dbs.stmt(`SELECT media, data FROM task_shots WHERE step_id = ? AND idx = ?`).get(stepId, idx) as { media: string; data: Uint8Array } | undefined;
  }
}
