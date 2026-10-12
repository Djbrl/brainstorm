// The server in dev (npm run dev in app/server): TypeScript recompiles on save, and the server restarts on each build.
// Both run as children of this script, which stops them when it stops (Ctrl-C, a kill, either child exiting), so no
// `tsc -w` is left running in the background. Run from app/server.
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(`${process.cwd()}/`);
const tsc = join(dirname(require.resolve("typescript/package.json")), require("typescript/package.json").bin.tsc);

// One build first, so the server starts on fresh code.
const first = spawnSync(process.execPath, [tsc, "-p", "."], { stdio: "inherit" });
if (first.status !== 0) process.exit(first.status ?? 1);

const children = [
  spawn(process.execPath, [tsc, "-p", ".", "-w", "--preserveWatchOutput"], { stdio: "inherit" }),
  spawn(process.execPath, ["--watch", "--watch-preserve-output", "dist/main.js"], { stdio: "inherit" }),
];

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (c.exitCode === null) c.kill("SIGTERM");
  // The server closes in up to 3 s (main.ts); then whatever is left goes.
  setTimeout(() => { for (const c of children) if (c.exitCode === null) c.kill("SIGKILL"); process.exit(code); }, 4000).unref();
  Promise.all(children.map((c) => (c.exitCode !== null ? null : new Promise((r) => c.once("exit", r))))).then(() => process.exit(code));
}
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => stop(0));
for (const c of children) c.on("exit", (code) => stop(code ?? 1));
