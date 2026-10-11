import type { Logger } from "@nestjs/common";
import { createHash } from "node:crypto";
import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import type { Harness } from "../shared/contract";
import type { DbService } from "../core/db.service";
import type { EventsGateway } from "../core/events.gateway";
import type { LogSource, Scope, Sink } from "./source";
import { newBatch, type Batch, type StepsStore, type StepWriter } from "./step-store";

// Reading the agents' log files: from where each was read up to (its offset), a chunk at a time, split into lines,
// several logs of a thread merged by time, stored a batch of lines per transaction. What a line means is its source's
// (parse, into the listener's sink); what's done with the stored steps is the listener's (announce).

/** What the tailer needs from the listener. */
export interface TailerHost {
  /** The source a log file belongs to, if any. */
  sourceOf(file: string): LogSource | undefined;
  /** The open project (a log out of it isn't read). */
  scope(): Scope;
  /** Where a source's parse of a line in batch `b` goes. */
  sinkFor(b: Batch, harness: Harness): Sink;
  /** After a batch is committed: tell the app what was live. */
  announce(b: Batch): void;
  /** The server is stopping. */
  stopped(): boolean;
}

/** A log being read: where it's at, and its complete lines read and not stored yet. */
type Cursor = {
  file: string;
  source: LogSource;
  fd: number;
  /** Its size when opened: what this pass reads. */
  size: number;
  /** Next byte to read, and the offset after the last line stored. */
  pos: number;
  committed: number;
  /** Lines ending at or before this byte offset are history. */
  quietUntil: number;
  /** Which file this is (another at the same path is another log), and a hash of its first line. */
  ino: number;
  head?: string;
  /** Its thread's reset count when opened (see resetThread). */
  reset: number;
  /** The start of a line not complete yet; inside a line longer than maxLineBytes (dropped up to its end). */
  pending: Buffer | null;
  skipping: boolean;
  /** Lines read and not handed out yet: lines[next…]. */
  lines: Line[];
  next: number;
  reads: number;
  /** The time of its last line that had one. */
  lastTs: number;
};
/** A complete line: buf[start, end), the offset after it, and (logs merged) its time and its parse. start === end: no
 * line to store, only an offset to move past (an empty or over-long line). */
type Line = { c: Cursor; buf: Buffer; start: number; end: number; at: number; ts: number; obj?: unknown; err?: string };
type ReadEntry = { again?: number; done?: Promise<void> };

/** A hash of a log's first line (of its first 4 KB, if longer), or undefined while it isn't written: the same path
 * with another first line is another log. */
function headOf(fd: number, size: number): string | undefined {
  const buf = Buffer.alloc(Math.min(4096, size));
  const n = readSync(fd, buf, 0, buf.length, 0);
  const nl = buf.subarray(0, n).indexOf(0x0a);
  if (nl === -1 && n < 4096) return undefined;
  return createHash("sha1").update(buf.subarray(0, nl === -1 ? n : nl + 1)).digest("hex");
}

/** Read size per step of a file. */
const CHUNK_BYTES = 4 * 1024 * 1024;
/** Lines stored per transaction, about: the server answers requests between batches. */
const BATCH_BYTES = 1024 * 1024;
/** A longer line is skipped (with a warning) instead of buffered. The longest seen in real logs is 13 MB (a pasted image). */
const MAX_LINE_BYTES = 16 * 1024 * 1024;
const NL = 0x0a;
/** A chunk the database wouldn't take (busy past its timeout, disk full) is read again this soon, at most RETRY_MAX
 * times in a row; after that, on the log's next change. */
const RETRY_MS = 1_000;
const RETRY_MAX = 30;
/** While a long history read goes on, the pages are told which threads got steps every this many batches. */
const NOTICE_EVERY = 4;
export const yieldToLoop = () => new Promise<void>((r) => setImmediate(r));
const isSqliteError = (e: unknown) => String((e as { code?: unknown })?.code ?? "").startsWith("ERR_SQLITE");

