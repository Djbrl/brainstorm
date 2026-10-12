// node:sqlite without the line Node prints the first time it loads ("SQLite is an experimental feature..."): on every
// server start, in every test process. Only that warning is dropped, and only while the module loads.
import type * as Sqlite from "node:sqlite";

function load(): typeof Sqlite {
  const emit = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    if (String(typeof warning === "string" ? warning : warning?.message).startsWith("SQLite is an experimental feature")) return;
    (emit as (...a: unknown[]) => void).call(process, warning, ...rest);
  }) as typeof process.emitWarning;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  try { return require("node:sqlite") as typeof Sqlite; } finally { process.emitWarning = emit; }
}

export const { DatabaseSync } = load();
export type DatabaseSync = Sqlite.DatabaseSync;
export type StatementSync = Sqlite.StatementSync;
