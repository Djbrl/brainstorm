// The release email's unsubscribe links: a token that proves the link came from us for that address (HMAC-SHA256 with
// the project's UNSUBSCRIBE_SECRET), so nobody can take someone else off the list. Used by api/unsubscribe.js and by
// tools/release-email.mjs, which makes the links. Not a function itself.
const { createHmac, timingSafeEqual } = require("node:crypto");

const tokenFor = (email, secret) => createHmac("sha256", secret).update(`unsubscribe:${email.trim().toLowerCase()}`).digest("base64url");
function tokenOk(email, token, secret) {
  if (!secret || !email || !token) return false;
  const a = Buffer.from(tokenFor(email, secret)), b = Buffer.from(String(token));
  return a.length === b.length && timingSafeEqual(a, b);
}
module.exports = { tokenFor, tokenOk };
