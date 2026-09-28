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
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
  }
}
