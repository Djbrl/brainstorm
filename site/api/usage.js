// POST /api/usage: the app's anonymous daily report (see _usage.js for what's in it and how it's kept). Adds the country
// from Vercel's header and keeps no IP. A bad report is refused without saying why.
const { blobAuth, blobHeaders, validate, countryOf, pathnameFor, dayOf } = require("./_usage");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).end();
  const body = typeof req.body === "string" ? (() => { try { return JSON.parse(req.body); } catch { return null; } })() : req.body;
  if (JSON.stringify(body ?? "").length > 2048) return res.status(413).end();
  const report = validate(body);
  if (!report) return res.status(400).end();
  const auth = blobAuth(req);
  if (!auth) return res.status(503).end();

  const pathname = pathnameFor(report, countryOf(req), dayOf(new Date()));
  const r = await fetch("https://vercel.com/api/blob/?" + new URLSearchParams({ pathname }), {
    method: "PUT",
    body: "{}", // everything is in the name; the file itself stays empty
    headers: { ...blobHeaders(auth), "x-vercel-blob-access": "private", "x-content-type": "application/json", "x-add-random-suffix": "0", "x-allow-overwrite": "1" },
  });
  if (!r.ok) { console.error("usage: blob put failed with status", r.status); return res.status(502).end(); }
  return res.status(204).end();
};
