// POST /api/waitlist-confirm?e=<email>&t=<token>: confirms an address for the release email. The link in the signup
// email is a GET that only sends people to /confirm.html, where a button posts here (link checkers and mail scanners open
// links, and must not confirm anyone). The token proves the link came from us for that address (_unsubscribe.js).
const { sameOrigin } = require("./_usage");
const { blobAuth, putJson, findOne, deleteAll } = require("./_blob");
const { tokenOk } = require("./_unsubscribe");
const { pendingPath, confirmedPath, unsubscribedPath, PENDING_DAYS } = require("./_waitlist");

module.exports = async (req, res) => {
  res.setHeader("cache-control", "no-store");
  const q = req.query || {}, email = String(q.e || "").trim().toLowerCase(), token = String(q.t || "");
  if (req.method === "GET") {
    res.statusCode = 302;
    res.setHeader("location", `/confirm.html?${new URLSearchParams({ e: email, t: token })}`);
    return res.end();
  }
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!sameOrigin(req)) return res.status(403).json({ error: "Not from here." });
  const secret = process.env.UNSUBSCRIBE_SECRET;
  if (!tokenOk(email, token, secret, "confirm")) return res.status(400).json({ error: "This confirm link isn't valid. Sign up again on the site." });
  const auth = blobAuth(req);
  if (!auth) return res.status(503).json({ error: "The list isn't connected. Try again later." });
  try {
    if (await findOne(auth, confirmedPath(email))) return res.status(200).json({ ok: true });
    const pending = await findOne(auth, pendingPath(email));
    if (!pending || Date.now() - Date.parse(pending.uploadedAt) > PENDING_DAYS * 86_400_000 || await findOne(auth, unsubscribedPath(email, secret))) return res.status(410).json({ error: "This link has expired. Sign up again on the site." });
    await putJson(auth, confirmedPath(email), { email, at: pending.uploadedAt, confirmedAt: new Date().toISOString(), consent: "Release email: we only email when it's necessary; unsubscribe link in every email", policy: "privacy-2026-10-11" });
    await deleteAll(auth, [pending.url]);
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("waitlist-confirm:", e.message); // never the address
    return res.status(502).json({ error: "Couldn't confirm right now. Try again in a minute." });
  }
};
