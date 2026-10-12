// Which code this server runs: the commit it was built from, printed at start so a log says what produced it.
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { gitEnv } from "./git-safety";

/** Set by the plugin build (esbuild `define`, app/scripts/build-plugin.mjs): the commit, "-dirty" when the tree had
 *  changes. Not defined in dev, where `typeof` keeps it from throwing. */
declare const __RUNDOWN_COMMIT__: string | undefined;

let dev: string | undefined | null = null;

/** The short commit hash, or undefined when it can't be told (no git, not a clone). */
export function buildCommit(): string | undefined {
  if (typeof __RUNDOWN_COMMIT__ === "string") return __RUNDOWN_COMMIT__ || undefined;
  if (dev !== null) return dev;
  try {
    // Dev: the clone this file is in (dist/core → the repository).
    dev = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: resolve(__dirname, "../../../.."), encoding: "utf8", timeout: 2000, env: gitEnv(), stdio: ["ignore", "pipe", "ignore"] }).trim() || undefined;
  } catch { dev = undefined; }
  return dev;
}
