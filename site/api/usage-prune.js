// GET /api/usage-prune: the daily retention job (vercel.json "crons"). Deletes usage reports older than 13 months, as
// the privacy page says. Vercel sends Authorization: Bearer <CRON_SECRET>; without that project variable it stays shut.
const { timingSafeEqual } = require("node:crypto");
const { blobAuth, listAll, deleteAll } = require("./_blob");

const KEEP_DAYS = 396; // 13 months
const same = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

module.exports = async (req, res) => {
  res.setHeader("cache-control", "no-store");
  const want = process.env.CRON_SECRET, given = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!want || !given || !same(given, want)) return res.status(401).json({ error: "Wrong or missing token." });
  const auth = blobAuth(req);
  if (!auth) return res.status(503).json({ error: "The store isn't connected." });
  const cutoff = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
  try {
    // usage/<YYYY-MM-DD>/…: the day is in the name, compared as text.
    const old = (await listAll(auth, "usage/")).filter((b) => { const day = b.pathname.split("/")[1] || ""; return /^\d{4}-\d{2}-\d{2}$/.test(day) && day < cutoff; });
    await deleteAll(auth, old.map((b) => b.url));
    return res.status(200).json({ ok: true, cutoff, deleted: old.length });
  } catch (e) {
    console.error("usage-prune:", e.message);
    return res.status(502).json({ error: "Couldn't prune right now." });
  }
};
