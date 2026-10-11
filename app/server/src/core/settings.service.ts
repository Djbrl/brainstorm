import { Injectable } from "@nestjs/common";
import type { DatabaseSync } from "node:sqlite";
import { DbService } from "./db.service";

// The `settings` table: small values by key (the open project, usage counts, the tour, one-off jobs done).

export const getSetting = (db: DatabaseSync, key: string): string | null =>
  (db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as { value: string | null } | undefined)?.value ?? null;

export const setSetting = (db: DatabaseSync, key: string, value: string) =>
  void db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);

@Injectable()
export class SettingsService {
  constructor(private dbs: DbService) {}
  get(key: string): string | null { return getSetting(this.dbs.db, key); }
  set(key: string, value: string) { setSetting(this.dbs.db, key, value); }
  delete(key: string) { this.dbs.db.prepare(`DELETE FROM settings WHERE key = ?`).run(key); }
}
