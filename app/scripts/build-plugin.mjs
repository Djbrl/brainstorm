// Builds the Claude Code plugin in ../../plugin/build: the server bundled into one file (no npm install for users)
// and the web app it serves. Run from app/: `node scripts/build-plugin.mjs`. Commit plugin/build with each release.
import { execSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(APP, "../plugin/build");
const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: "inherit" });

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// 1. Server: tsc keeps Nest's decorator metadata (esbuild can't emit it), then esbuild bundles the compiled JS.
run("npx tsc -p .", join(APP, "server"));
const esbuild = createRequire(join(APP, "server/package.json"))("esbuild");
await esbuild.build({
  entryPoints: [join(APP, "server/dist/main.js")],
  outfile: join(OUT, "server.js"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  keepNames: true,
  minify: true,
  legalComments: "none",
  // Optional packages Nest and ws load only if installed; left out, they're skipped at runtime.
  external: [
    "@nestjs/microservices", "@nestjs/microservices/*", "@nestjs/platform-socket.io", "@fastify/*",
    "class-validator", "class-transformer", "class-transformer/*", "cache-manager", "bufferutil", "utf-8-validate",
  ],
  logLevel: "warning",
});

// 2. Web: the live app (no replay URL), served by the server.
run(`npx vite build --outDir ${JSON.stringify(join(OUT, "web"))} --emptyOutDir`, join(APP, "web"));
// public/ holds the hosted demos' recordings: not part of the plugin.
for (const f of readdirSync(join(OUT, "web"))) if (/^replay.*\.json$/.test(f)) rmSync(join(OUT, "web", f));

const kb = (f) => Math.round(statSync(f).size / 1024);
console.log(`plugin/build ready: server.js ${kb(join(OUT, "server.js"))} kB + web/`);
