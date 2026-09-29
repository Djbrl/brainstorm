// POST /api/waitlist (form field `email`): keeps each email as one file, waitlist/<email>.json, in a private Vercel Blob
// store connected to this project. No dependencies: it calls the same API as the @vercel/blob SDK (v2.4, API version 12).
// Credentials, as the SDK resolves them: Vercel's OIDC token plus BLOB_STORE_ID, else BLOB_READ_WRITE_TOKEN.
// Read the list with `vercel blob list --prefix waitlist/` from site/.

const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const body = req.body || {};
  if (body.company) return res.status(200).json({ ok: true }); // honeypot: bots fill every field
  const email = String(body.email || "").trim().toLowerCase();
  if (email.length > 254 || !EMAIL.test(email)) return res.status(400).json({ error: "That doesn't look like an email address." });

  const oidc = req.headers["x-vercel-oidc-token"] || process.env.VERCEL_OIDC_TOKEN;
  const rw = process.env.BLOB_READ_WRITE_TOKEN;
  const auth = oidc && process.env.BLOB_STORE_ID
    ? { token: oidc, storeId: process.env.BLOB_STORE_ID.replace(/^store_/, "") }
    : rw ? { token: rw, storeId: rw.split("_")[3] || "" } : null;
  if (!auth) return res.status(503).json({ error: "The waitlist isn't open yet." });

  const r = await fetch("https://vercel.com/api/blob/?" + new URLSearchParams({ pathname: `waitlist/${email}.json` }), {
    method: "PUT",
    body: JSON.stringify({ email, at: new Date().toISOString() }),
    headers: {
      authorization: `Bearer ${auth.token}`,
      "x-api-version": "12",
      "x-vercel-blob-store-id": auth.storeId,
      "x-vercel-blob-access": "private",
      "x-content-type": "application/json",
      "x-add-random-suffix": "0",
      "x-allow-overwrite": "1", // signing up twice just updates the date
    },
  });
  if (!r.ok) {
    console.error("waitlist: blob put failed with status", r.status); // status only: the response can echo the email
    return res.status(502).json({ error: "Couldn't save that. Try again in a minute." });
  }
  return res.status(200).json({ ok: true });
};
