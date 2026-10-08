// The release email's recipient list, with each person's unsubscribe links, as CSV on stdout. Run from site/:
//   vercel env pull tools/.env.local   (the Blob store token)
//   then add UNSUBSCRIBE_SECRET=<the value you saved> to tools/.env.local yourself: it's stored as a sensitive variable,
//   which `vercel env pull` never downloads. It must be the same value as in Vercel, or the links won't work.
//   node --env-file=tools/.env.local tools/release-email.mjs > recipients.csv
// Columns: email, unsubscribe_url (the footer link), list_unsubscribe and list_unsubscribe_post (two headers to set on
// each message, for the mail app's own Unsubscribe button). Keep the CSV off GitHub: it's personal data.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { blobAuth, listAll } = require("../api/_blob.js");
const { tokenFor } = require("../api/_unsubscribe.js");

const SITE = process.env.SITE_URL || "https://brainstorm-landing.vercel.app";
const secret = process.env.UNSUBSCRIBE_SECRET;
if (!secret) { console.error("UNSUBSCRIBE_SECRET is missing: add the value you saved to tools/.env.local (Vercel keeps it sensitive, so env pull leaves it out)."); process.exit(1); }
const auth = blobAuth({ headers: {} });
if (!auth) { console.error("No Blob store credentials: vercel env pull first."); process.exit(1); }

const csv = (v) => `"${String(v).replace(/"/g, '""')}"`;
const rows = (await listAll(auth, "waitlist/")).map((b) => b.pathname.replace(/^waitlist\//, "").replace(/\.json$/, ""));
console.log("email,unsubscribe_url,list_unsubscribe,list_unsubscribe_post");
for (const email of rows.sort()) {
  const q = new URLSearchParams({ e: email, t: tokenFor(email, secret) });
  console.log([email, `${SITE}/unsubscribe.html?${q}`, `<${SITE}/api/unsubscribe?${q}>`, "List-Unsubscribe=One-Click"].map(csv).join(","));
}
console.error(`${rows.length} recipients`);
