// The release email's unsubscribe links: a token that proves the link came from us for that address (HMAC-SHA256 with
// the project's UNSUBSCRIBE_SECRET), so nobody can take someone else off the list. Used by api/unsubscribe.js and by
// tools/release-email.mjs, which makes the links. Not a function itself.
// The same token scheme proves the confirm link of the signup email ("confirm" purpose), and a one-way fingerprint of an
// address names the "unsubscribed" marker, so the list never keeps an unsubscribed address in the clear.
const { createHmac, timingSafeEqual } = require("node:crypto");

const norm = (email) => String(email).trim().toLowerCase();
const tokenFor = (email, secret, purpose = "unsubscribe") => createHmac("sha256", secret).update(`${purpose}:${norm(email)}`).digest("base64url");
function tokenOk(email, token, secret, purpose = "unsubscribe") {
  if (!secret || !email || !token) return false;
  const a = Buffer.from(tokenFor(email, secret, purpose)), b = Buffer.from(String(token));
  return a.length === b.length && timingSafeEqual(a, b);
}
const fingerprint = (email, secret) => createHmac("sha256", secret).update(`unsubscribed:${norm(email)}`).digest("hex");
module.exports = { tokenFor, tokenOk, fingerprint };