export class Tailer {
  /** Where each log was read up to (the byte after its last line stored). */
  readonly offsets = new Map<string, number>();
  /** Which file each offset is in (inode, first line's hash; see headOf), to notice a log replaced or cut short. */
  private idents = new Map<string, { ino?: number | null; head?: string | null }>();
  /** Per file, how many times its thread was read again from the start (a pass that began before stops). */
  private resets = new Map<string, number>();
  /** Threads that got history stored since the pages were last told (noticeStored). */
  private storedQuietly = new Set<string>();
  private retryTimers = new Map<string, NodeJS.Timeout>();
  private retryCount = new Map<string, number>();
  /** Files being read now, and the next pass to make once the current one ends (the file changed meanwhile). */
  readonly reading = new Map<string, ReadEntry>();
  /** Each file's size when the backfill listed it: lines up to there are history, anything after is live. */
  readonly historyEnd = new Map<string, number>();
  /** Bytes read per chunk, stored per transaction, and the longest line kept. Fields so tests can make them small. */
  chunkBytes = CHUNK_BYTES;
  batchBytes = BATCH_BYTES;
  maxLineBytes = MAX_LINE_BYTES;

  constructor(
    private dbs: DbService,
    private store: StepsStore,
    private writer: StepWriter,
    private gateway: EventsGateway,
    private host: TailerHost,
    private log: Logger,
  ) {
    for (const row of dbs.db.prepare(`SELECT file, offset, ino, head FROM listener_offsets`).all() as { file: string; offset: number; ino: number | null; head: string | null }[]) {
      this.offsets.set(row.file, row.offset);
      this.idents.set(row.file, { ino: row.ino, head: row.head });
    }
  }

  /** Stops the retries waiting. */
  close() {
    for (const t of this.retryTimers.values()) clearTimeout(t);
  }

  /** Read what `file` gained since its offset. One pass at a time per file: a change during a pass queues another.
   * Lines ending at or before byte `quietUntil` are history (not broadcast). Never rejects. */
  runFile(file: string, quietUntil: number): Promise<void> {
    const cur = this.reading.get(file);
    if (cur) {
      cur.again = Math.min(cur.again ?? Infinity, quietUntil);
      return cur.done!;
    }
    const entry: ReadEntry = { again: quietUntil };
    this.reading.set(file, entry);
    entry.done = (async () => {
      try {
        while (entry.again !== undefined) {
          const q = entry.again;
          entry.again = undefined;
          await this.readLogs([{ file, quietUntil: q }]);
        }
      } catch (e) {
        this.log.warn(`handleFile(${file}) failed: ${(e as Error).message}`);
      } finally {
        this.reading.delete(file);
        this.historyRead(file);
      }
    })();
    return entry.done;
  }

  /** Read one thread's logs as one pass, their lines merged by time (history: lines up to each file's historyEnd are
   * quiet). Waits for a pass on any of them to end first; a change during the pass is read after it. Never rejects. */
  async runFiles(files: string[]): Promise<void> {
    if (files.length === 1) return this.runFile(files[0], this.historyEnd.get(files[0]) ?? 0);
    while (files.some((f) => this.reading.has(f))) await Promise.all(files.map((f) => this.reading.get(f)?.done));
    const entries = files.map((f) => { const e: ReadEntry = {}; this.reading.set(f, e); return e; });
    const done = (async () => {
      try {
        await this.readLogs(files.map((f) => ({ file: f, quietUntil: this.historyEnd.get(f) ?? 0 })));
      } catch (e) {
        this.log.warn(`reading ${files[0]} and its subagents' logs failed: ${(e as Error).message}`);
      } finally {
        for (const f of files) this.reading.delete(f);
      }
      await Promise.all(files.map((f, k) => (entries[k].again !== undefined ? this.runFile(f, entries[k].again) : undefined)));
      for (const f of files) this.historyRead(f);
    })();
    for (const e of entries) e.done = done;
    return done;
  }

