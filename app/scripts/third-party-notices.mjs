// The licence of every open-source package the plugin ships. The release bundles the server (esbuild) and the web app
// (Vite) into a few files, and most licences (MIT, ISC, BSD, Apache 2.0) ask that their notice go with every copy.
// The packages are the bundles' actual inputs (esbuild's metafile, Rollup's module ids), passed by build-plugin.mjs.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The packages (name, version, licence, text) the given bundled files come from. */
export function packagesOf(files) {
  const byDir = new Map();
  for (const f of files) {
    const m = /^(.*[\\/]node_modules[\\/])((?:@[^\\/]+[\\/])?[^\\/]+)/.exec(f);
    if (!m) continue; // our own source
    const dir = m[1] + m[2];
    if (byDir.has(dir)) continue;
    let pj = {};
    try { pj = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")); } catch { /* none */ }
    const license = pj.license ?? pj.licenses?.map((l) => l.type ?? l).join(" OR ");
    byDir.set(dir, { name: pj.name ?? m[2].replace(/\\/g, "/"), version: pj.version ?? "?", license: typeof license === "string" ? license : license?.type ?? "see package", text: licenceText(dir) });
  }
  const seen = new Map();
  for (const p of byDir.values()) seen.set(`${p.name}@${p.version}`, p);
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function licenceText(dir) {
  if (!existsSync(dir)) return null;
  const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying|notice)(\.|$|-)/i.test(f));
  return file ? readFileSync(join(dir, file), "utf8").trim() : null;
}

/** THIRD_PARTY_NOTICES.md for the plugin build. */
export function noticesMarkdown(pkgs) {
  pkgs = [...pkgs].sort((a, b) => a.name.localeCompare(b.name));
  const byLicence = {};
  for (const p of pkgs) byLicence[p.license] = (byLicence[p.license] ?? 0) + 1;
  let md = `# Third-party notices\n\nRundown's plugin build (\`server.js\`, \`web/\`, \`share.html\`) includes open-source software. Each package's licence and notice follow.\n\n`;
  md += `${pkgs.length} packages: ${Object.entries(byLicence).sort((a, b) => b[1] - a[1]).map(([l, n]) => `${l} (${n})`).join(", ")}.\n\n`;
  for (const p of pkgs) {
    md += `## ${p.name} ${p.version}\n\nLicence: ${p.license}\n\n`;
    md += p.text ? "```\n" + p.text.replace(/```/g, "'''") + "\n```\n\n" : `The package ships no licence file; its package.json declares ${p.license}.\n\n`;
  }
  return md;
}

/** The same notices as an HTML comment, for share.html (a file that travels without the plugin). */
export function noticesComment(pkgs) {
  const body = pkgs.map((p) => `${p.name} ${p.version} (${p.license})${p.text ? `\n\n${p.text}` : ""}`).join("\n\n----\n\n");
  return `<!--\nThis file includes open-source software. Each package's licence and notice follow.\n\n${body.replace(/--/g, "- -")}\n-->`;
}
