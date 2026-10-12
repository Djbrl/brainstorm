// Which code this server runs: the commit it was built from, printed at start so a log says what produced it.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { config } from "./config";
import { gitEnv } from "./git-safety";

let known: string | undefined | null = null;

/** The short commit hash ("-dirty" when the tree had changes), or undefined when it can't be told. The plugin's build
 *  writes it to build.json beside server.js (app/scripts/build-plugin.mjs); in dev, git says. */
export function buildCommit(): string | undefined {
  if (known !== null) return known;
  known = undefined;
  try { known = (JSON.parse(readFileSync(join(__dirname, "build.json"), "utf8")) as { commit?: string }).commit || undefined; } catch { /* not the plugin */ }
  if (known || config.version) return known;
  try {
    // Dev: the clone this file is in (dist/core → the repository).
    known = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: resolve(__dirname, "../../../.."), encoding: "utf8", timeout: 2000, env: gitEnv(), stdio: ["ignore", "pipe", "ignore"] }).trim() || undefined;
  } catch { /* no git */ }
  return known;
}