  /** A file the backfill listed is history no more once it's read up to where it was listed. */
  private historyRead(file: string) {
    const end = this.historyEnd.get(file);
    if (end !== undefined && (this.offsets.get(file) ?? 0) >= end) this.historyEnd.delete(file);
  }

  /** Read what `logs` gained since their offsets, chunkBytes at a time, split on newline bytes before decoding (a
   * multibyte character never spans one), and store the complete lines about batchBytes per transaction, each log's
   * offset after its last line stored with them, yielding in between. A partial last line waits for the next change.
   * Several logs (a thread's own and its subagents') are merged by their lines' times. When it's done, and every few
   * batches, the threads that got history are told to the pages (noticeStored). */
  private async readLogs(logs: { file: string; quietUntil: number }[]): Promise<void> {
    const cursors: Cursor[] = [];
    try {
      for (const { file, quietUntil } of logs) {
        const c = this.openLog(file, quietUntil);
        if (c) cursors.push(c);
      }
      const merge = cursors.length > 1;
      // A thread read again from the start meanwhile (resetThread): this pass stops, and each log is read again after it.
      const stale = () => {
        if (!cursors.some((c) => (this.resets.get(c.file) ?? 0) !== c.reset)) return false;
        for (const c of cursors) void this.runFile(c.file, c.quietUntil);
        return true;
      };
      let batch: Line[] = [];
      let bytes = 0;
      let commits = 0;
      for (;;) {
        let next: Cursor | undefined;
        for (const c of cursors) {
          while (c.next === c.lines.length && c.pos < c.size) await this.fill(c, merge);
          if (c.next < c.lines.length && (!next || c.lines[c.next].ts < next.lines[next.next].ts)) next = c;
        }
        if (!next) break;
        const l = next.lines[next.next++];
        batch.push(l);
        bytes += l.end - l.start + 1;
        if (bytes < this.batchBytes) continue;
        if (stale() || !this.commitLines(batch)) return;
        batch = [];
        bytes = 0;
        if (++commits % NOTICE_EVERY === 0) this.noticeStored();
        await yieldToLoop();
      }
      if (batch.length && !stale()) this.commitLines(batch);
    } finally {
      for (const c of cursors) closeSync(c.fd);
      this.noticeStored();
    }
  }

  /** A log to read from its offset, or undefined if it's not the project's, gone, or has nothing new. A log replaced
   * or cut short since (another file at its path, another first line, or shorter than its offset) has its thread
   * read again from the start (resetThread). */
  private openLog(file: string, quietUntil: number): Cursor | undefined {
    const source = this.host.sourceOf(file);
    if (!source || !source.inScope(file, this.host.scope())) return undefined;
    let fd: number;
    let st: { size: number; ino: number };
    try { fd = openSync(file, "r"); st = fstatSync(fd); } catch { return undefined; } // gone
    let prev = this.offsets.get(file) ?? 0;
    const head = headOf(fd, st.size);
    const known = this.idents.get(file);
    if (prev > 0 && (st.size < prev || (known?.ino != null && known.ino !== st.ino) || (known?.head != null && head !== undefined && head !== known.head))) {
      try { this.resetThread(file, source); } catch (e) { closeSync(fd); throw e; }
      prev = 0;
      quietUntil = Math.max(quietUntil, st.size); // what it has now is history; the pages catch up (noticeStored)
    }
    if (st.size <= prev) { closeSync(fd); return undefined; }
    return {
      file, source, fd, size: st.size, pos: prev, committed: prev, quietUntil, ino: st.ino, head, reset: this.resets.get(file) ?? 0,
      pending: null, skipping: false, lines: [], next: 0, reads: 0, lastTs: -Infinity,
    };
  }

