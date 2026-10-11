// Reading a log a line at a time, a chunk at a time: lines are cut on the newline byte and only then decoded, so a
// character split between two chunks stays whole. Only complete lines (ending in "\n") are given; empty lines are skipped.
// The listener's own reader (tailer.ts fill) keeps its cursor and byte offsets across calls, so it stays its own.
import { closeSync, openSync, readSync } from "node:fs";

const NL = 0x0a;

export interface LineOptions {
  /** Read from this byte (default 0) up to this one (default: the end of the file). */
  from?: number;
  to?: number;
  /** Bytes per read (default 4 MB). */
  chunkBytes?: number;
  /** A longer line is skipped (default 64 MB). */
  maxLineBytes?: number;
}

/** The file's complete lines, one array per chunk read (so a caller can yield or commit between chunks). */
export function* lineChunks(fd: number, opts: LineOptions = {}): Generator<string[]> {
  const chunkBytes = opts.chunkBytes ?? 4 * 1024 * 1024, maxLine = opts.maxLineBytes ?? 64 * 1024 * 1024;
  const to = opts.to ?? Infinity;
  const buf = Buffer.allocUnsafe(chunkBytes);
  let pos = opts.from ?? 0, pending: Buffer | null = null, skipping = false; // skipping: inside a line over maxLine
  while (pos < to) {
    const n = readSync(fd, buf, 0, Math.min(chunkBytes, to - pos), pos);
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
    const out: string[] = [];
    let s = 0;
    for (let e = work.indexOf(NL); e !== -1; s = e + 1, e = work.indexOf(NL, s)) {
      if (e > s && e - s <= maxLine) out.push(work.toString("utf8", s, e));
    }
    const rest = work.subarray(s);
    if (rest.length > maxLine) skipping = true;
    else if (rest.length) pending = Buffer.from(rest); // a copy: the buffer is read into again
    yield out;
  }
}

/** Calls `fn` with each complete line of the file, in order, until it returns false. False if the file can't be read. */
export function forEachLine(file: string, fn: (line: string) => boolean | void, opts: LineOptions = {}): boolean {
  let fd: number | undefined;
  try {
    fd = openSync(file, "r");
    for (const lines of lineChunks(fd, opts)) for (const l of lines) if (fn(l) === false) return true;
    return true;
  } catch { return false; } finally { if (fd !== undefined) closeSync(fd); }
}
