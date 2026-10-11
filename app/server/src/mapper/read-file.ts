// Reading a listed file for the map, with bounded memory. A listing can name things that aren't ordinary files: a
// committed symlink to /dev/zero or to a FIFO, a link out of the project, a multi-gigabyte database dump. Each is
// checked before anything is read; a file is read into memory only up to MAX_PARSE_BYTES, and counted a chunk at a time
// up to MAX_COUNT_BYTES. Anything else is left off the map.
import { constants, type Stats } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import { sep } from "node:path";

/** Files up to this size are read for their imports (and kept as a snapshot). */
export const MAX_PARSE_BYTES = 1024 * 1024;
/** Bigger ones, up to this, are only counted (lines), a chunk at a time. Past it a file isn't mapped. */
export const MAX_COUNT_BYTES = 16 * 1024 * 1024;
const CHUNK = 256 * 1024;
/** Non-blocking: a FIFO swapped in after the check opens at once instead of holding a thread until a writer comes. */
const FLAGS = constants.O_RDONLY | (constants.O_NONBLOCK ?? 0);

export type FileRead = { lines: number; content: string; mtimeMs: number };

export function countLines(buf: Buffer): number {
  if (!buf.length) return 0;
  let n = 1;
  for (let i = buf.indexOf(10); i !== -1; i = buf.indexOf(10, i + 1)) n++;
  return n;
}

/** Worth opening: a regular file of a size we read. */
const mappable = (st: Stats) => st.isFile() && st.size <= MAX_COUNT_BYTES;
/** Its real path (every link on the way followed: the file's, or a linked folder above it) is inside the project's. */
const inside = (real: string, realRoot: string) => real.startsWith(realRoot.replace(/[\\/]+$/, "") + sep);

/** A file's lines and (up to MAX_PARSE_BYTES) its text; null when it's not an ordinary file in the project, is too big, or is gone. */
export async function readMapped(abs: string, root: string): Promise<FileRead | null> {
  try {
    const [real, realRoot] = await Promise.all([realpath(abs), realpath(root)]);
    if (!inside(real, realRoot)) return null;
    let st = await stat(real);
    if (!mappable(st)) return null;
    const fh = await open(real, FLAGS);
    try {
      st = await fh.stat();
      if (!mappable(st)) return null;
      const small = st.size <= MAX_PARSE_BYTES;
      const buf = Buffer.allocUnsafe(small ? st.size : CHUNK);
      let pos = 0, lines = 0;
      while (pos < st.size) {
        const want = Math.min(small ? buf.length - pos : buf.length, st.size - pos);
        const { bytesRead } = await fh.read(buf, small ? pos : 0, want, pos);
        if (!bytesRead) break;
        if (!small) lines += newlines(buf, bytesRead);
        pos += bytesRead;
      }
      if (small) { const b = buf.subarray(0, pos); return { lines: countLines(b), content: b.toString("utf8"), mtimeMs: st.mtimeMs }; }
      return { lines: pos ? lines + 1 : 0, content: "", mtimeMs: st.mtimeMs };
    } finally { await fh.close(); }
  } catch { return null; }
}

function newlines(buf: Buffer, n: number): number {
  let count = 0;
  for (let i = buf.indexOf(10); i !== -1 && i < n; i = buf.indexOf(10, i + 1)) count++;
  return count;
}
