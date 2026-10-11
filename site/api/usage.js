// POST /api/usage: the app's anonymous daily report (see _usage.js for what's in it and how it's kept). Adds the country
// from Vercel's header and keeps no IP. A bad report is refused without saying why.
const { sameOrigin, blobAuth, validate, countryOf, pathnameFor, indexPathFor, dayOf } = require("./_usage");
const { putJson } = require("./_blob");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).end();
  if (!sameOrigin(req)) return res.status(403).end(); // a page on another site posting through a visitor's browser
  if (!/^application\/json\b/i.test(String(req.headers["content-type"] || ""))) return res.status(415).end(); // the app sends JSON; a cross-site form or text/plain post doesn't
  const body = typeof req.body === "string" ? (() => { try { return JSON.parse(req.body); } catch { return null; } })() : req.body;
  if (JSON.stringify(body ?? "").length > 2048) return res.status(413).end();
  const report = validate(body);
  if (!report) return res.status(400).end();
  const auth = blobAuth(req);
  if (!auth) return res.status(503).end();

  const day = dayOf(new Date());
  try {
    // The index first: a report without its index entry couldn't be found again by Settings → "Delete the stats already sent".
    await putJson(auth, indexPathFor(report.id, day), {});
    await putJson(auth, pathnameFor(report, countryOf(req), day), {}); // everything is in the name; the file itself stays empty
  } catch (e) { console.error("usage:", e.message); return res.status(502).end(); }
  return res.status(204).end();
};
