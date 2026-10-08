// Listing and deleting in the private Blob store, with the same raw API as the @vercel/blob SDK (2.x): a listing is
// GET /?prefix=…&cursor=…, a delete is POST /delete {urls}. Shared by the usage retention and deletion endpoints and
// the release-email unsubscribe. Not a function itself: Vercel skips files starting with "_".
const { blobAuth, blobHeaders } = require("./_usage");

const API = process.env.BLOB_API_URL || "https://vercel.com/api/blob"; // overridable for local tests

/** Every blob under `prefix`: [{ url, pathname }]. Stops after `maxPages` pages of 1000. */
async function listAll(auth, prefix, maxPages = 500) {
  const out = [];
  let cursor;
  for (let page = 0; page < maxPages; page++) {
    const q = new URLSearchParams({ prefix, limit: "1000" });
    if (cursor) q.set("cursor", cursor);
    const r = await fetch(`${API}/?${q}`, { headers: blobHeaders(auth) });
    if (!r.ok) throw new Error(`blob list failed with status ${r.status}`);
    const data = await r.json();
    for (const b of data.blobs || []) out.push({ url: b.url, pathname: b.pathname });
    if (!data.hasMore || !data.cursor) break;
    cursor = data.cursor;
  }
  return out;
}

/** Delete these blobs (by URL), 100 per request. */
async function deleteAll(auth, urls) {
  for (let i = 0; i < urls.length; i += 100) {
    const r = await fetch(`${API}/delete`, {
      method: "POST",
      headers: { ...blobHeaders(auth), "content-type": "application/json" },
      body: JSON.stringify({ urls: urls.slice(i, i + 100) }),
    });
    if (!r.ok) throw new Error(`blob delete failed with status ${r.status}`);
  }
  return urls.length;
}

module.exports = { API, blobAuth, listAll, deleteAll };
