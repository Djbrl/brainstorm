// Builds dist-share/share.html: the whole web app in one file (scripts and styles inline, lazy parts included), used
// for shared replays. The server puts a recording where the placeholder is (GET /api/share), so the file opens in any
// browser with no server. Run from app/web: `npm run build:share` (build-plugin.mjs runs it too).
import { build } from "vite";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TMP = join(WEB, "dist-share", "tmp");
const OUT = join(WEB, "dist-share", "share.html");
export const PLACEHOLDER = "<!--brainstorm:replay-->";

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
html = html.replace("</head>", `    ${PLACEHOLDER}\n  </head>`);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
rmSync(TMP, { recursive: true, force: true });
console.log(`dist-share/share.html ready: ${Math.round(html.length / 1024)} kB`);
