import { Injectable } from "@nestjs/common";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
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
    mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(resolve(dir, "brainstorm.db"));
    // temp_store: sorts and temp indexes in memory. cache_size: 32 MB of pages (default 2 MB) so big threads' reads
    // and the import's index updates stay in memory. mmap_size: read the file through the OS page cache.
    this.db.exec(`PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA temp_store = MEMORY;
      PRAGMA cache_size = -32768; PRAGMA mmap_size = 268435456;`);
  }
}
