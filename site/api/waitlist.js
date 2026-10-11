// POST /api/waitlist (JSON `{email}`): the release-email signup, with a confirmation step (double opt-in). It saves the
// address as unconfirmed (waitlist/pending/, see _waitlist.js) in the private Blob store and emails a link; the link
// (api/waitlist-confirm.js) is what makes it a recipient. An address that unsubscribed, or is already confirmed, gets the
// same answer and no email, so the form never tells anyone whether an address is known. No dependencies: it calls the
// same Blob API as the @vercel/blob SDK (v2.4, API version 12). Needs UNSUBSCRIBE_SECRET, RESEND_API_KEY, RESEND_FROM.
// Read the list with `vercel blob list --prefix waitlist/confirmed/` from site/.
const { sameOrigin } = require("./_usage");
const { blobAuth, putJson, findOne } = require("./_blob");
const { tokenFor } = require("./_unsubscribe");
const { sendMail } = require("./_mail");
const { pendingPath, confirmedPath, unsubscribedPath, PENDING_DAYS } = require("./_waitlist");

const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;
const SITE = process.env.SITE_URL || "https://brainstorm-landing.vercel.app";
const RESEND_AFTER_MS = 10 * 60_000; // signing up again within this time doesn't send a second email

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!sameOrigin(req)) return res.status(403).json({ error: "Not from here." }); // another site posting through a visitor's browser
  if (!/^application\/json\b/i.test(String(req.headers["content-type"] || ""))) return res.status(415).json({ error: "JSON only." }); // a cross-site form or text/plain post doesn't send it
  const body = req.body && typeof req.body === "object" ? req.body : {};
  if (body.company) return res.status(200).json({ ok: true }); // honeypot: bots fill every field
  const email = String(body.email || "").trim().toLowerCase();
  if (email.length > 254 || !EMAIL.test(email)) return res.status(400).json({ error: "That doesn't look like an email address." });

  const secret = process.env.UNSUBSCRIBE_SECRET, auth = blobAuth(req);
  if (!auth || !secret || !process.env.RESEND_API_KEY || !process.env.RESEND_FROM) return res.status(503).json({ error: "The waitlist isn't open yet." });

  try {
    if (await findOne(auth, unsubscribedPath(email, secret))) return res.status(200).json({ ok: true, confirm: true }); // they left: not added again, no email
    if (await findOne(auth, confirmedPath(email))) return res.status(200).json({ ok: true, confirm: true });
    const had = await findOne(auth, pendingPath(email));
    if (had && Date.now() - Date.parse(had.uploadedAt) < RESEND_AFTER_MS) return res.status(200).json({ ok: true, confirm: true });

    // What they asked for, kept with the address (the privacy page's "release email" section).
    await putJson(auth, pendingPath(email), { email, at: new Date().toISOString(), consent: "Release email: we only email when it's necessary; unsubscribe link in every email", policy: "privacy-2026-10-11" });
    const link = `${SITE}/api/waitlist-confirm?${new URLSearchParams({ e: email, t: tokenFor(email, secret, "confirm") })}`;
    await sendMail({
      to: email,
      subject: "Confirm your email for Rundown",
      text: `Hi,\n\nSomeone asked for Rundown's release email with this address. If it was you, confirm it here:\n\n${link}\n\nIf it wasn't you, do nothing. We'll forget your address in ${PENDING_DAYS} days.\n\nDjibril`,
      html: `<div style="font-family:-apple-system,system-ui,sans-serif;font-size:16px;line-height:1.55;color:#121214;max-width:560px"><p>Hi,</p><p>Someone asked for Rundown's release email with this address. If it was you, <a href="${link}">confirm it here</a>.</p><p>If it wasn't you, do nothing. We'll forget your address in ${PENDING_DAYS} days.</p><p>Djibril</p></div>`,
    });
    return res.status(200).json({ ok: true, confirm: true });
  } catch (e) {
    console.error("waitlist:", e.message); // never the address
    return res.status(502).json({ error: "Couldn't save that. Try again in a minute." });
  }
};
