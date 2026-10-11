// Builds the Claude Code plugin in ../../plugin/build: the server bundled into one file (no npm install for users)
// and the web app it serves. Run from app/: `node scripts/build-plugin.mjs`. Commit plugin/build with each release.
// `--out DIR` builds somewhere else (a check, a test). Everything is built in a folder beside the target first, and
// swapped in only when every step succeeded: a failed build never leaves a half plugin/build behind.
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { noticesMarkdown, noticesComment, packagesOf } from "./third-party-notices.mjs";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outArg = process.argv.indexOf("--out");
const OUT = outArg > 0 && process.argv[outArg + 1] ? resolve(process.argv[outArg + 1]) : resolve(APP, "../plugin/build");
const TMP = `${OUT}.building-${process.pid}`;
const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: "inherit" });

rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
try {
  // 1. Server: tsc keeps Nest's decorator metadata (esbuild can't emit it), then esbuild bundles the compiled JS.
  run("npx tsc -p .", join(APP, "server"));
  const esbuild = createRequire(join(APP, "server/package.json"))("esbuild");
  const server = await esbuild.build({
    entryPoints: [join(APP, "server/dist/main.js")],
    outfile: join(TMP, "server.js"),
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    keepNames: true,
    minify: true,
    legalComments: "none",
    metafile: true, // which files went in: the licences below are theirs
    // Optional packages Nest and ws load only if installed; left out, they're skipped at runtime.
    external: [
      "@nestjs/microservices", "@nestjs/microservices/*", "@nestjs/platform-socket.io", "@fastify/*",
      "class-validator", "class-transformer", "class-transformer/*", "cache-manager", "bufferutil", "utf-8-validate",
    ],
    logLevel: "warning",
  });
  const serverInputs = Object.keys(server.metafile.inputs).map((f) => resolve(APP, "server", f));

  // 2. Web: the live app (no replay URL), served by the server. A type error stops the build (vite alone doesn't check).
  run("npx tsc -b", join(APP, "web"));
  const vite = createRequire(join(APP, "web/package.json"))("vite");
  const webInputs = new Set();
  await vite.build({
    root: join(APP, "web"), configFile: join(APP, "web/vite.config.ts"), logLevel: "warn",
    build: { outDir: join(TMP, "web"), emptyOutDir: true },
    plugins: [{ name: "inputs", generateBundle(_o, bundle) { for (const c of Object.values(bundle)) for (const id of c.moduleIds ?? []) webInputs.add(id.replace(/^\0/, "").split("?")[0]); } }],
  });
  // public/ holds the hosted demos' recordings: not part of the plugin.
  for (const f of readdirSync(join(TMP, "web"))) if (/^replay.*\.json$/.test(f)) rmSync(join(TMP, "web", f));

  // 3. The licences of the open-source packages bundled above (most ask that their notice go with every copy): for the
  // plugin, and inside the one-file app a shared replay is poured into (GET /api/share reads build/share.html), which
  // travels on its own.
  const serverPkgs = packagesOf(serverInputs), webPkgs = packagesOf([...webInputs]);
  const all = new Map([...serverPkgs, ...webPkgs].map((p) => [`${p.name}@${p.version}`, p]));
  writeFileSync(join(TMP, "THIRD_PARTY_NOTICES.md"), noticesMarkdown([...all.values()]));
  run("node scripts/build-share.mjs", join(APP, "web"));
  const share = readFileSync(join(APP, "web/dist-share/share.html"), "utf8");
  if (!/^<!doctype html>/i.test(share)) throw new Error("share.html doesn't start with a doctype");
  writeFileSync(join(TMP, "share.html"), share.replace(/^<!doctype html>/i, (d) => `${d}\n${noticesComment(webPkgs)}`));

  // 4. All built: swap it in.
  const old = `${OUT}.old-${process.pid}`;
  if (existsSync(OUT)) renameSync(OUT, old);
  renameSync(TMP, OUT);
  rmSync(old, { recursive: true, force: true });
} catch (e) {
  rmSync(TMP, { recursive: true, force: true });
  console.error(`Build failed, ${OUT} left as it was: ${e.message}`);
  process.exit(1);
}
// The plugin's own licence goes with it.
copyFileSync(resolve(APP, "../LICENSE.md"), join(dirname(OUT), "LICENSE.md"));

const kb = (f) => Math.round(statSync(f).size / 1024);
console.log(`${OUT} ready: server.js ${kb(join(OUT, "server.js"))} kB + web/ + share.html ${kb(join(OUT, "share.html"))} kB`);
