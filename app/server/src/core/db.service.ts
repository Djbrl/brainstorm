import { Injectable } from "@nestjs/common";
import { DatabaseSync } from "node:sqlite";
import { chmodSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import { dataDir } from "./local";

/**
 * One SQLite file (Node's built-in node:sqlite, no native build).
 * Each module creates its own tables in onModuleInit with `CREATE TABLE IF NOT EXISTS`.
 * Store complex fields as JSON text.
 */
@Injectable()
export class DbService {
  readonly db: DatabaseSync;
  constructor() {
    const dir = dataDir();
    // Every prompt, diff and tool output is in here: readable by this account only (the folder too, if it existed).
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    try { chmodSync(dir, 0o700); } catch { /* not ours to change */ }
    // Named brainstorm.db before the rename (0.4 and older): take it over, with its write-ahead log.
    const file = resolve(dir, "rundown.db"), old = resolve(dir, "brainstorm.db");
    if (!existsSync(file) && existsSync(old)) for (const ext of ["", "-wal", "-shm"]) if (existsSync(old + ext)) renameSync(old + ext, file + ext);
    this.db = new DatabaseSync(file);
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
}
