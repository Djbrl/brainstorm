// One-time migration (not run for you): gives every usage report sent before the per-install index existed its index
// entry (usage-index/<id>/<day>.json, written by api/usage.js from now on), so Settings → "Delete the stats already
// sent" (api/usage-forget.js) finds the old reports too. Run once, after deploying the new api/usage.js; running it
// again is harmless. From site/, after `vercel env pull tools/.env.local`:
//   node --env-file=tools/.env.local tools/index-usage.mjs          shows what it would add
//   node --env-file=tools/.env.local tools/index-usage.mjs --yes    adds the entries
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { blobAuth, listAll, putJson } = require("../api/_blob.js");
const { parsePathname, indexPathFor } = require("../api/_usage.js");

const auth = blobAuth({ headers: {} });
if (!auth) { console.error("No Blob store credentials: run vercel env pull tools/.env.local first."); process.exit(1); }
const have = new Set((await listAll(auth, "usage-index/")).map((b) => b.pathname));
const want = new Map();
for (const b of await listAll(auth, "usage/")) {
  const r = parsePathname(b.pathname);
  if (r) want.set(indexPathFor(r.id, r.day), 1);
}
const missing = [...want.keys()].filter((p) => !have.has(p));
console.log(`${want.size} install-days in the reports, ${missing.length} without an index entry.`);
if (!process.argv.includes("--yes")) { console.log("Nothing written. Add --yes to write them."); process.exit(0); }
for (let i = 0; i < missing.length; i += 10) await Promise.all(missing.slice(i, i + 10).map((p) => putJson(auth, p, {})));
console.log(`Wrote ${missing.length} entries.`);
