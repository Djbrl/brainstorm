// POST /api/usage-forget {id}: deletes every usage report sent with this install id (Settings → "Delete the stats
// already sent" in the app, or a request by email). The id is a random UUID only the install knows, so knowing it is
// the proof. Answers the same whether there were reports or not.
const { blobAuth, listAll, deleteAll } = require("./_blob");

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

module.exports = async (req, res) => {
  res.setHeader("cache-control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const id = String((req.body || {}).id || "").toLowerCase();
  if (!ID.test(id)) return res.status(400).json({ error: "That isn't an install id." });
  const auth = blobAuth(req);
  if (!auth) return res.status(503).json({ error: "The store isn't connected." });
  try {
    // A report's name starts with usage/<day>/<id>_ (see _usage.js), so the id is found in the names alone.
    const mine = (await listAll(auth, "usage/")).filter((b) => b.pathname.split("/")[2]?.startsWith(id + "_"));
    await deleteAll(auth, mine.map((b) => b.url));
    return res.status(200).json({ ok: true, deleted: mine.length });
  } catch (e) {
    console.error("usage-forget:", e.message);
    return res.status(502).json({ error: "Couldn't delete right now. Try again later." });
  }
};
