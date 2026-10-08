// Deletes the usage reports sent before stats became opt-in: every report from a version older than 0.7.0 (0.5 and
// 0.6 sent them by default, without asking). Reports from 0.7.0 on were sent after a yes and are kept.
// Run from site/, after `vercel env pull tools/.env.local` (the Blob store's credentials):
//   node --env-file=tools/.env.local tools/delete-old-usage.mjs          shows what it would delete
//   node --env-file=tools/.env.local tools/delete-old-usage.mjs --yes    deletes them (can't be undone)
// Reports whose name can't be read are counted and left alone.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { blobAuth, listAll, deleteAll } = require("../api/_blob.js");
const { parsePathname } = require("../api/_usage.js");

const FIRST_OPT_IN = [0, 7, 0];
const older = (v) => { const p = v.split(".").map(Number); for (let i = 0; i < 3; i++) if (p[i] !== FIRST_OPT_IN[i]) return p[i] < FIRST_OPT_IN[i]; return false; };

const auth = blobAuth({ headers: {} });
if (!auth) { console.error("No Blob store credentials: run vercel env pull tools/.env.local first."); process.exit(1); }
const all = await listAll(auth, "usage/");
const old = [], kept = [], unreadable = [];
for (const b of all) { const r = parsePathname(b.pathname); (!r ? unreadable : older(r.v) ? old : kept).push({ ...b, r }); }

const byVersion = {};
for (const b of old) byVersion[b.r.v] = (byVersion[b.r.v] ?? 0) + 1;
const installs = new Set(old.map((b) => b.r.id)).size;
console.log(`${all.length} reports in the store.`);
console.log(`To delete: ${old.length} reports from ${installs} installs, sent by ${Object.entries(byVersion).map(([v, n]) => `${v} (${n})`).join(", ") || "no older version"}.`);
console.log(`Kept: ${kept.length} from 0.7.0 or later${unreadable.length ? `, and ${unreadable.length} whose name couldn't be read` : ""}.`);
if (!process.argv.includes("--yes")) { console.log("Nothing deleted. Add --yes to delete them."); process.exit(0); }
await deleteAll(auth, old.map((b) => b.url));
console.log(`Deleted ${old.length} reports.`);
