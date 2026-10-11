// How the release-email list is kept in the private Blob store (not a function itself):
//   waitlist/pending/<email>.json     asked for, not yet confirmed (deleted after 30 days by api/usage-prune.js)
//   waitlist/confirmed/<email>.json   confirmed from the email's link: the only addresses the release email goes to
//   waitlist/unsubscribed/<hash>.json a one-way fingerprint of an address that unsubscribed, so it isn't re-added
// Older single-opt-in records, waitlist/<email>.json, are unconfirmed: see tools/migrate-waitlist.mjs.
const { fingerprint } = require("./_unsubscribe");

const PENDING_DAYS = 30;
const pendingPath = (email) => `waitlist/pending/${email}.json`;
const confirmedPath = (email) => `waitlist/confirmed/${email}.json`;
const legacyPath = (email) => `waitlist/${email}.json`;
const unsubscribedPath = (email, secret) => `waitlist/unsubscribed/${fingerprint(email, secret)}.json`;

module.exports = { PENDING_DAYS, pendingPath, confirmedPath, legacyPath, unsubscribedPath };
