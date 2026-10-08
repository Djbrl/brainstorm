// Writes plugin/build/THIRD_PARTY_NOTICES.md: the licence of every open-source package the plugin ships. The release
// bundles the server (esbuild) and the web app (Vite) into a few files, and most licences (MIT, ISC, BSD, Apache 2.0)
// ask that their notice go with every copy. Generous on purpose: every package the server or the web app needs at run
// time (package-lock.json entries that aren't dev-only), whether or not the bundler kept all of it.
// Run by build-plugin.mjs; on its own: node app/scripts/third-party-notices.mjs
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(APP, "../plugin/build/THIRD_PARTY_NOTICES.md");

function runtimePackages(dir) {
  const lock = JSON.parse(readFileSync(join(APP, dir, "package-lock.json"), "utf8"));
  const out = [];
  for (const [path, info] of Object.entries(lock.packages || {})) {
    if (!path.startsWith("node_modules/") || info.dev || info.devOptional || info.extraneous) continue;
    const name = path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
    out.push({ name, version: info.version, dir: join(APP, dir, path), license: info.license });
  }
  return out;
}

function licenceText(dir) {
  if (!existsSync(dir)) return null;
  const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying|notice)(\.|$|-)/i.test(f));
  return file ? readFileSync(join(dir, file), "utf8").trim() : null;
}

const seen = new Map();
for (const p of [...runtimePackages("server"), ...runtimePackages("web")]) {
  const key = `${p.name}@${p.version}`;
  if (seen.has(key)) continue;
  let license = p.license;
  try { const pj = JSON.parse(readFileSync(join(p.dir, "package.json"), "utf8")); license ??= pj.license ?? pj.licenses?.map((l) => l.type ?? l).join(" OR "); } catch { /* not installed here */ }
  seen.set(key, { ...p, license: typeof license === "string" ? license : license?.type ?? "see package", text: licenceText(p.dir) });
}
const pkgs = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
const byLicence = {};
for (const p of pkgs) byLicence[p.license] = (byLicence[p.license] ?? 0) + 1;

let md = `# Third-party notices\n\nRundown's plugin build (\`server.js\`, \`web/\`, \`share.html\`) includes open-source software. Each package's licence and notice follow.\n\n`;
md += `${pkgs.length} packages: ${Object.entries(byLicence).sort((a, b) => b[1] - a[1]).map(([l, n]) => `${l} (${n})`).join(", ")}.\n\n`;
for (const p of pkgs) {
  md += `## ${p.name} ${p.version}\n\nLicence: ${p.license}\n\n`;
  md += p.text ? "```\n" + p.text.replace(/```/g, "'''") + "\n```\n\n" : `The package ships no licence file; its package.json declares ${p.license}.\n\n`;
}
writeFileSync(OUT, md);
const missing = pkgs.filter((p) => !p.text).length;
console.log(`THIRD_PARTY_NOTICES.md: ${pkgs.length} packages, ${missing} without a licence file of their own`);
