// POST /api/usage-forget {id}: deletes every usage report sent with this install id (Settings → "Delete the stats
// already sent" in the app, or a request by email). The id is a random UUID only the install knows, so knowing it is
// the proof. Answers the same whether there were reports or not. Reports sent before the index existed are found only after
// tools/index-usage.mjs has run once.
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
    // usage-index/<id>/<day>.json lists the days this install reported (api/usage.js writes it with each report), and a
    // report's name starts with usage/<day>/<id>_ (see _usage.js): a few small listings, whatever the store holds.
    const index = await listAll(auth, `usage-index/${id}/`);
    const days = index.map((b) => /^usage-index\/[^/]+\/(\d{4}-\d{2}-\d{2})\.json$/.exec(b.pathname)?.[1]).filter(Boolean);
    const mine = [];
    for (let i = 0; i < days.length; i += 10) {
      const lists = await Promise.all(days.slice(i, i + 10).map((day) => listAll(auth, `usage/${day}/${id}_`, 1)));
      for (const l of lists) mine.push(...l);
    }
    await deleteAll(auth, mine.map((b) => b.url));
    await deleteAll(auth, index.map((b) => b.url)); // the index last: if the first delete failed, a retry still finds everything
    return res.status(200).json({ ok: true, deleted: mine.length });
  } catch (e) {
    console.error("usage-forget:", e.message);
    return res.status(502).json({ error: "Couldn't delete right now. Try again later." });
  }
};
