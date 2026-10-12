// Builds the hosted demo (brainstorm-next): the web app with the demo's playback (lib/preview.ts: agent moves on the
// Map, the recorded setup run), opening straight into a recording. A normal build leaves that code out (VITE_DEMO).
// Run from app/web: `npm run build:demo [-- --replay <file>] [-- --out <folder>]`. The recording defaults to the
// gitignored public/replay-next.json (made by app/scripts/record-demo.mjs) and is written as replay.json in the output
// (default dist-demo/), which is ready to deploy as static files. See docs/demo.md.
import { build } from "vite";
import { copyFileSync, existsSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const replay = resolve(arg("replay") ?? join(WEB, "public", "replay-next.json"));
const out = resolve(arg("out") ?? join(WEB, "dist-demo"));
if (!existsSync(replay)) { console.error(`No recording at ${replay}: make one with app/scripts/record-demo.mjs, or pass --replay <file>.`); process.exit(1); }

process.env.VITE_DEMO = "1";
process.env.VITE_REPLAY_URL = "/replay.json";
await build({ root: WEB, configFile: join(WEB, "vite.config.ts"), logLevel: "warn", build: { outDir: out, emptyOutDir: true } });
// The public folder's recordings are copied as they are; only the demo's own one is published, as replay.json.
for (const f of ["replay.json", "replay-next.json"]) rmSync(join(out, f), { force: true });
copyFileSync(replay, join(out, "replay.json"));
console.log(`${out}: the demo, playing ${replay}`);
