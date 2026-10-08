// Builds dist-share/share.html: the whole web app in one file (scripts and styles inline, lazy parts included), used
// for shared replays. The server puts a recording where the placeholder is (GET /api/share), so the file opens in any
// browser with no server. Run from app/web: `npm run build:share` (build-plugin.mjs runs it too).
import { build } from "vite";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TMP = join(WEB, "dist-share", "tmp");
const OUT = join(WEB, "dist-share", "share.html");
export const PLACEHOLDER = "<!--rundown:replay-->";

await build({
  root: WEB,
  configFile: join(WEB, "vite.config.ts"),
  logLevel: "warn",
  build: {
    outDir: TMP, emptyOutDir: true, cssCodeSplit: false, assetsInlineLimit: 100_000_000, chunkSizeWarningLimit: 5_000,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});

let html = readFileSync(join(TMP, "index.html"), "utf8");
const asset = (href) => readFileSync(join(TMP, href.replace(/^\//, "")), "utf8");
// A script's own text can't contain "</script" inside an inline tag.
html = html.replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/g, (_, src) => `<script type="module">${asset(src).replace(/<\/script/gi, "<\\/script")}</script>`);
html = html.replace(/<link rel="stylesheet" crossorigin href="([^"]+)">/g, (_, href) => `<style>${asset(href).replace(/<\/style/gi, "<\\/style")}</style>`);
if (/src="\/assets|href="\/assets/.test(html)) throw new Error("share.html still points at /assets: inline it");
html = html.replace(/\s*<link rel="(?:icon|apple-touch-icon)"[^>]*>/g, ""); // files a shared page doesn't have
html = html.replace("</head>", `    ${PLACEHOLDER}\n  </head>`);

// A shared file opens on someone else's computer: only its own script runs (by its hash), and it can't load or send
// anything over the network. If text from a log ever got into the page as code, it couldn't run or phone home.
const hashes = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map((m) => `'sha256-${createHash("sha256").update(m[1], "utf8").digest("base64")}'`);
if (hashes.length !== 1) throw new Error(`share.html should have one inline script, found ${hashes.length}`);
const csp = ["default-src 'none'", `script-src ${hashes.join(" ")}`, "style-src 'unsafe-inline'", "img-src data: blob:", "font-src data:",
  "worker-src blob:", "frame-src 'self'", "connect-src 'none'", "base-uri 'none'", "form-action 'none'"].join("; "); // the diff view's worker
html = html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}">`);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
rmSync(TMP, { recursive: true, force: true });
console.log(`dist-share/share.html ready: ${Math.round(html.length / 1024)} kB`);