  /** Read a log's next chunk into its cursor's lines (with each line's time when logs are merged). */
  private async fill(c: Cursor, merge: boolean) {
    if (c.reads++) await yieldToLoop();
    if (c.next === c.lines.length) { c.lines = []; c.next = 0; }
    const want = Math.min(this.chunkBytes, c.size - c.pos);
    const chunk = Buffer.allocUnsafe(want);
    const n = readSync(c.fd, chunk, 0, want, c.pos);
    if (n <= 0) { c.size = c.pos; return; }
    const chunkStart = c.pos;
    c.pos += n;
    let data = chunk.subarray(0, n);
    let dataStart = chunkStart;
    if (c.skipping) {
      const nl = data.indexOf(NL);
      if (nl === -1) return;
      c.skipping = false;
      data = data.subarray(nl + 1);
      dataStart = chunkStart + nl + 1;
      c.lines.push({ c, buf: data, start: 0, end: 0, at: dataStart, ts: c.lastTs }); // past the long line
    }
    const work: Buffer = c.pending ? Buffer.concat([c.pending, data]) : data;
    const workStart = dataStart - (c.pending ? c.pending.length : 0);
    c.pending = null;
    let s = 0;
    for (let e = work.indexOf(NL); e !== -1; s = e + 1, e = work.indexOf(NL, s)) {
      const l: Line = { c, buf: work, start: s, end: e, at: workStart + e + 1, ts: c.lastTs };
      if (e - s > this.maxLineBytes) {
        this.log.warn(`skipping a line over ${Math.round(this.maxLineBytes / 1048576)} MB in ${c.file} (byte ${workStart + s})`);
        l.end = l.start; // only its offset is kept
      } else if (merge && e > s) {
        try { l.obj = JSON.parse(work.toString("utf8", s, e)); } catch (err) { l.err = (err as Error).message; }
        const t = Date.parse((l.obj as { timestamp?: unknown } | undefined)?.timestamp as string);
        if (!Number.isNaN(t)) l.ts = c.lastTs = t; // a line without a time stays where it is in its log
      }
      c.lines.push(l);
    }
    const rest = work.subarray(s);
    if (rest.length > this.maxLineBytes) {
      this.log.warn(`skipping a line over ${Math.round(this.maxLineBytes / 1048576)} MB in ${c.file} (byte ${workStart + s})`);
      c.skipping = true;
    } else if (rest.length) c.pending = Buffer.from(rest); // a copy: don't keep the whole chunk alive
  }

  /** Store `lines` (of one or more logs) and each log's offset after its last one in one transaction, then announce
   * what was live. On a database error nothing of it is kept (seqs put back, offsets unchanged) and each log is read
   * again in a second (retrySoon); returns false then. */
  private commitLines(lines: Line[]): boolean {
    const db = this.dbs.db;
    const batch: Batch = newBatch(true);
    const sinks = new Map<LogSource, Sink>();
    const ends = new Map<Cursor, number>();
    try {
      // IMMEDIATE: the write lock from the start. A transaction that reads first (is this step stored?) and writes after
      // can't wait for a lock another program holds (busy_timeout): it fails at once.
      db.exec("BEGIN IMMEDIATE");
      for (const l of lines) {
        const c = l.c;
        ends.set(c, l.at);
        if (l.end <= l.start) continue; // an empty or over-long line
        batch.quiet = l.at <= c.quietUntil;
        let obj = l.obj;
        if (obj === undefined && l.err === undefined) {
          try { obj = JSON.parse(l.buf.toString("utf8", l.start, l.end)); } catch (err) { l.err = (err as Error).message; }
        }
        if (l.err !== undefined) this.log.warn(`bad jsonl line in ${c.file}: ${l.err}`);
        if (!obj) continue;
        let sink = sinks.get(c.source);
        if (!sink) sinks.set(c.source, (sink = this.host.sinkFor(batch, c.source.harness)));
        try { c.source.parse(c.file, obj, sink); } catch (err) {
          if (isSqliteError(err)) throw err; // the database, not the line: roll the batch back
          this.log.warn(`bad jsonl line in ${c.file}: ${(err as Error).message}`);
        }
      }
      this.writer.flushSessions(batch);
      for (const [c, at] of ends) this.store.st.saveOffset.run(c.file, at, c.ino, c.head ?? null);
      db.exec("COMMIT");
    } catch (e) {
      try { db.exec("ROLLBACK"); } catch { /* already rolled back */ }
      this.writer.rollback(batch);
      for (const c of new Set(lines.map((l) => l.c))) {
        this.log.warn(`storing ${c.file} from byte ${c.committed} failed, tried again in a moment: ${(e as Error).message}`);
        this.retrySoon(c.file, c.quietUntil);
      }
      return false;
    }
    for (const [c, at] of ends) {
      c.committed = at;
      this.retryCount.delete(c.file);
      this.offsets.set(c.file, at);
      this.idents.set(c.file, { ino: c.ino, head: c.head });
    }
    for (const sid of batch.quietSessions) this.storedQuietly.add(sid);
    this.host.announce(batch);
    return true;
  }

