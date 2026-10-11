// One-time migration for the double opt-in (not run for you). Before it, a signup was saved as waitlist/<email>.json
// with no confirmation. Those people are unconfirmed under the new rules, and the release email goes to confirmed
// addresses only. Run from site/, after `vercel env pull tools/.env.local`:
//   node --env-file=tools/.env.local tools/migrate-waitlist.mjs          shows how many old records there are
//   node --env-file=tools/.env.local tools/migrate-waitlist.mjs --keep   moves them to waitlist/confirmed/ (they asked
//       for the email on the old form, with the same consent text; your call whether that counts. If not, leave them
//       where they are: the release email never goes to them, and the privacy page's promise holds)
// It copies each record's content, then deletes the old one. Safe to run twice.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { blobAuth, listAll, deleteAll, putJson } = require("../api/_blob.js");
const { blobHeaders } = require("../api/_usage.js");

const auth = blobAuth({ headers: {} });
if (!auth) { console.error("No Blob store credentials: run vercel env pull tools/.env.local first."); process.exit(1); }
const old = (await listAll(auth, "waitlist/")).filter((b) => /^waitlist\/[^/]+\.json$/.test(b.pathname));
console.log(`${old.length} old unconfirmed records.`);
const to = process.argv.includes("--keep") ? "confirmed" : null;
if (!to) { console.log("Nothing moved. Add --keep to move them."); process.exit(0); }
for (const b of old) {
  const r = await fetch(b.url, { headers: blobHeaders(auth) });
  const rec = r.ok ? await r.json().catch(() => null) : null;
  const email = b.pathname.replace(/^waitlist\//, "").replace(/\.json$/, "");
  if (!rec) { console.error("skipped (unreadable):", b.pathname); continue; }
  await putJson(auth, `waitlist/${to}/${email}.json`, { ...rec, confirmedAt: new Date().toISOString(), migrated: true });
  await deleteAll(auth, [b.url]);
}
console.log(`Moved to waitlist/${to}/.`);
