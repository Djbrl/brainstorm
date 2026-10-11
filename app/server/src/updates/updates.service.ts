import { Injectable } from "@nestjs/common";
import { chmodSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../core/local";

// Whether the launcher (plugin/scripts/launch.mjs) checks GitHub once a day for a new version. Its own
// setting, apart from the usage stats: on by default. Kept in settings.json in the data folder, because the launcher
// reads it before any server runs. RUNDOWN_UPDATE_CHECK=0 turns it off whatever the file says.

export type UpdatesStatus = { enabled: boolean; locked: string | null };

export function settingsFile(dir = dataDir()) { return join(dir, "settings.json"); }

export function readSettings(file = settingsFile()): Record<string, unknown> {
  try { const s = JSON.parse(readFileSync(file, "utf8")); return s && typeof s === "object" && !Array.isArray(s) ? s : {}; } catch { return {}; }
}

/** Writes settings.json whole (a temp file renamed over it), readable by this account only. */
export function writeSettings(s: Record<string, unknown>, file = settingsFile()) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(s, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, file);
  try { chmodSync(file, 0o600); } catch { /* not ours to change */ }
}

@Injectable()
export class UpdatesService {
  file = settingsFile();

  status(): UpdatesStatus {
    if (process.env.RUNDOWN_UPDATE_CHECK === "0") return { enabled: false, locked: "RUNDOWN_UPDATE_CHECK=0 is set" };
    return { enabled: readSettings(this.file).updateCheck !== false, locked: null };
  }

  setEnabled(enabled: boolean): UpdatesStatus {
    writeSettings({ ...readSettings(this.file), updateCheck: enabled }, this.file);
    return this.status();
  }
}