  /** A log was replaced or cut short: its thread's steps are dropped and all its logs read again from the start. The
   * steps that come back keep their seq (`kept`): a re-read never renumbers a step a page already has. */
  private resetThread(file: string, source: LogSource) {
    const thread = source.threadOf?.(file);
    const files = thread === undefined ? [file] : [...this.offsets.keys()].filter((f) => f === file || (source.owns(f) && source.threadOf!(f) === thread));
    this.log.warn(`${file} was replaced or cut short: ${thread === undefined ? "it is" : `its thread's logs are`} read again from the start`);
    const db = this.dbs.db;
    db.exec("BEGIN IMMEDIATE");
    try {
      if (thread !== undefined) {
        this.writer.keepSeqs(thread);
        db.prepare(`DELETE FROM steps WHERE session_id = ?`).run(thread);
      }
      for (const f of files) this.store.st.saveOffset.run(f, 0, null, null);
      db.exec("COMMIT");
    } catch (e) { try { db.exec("ROLLBACK"); } catch { /* already rolled back */ } throw e; }
    for (const f of files) {
      this.offsets.set(f, 0);
      this.idents.delete(f);
      this.resets.set(f, (this.resets.get(f) ?? 0) + 1);
      if (f !== file) void this.runFile(f, Infinity);
    }
  }

  /** Tell the pages which threads got history stored since the last notice, and their last seq: a page that loaded
   * one of them before has a part of it, and fetches the rest. */
  private noticeStored() {
    if (!this.storedQuietly.size) return;
    for (const sessionId of this.storedQuietly) {
      const next = this.writer.nextSeq.get(sessionId);
      if (next !== undefined) this.gateway.broadcast({ type: "steps-stored", sessionId, lastSeq: next - 1 });
    }
    this.storedQuietly.clear();
  }

  /** Read `file` again in RETRY_MS, instead of waiting for it to grow: a finished thread's last steps would otherwise
   * stay missing until its next line, maybe hours later. */
  private retrySoon(file: string, quietUntil: number) {
    if (this.host.stopped() || this.retryTimers.has(file)) return;
    const n = (this.retryCount.get(file) ?? 0) + 1;
    if (n > RETRY_MAX) { this.retryCount.delete(file); return; }
    this.retryCount.set(file, n);
    const t = setTimeout(() => { this.retryTimers.delete(file); void this.runFile(file, quietUntil); }, RETRY_MS);
    t.unref?.();
    this.retryTimers.set(file, t);
  }

  /** Sets where reading a log resumes (tests use it to replay a restart mid-file). */
  saveOffset(file: string, offset: number) {
    this.store.st.saveOffset.run(file, offset, null, null);
    this.offsets.set(file, offset);
    this.idents.delete(file);
  }

  /** Forget the offsets of `files` (their source reads them again from the start). */
  forget(files: string[]) {
    for (const f of files) this.offsets.delete(f);
  }
}
