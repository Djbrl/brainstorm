// The release email: the recipient list with each person's unsubscribe links, and sending it through Resend.
// Run from site/. Setup, once per machine:
//   vercel env pull tools/.env.local   (the Blob store token)
//   then add to tools/.env.local yourself:
//     UNSUBSCRIBE_SECRET=<the value you saved>   (sensitive in Vercel, so env pull leaves it out; must match Vercel's)
//     RESEND_API_KEY=re_…                        (a Resend key with sending access)
//     RESEND_FROM=Djibril from Rundown <hello@your-verified-domain>
//
//   node --env-file=tools/.env.local tools/release-email.mjs > recipients.csv
//       the list as CSV (email, unsubscribe_url, list_unsubscribe, list_unsubscribe_post). Never commit it.
//   node --env-file=tools/.env.local tools/release-email.mjs --send --subject "Rundown is out" --test you@example.com
//       one copy of tools/release-email.html to you, to check it
//   node --env-file=tools/.env.local tools/release-email.mjs --send --subject "Rundown is out"
//       says how many it would send; add --yes to send to everyone, 100 per request. A batch retried within 24 hours
//       isn't sent twice (Resend idempotency keys). Each message carries its own unsubscribe link and the two headers
//       for the mail app's own Unsubscribe button (RFC 8058).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { blobAuth, listAll } = require("../api/_blob.js");
const { tokenFor } = require("../api/_unsubscribe.js");

const SITE = process.env.SITE_URL || "https://brainstorm-landing.vercel.app";
const RESEND = process.env.RESEND_API_URL || "https://api.resend.com";
const argv = process.argv.slice(2);
const opt = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const flag = (f) => argv.includes(f);
const fail = (m) => { console.error(m); process.exit(1); };

const secret = process.env.UNSUBSCRIBE_SECRET;
if (!secret) fail("UNSUBSCRIBE_SECRET is missing: add the value you saved to tools/.env.local (Vercel keeps it sensitive, so env pull leaves it out).");

const links = (email) => {
  const q = new URLSearchParams({ e: email, t: tokenFor(email, secret) });
  return { page: `${SITE}/unsubscribe.html?${q}`, oneClick: `<${SITE}/api/unsubscribe?${q}>` };
};

async function recipients() {
  const auth = blobAuth({ headers: {} });
  if (!auth) fail("No Blob store credentials: vercel env pull tools/.env.local first.");
  return (await listAll(auth, "waitlist/")).map((b) => b.pathname.replace(/^waitlist\//, "").replace(/\.json$/, "")).sort();
}

if (!flag("--send")) {
  const csv = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const list = await recipients();
  console.log("email,unsubscribe_url,list_unsubscribe,list_unsubscribe_post");
  for (const email of list) { const l = links(email); console.log([email, l.page, l.oneClick, "List-Unsubscribe=One-Click"].map(csv).join(",")); }
  console.error(`${list.length} recipients`);
  process.exit(0);
}

const subject = opt("--subject"), from = opt("--from") || process.env.RESEND_FROM, key = process.env.RESEND_API_KEY;
if (!subject) fail('--subject "…" is needed.');
if (!from) fail("RESEND_FROM (or --from) is needed: a sender on a domain verified in Resend.");
if (!key) fail("RESEND_API_KEY is missing from tools/.env.local.");
const template = readFileSync(new URL("./release-email.html", import.meta.url), "utf8").replace(/^<!--[\s\S]*?-->\s*/, "");
if (/\[[^\]]+\]/.test(template.replace(/\{\{UNSUBSCRIBE_URL\}\}/g, ""))) fail("tools/release-email.html still has a [placeholder]: write the message first.");
const text = (html) => html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n").replace(/<a [^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/gi, "$2 ($1)")
  .replace(/<hr[^>]*>/gi, "\n---\n").replace(/<[^>]+>/g, "").replace(/[ \t]+/g, " ").replace(/\n /g, "\n").replace(/\n{3,}/g, "\n\n").trim();
const message = (email) => {
  const l = links(email), html = template.replaceAll("{{UNSUBSCRIBE_URL}}", l.page);
  return { from, to: [email], subject, html, text: text(html), headers: { "List-Unsubscribe": l.oneClick, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } };
};

const test = opt("--test");
const list = test ? [test.trim().toLowerCase()] : await recipients();
if (!test && !flag("--yes")) { console.log(`Would send "${subject}" from ${from} to ${list.length} people. Add --yes to send.`); process.exit(0); }

let sent = 0;
for (let i = 0; i < list.length; i += 100) {
  const batch = list.slice(i, i + 100);
  const idem = createHash("sha256").update(subject + "\n" + batch.join("\n")).digest("hex");
  const r = await fetch(`${RESEND}/emails/batch`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "idempotency-key": idem },
    body: JSON.stringify(batch.map(message)),
  });
  if (!r.ok) fail(`Resend refused batch ${i / 100 + 1} (status ${r.status}): ${(await r.text()).slice(0, 300)}\n${sent} sent before it. Running the same command again won't resend those within 24 hours.`);
  sent += batch.length;
  console.error(`sent ${sent} of ${list.length}`);
}
console.log(test ? `Test sent to ${test}.` : `Sent to ${list.length} people.`);
