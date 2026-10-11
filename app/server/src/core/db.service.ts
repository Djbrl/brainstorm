import { Injectable, Logger, OnApplicationShutdown } from "@nestjs/common";
import { DatabaseSync } from "node:sqlite";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { dataDir } from "./local";

/**
 * One SQLite file (Node's built-in node:sqlite, no native build).
 * Each module creates its own tables in onModuleInit with `CREATE TABLE IF NOT EXISTS`.
 * Store complex fields as JSON text.
 */
@Injectable()
export class DbService implements OnApplicationShutdown {
  readonly db: DatabaseSync;
  private log = new Logger("Database");
  constructor() {
    const dir = dataDir();
    // Every prompt, diff and tool output is in here: readable by this account only (the folder too, if it existed).
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    try { chmodSync(dir, 0o700); } catch { /* not ours to change */ }
    // Named brainstorm.db before the rename (0.4 and older): take it over, with its write-ahead log.
    const file = resolve(dir, "rundown.db"), old = resolve(dir, "brainstorm.db");
    if (!existsSync(file) && existsSync(old)) for (const ext of ["", "-wal", "-shm"]) if (existsSync(old + ext)) renameSync(old + ext, file + ext);
    this.db = this.open(file);
    for (const f of [file, file + "-wal", file + "-shm"]) try { chmodSync(f, 0o600); } catch { /* not created yet */ }
    // busy_timeout: when another program (sqlite3, a backup, a second server on this folder) holds the write lock, a
    // write waits up to 5 s for it instead of failing at once.
    // temp_store: sorts and temp indexes in memory. cache_size: 32 MB of pages (default 2 MB) so big threads' reads
    // and the import's index updates stay in memory. mmap_size: read the file through the OS page cache.
    this.db.exec(`PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA temp_store = MEMORY;
      PRAGMA cache_size = -32768; PRAGMA mmap_size = 268435456;`);
    // WAL mode creates the -wal and -shm files now: with the main file's mode, set again in case they predate it.
    for (const f of [file + "-wal", file + "-shm"]) try { chmodSync(f, 0o600); } catch { /* not there */ }
  }

  /**
   * Opens the database. One that isn't a database any more (corrupt, overwritten) is moved aside, never deleted, and a
   * fresh one starts: the history is read again from the agents' logs. A read-only one gets one clear line in the log.
   */
  private open(file: string): DatabaseSync {
    let db: DatabaseSync | undefined;
    try {
      db = new DatabaseSync(file);
      db.prepare("SELECT count(*) FROM sqlite_master").get(); // reads the header: a broken file fails here
      return db;
    } catch (e) {
      try { db?.close(); } catch { /* not open */ }
      const msg = (e as Error).message ?? String(e);
      if (/not a database|malformed|corrupt/i.test(msg)) {
        const aside = `${file}.broken-${new Date().toISOString().replace(/[:.]/g, "-")}`;
        for (const ext of ["", "-wal", "-shm"]) if (existsSync(file + ext)) {
          renameSync(file + ext, aside + ext);
          try { chmodSync(aside + ext, 0o600); } catch { /* not ours to change */ }
        }
        this.log.error(`${file} is damaged (${msg}): moved it to ${aside} and started a fresh one; your threads are read again from the agents' logs`);
        this.notice(`Rundown's database was damaged, so it started a fresh one and read your threads again. The old file is ${aside}.`);
        return new DatabaseSync(file);
      }
      if (/readonly|read-only|unable to open/i.test(msg)) {
        this.log.error(`can't write ${file} (${msg}): check that the folder and the file are yours and writable`);
      }
      throw e;
    }
  }

  /** A line for the next session start (the launcher shows notices.json's `failure` once a day). */
  private notice(text: string) {
    const f = resolve(dataDir(), "notices.json");
    try {
      let n: Record<string, unknown> = {};
      try { n = JSON.parse(readFileSync(f, "utf8")); } catch { /* none yet */ }
      writeFileSync(f, JSON.stringify({ ...n, failure: text, failureToldAt: 0 }), { mode: 0o600 });
      chmodSync(f, 0o600); // the mode above only applies to a new file
    } catch { /* the log has it */ }
  }

  onApplicationShutdown() {
    try { this.db.close(); } catch { /* already closed */ }
  }
}
