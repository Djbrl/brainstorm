// GET /api/usage-stats (Authorization: Bearer <STATS_TOKEN>): the numbers behind /admin.html, from a listing of the
// reports (their names hold everything; see _usage.js). STATS_TOKEN is a project environment variable; without it the
// endpoint stays shut.
const { timingSafeEqual } = require("node:crypto");
const { blobAuth, blobHeaders, parsePathname, aggregate, dayOf } = require("./_usage");

const same = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

module.exports = async (req, res) => {
  res.setHeader("cache-control", "no-store");
  const want = process.env.STATS_TOKEN;
  const given = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!want || !given || !same(given, want)) return res.status(401).json({ error: "Wrong or missing token." });
  const auth = blobAuth(req);
  if (!auth) return res.status(503).json({ error: "The Blob store isn't connected." });

  const records = [];
  let cursor;
  for (let page = 0; page < 200; page++) { // 200 pages of 1000: far beyond what a listing needs for now
    const q = new URLSearchParams({ prefix: "usage/", limit: "1000" });
    if (cursor) q.set("cursor", cursor);
    const r = await fetch("https://vercel.com/api/blob/?" + q, { headers: blobHeaders(auth) });
    if (!r.ok) { console.error("usage-stats: blob list failed with status", r.status); return res.status(502).json({ error: "Couldn't read the reports." }); }
    const data = await r.json();
    for (const b of data.blobs || []) { const rec = parsePathname(b.pathname); if (rec) records.push(rec); }
    if (!data.hasMore || !data.cursor) break;
    cursor = data.cursor;
  }
  const days = Math.min(90, Math.max(7, Number(req.query?.days) || 30));
  return res.status(200).json({ generatedAt: new Date().toISOString(), reports: records.length, ...aggregate(records, dayOf(new Date()), days) });
};
