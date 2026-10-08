// POST /api/unsubscribe?e=<email>&t=<token>: takes the address off the release-email list and deletes it (the whole
// record: the address and when it signed up). Two callers: the "Unsubscribe" button on /unsubscribe.html, and mail apps'
// one-click unsubscribe (RFC 8058: POST with body "List-Unsubscribe=One-Click" to the List-Unsubscribe URL). A GET never
// deletes (link checkers open links): it sends people to the page with the button.
const { blobAuth, listAll, deleteAll } = require("./_blob");
const { tokenOk } = require("./_unsubscribe");

module.exports = async (req, res) => {
  res.setHeader("cache-control", "no-store");
  const q = req.query || {}, body = typeof req.body === "object" && req.body ? req.body : {};
  const email = String(q.e || body.e || "").trim().toLowerCase(), token = String(q.t || body.t || "");
  if (req.method === "GET") {
    res.statusCode = 302;
    res.setHeader("location", `/unsubscribe.html?${new URLSearchParams({ e: email, t: token })}`);
    return res.end();
  }
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!tokenOk(email, token, process.env.UNSUBSCRIBE_SECRET)) return res.status(400).json({ error: "This unsubscribe link isn't valid. Reply to the email and we'll remove you by hand." });
  const auth = blobAuth(req);
  if (!auth) return res.status(503).json({ error: "The list isn't connected. Try again later." });
  try {
    const path = `waitlist/${email}.json`;
    const found = (await listAll(auth, path, 1)).filter((b) => b.pathname === path);
    await deleteAll(auth, found.map((b) => b.url));
    return res.status(200).json({ ok: true }); // the same answer whether the address was on the list or not
  } catch (e) {
    console.error("unsubscribe:", e.message); // never the address
    return res.status(502).json({ error: "Couldn't remove you right now. Try again in a minute." });
  }
};
