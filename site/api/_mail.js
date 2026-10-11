// Sends one email through Resend (the same sender tools/release-email.mjs uses). Not a function itself.
// Needs RESEND_API_KEY and RESEND_FROM (a sender on a domain verified in Resend) in the project's variables.
const RESEND = process.env.RESEND_API_URL || "https://api.resend.com"; // overridable for local tests

async function sendMail({ to, subject, text, html }) {
  const key = process.env.RESEND_API_KEY, from = process.env.RESEND_FROM;
  if (!key || !from) throw new Error("mail isn't set up (RESEND_API_KEY, RESEND_FROM)");
  const r = await fetch(`${RESEND}/emails`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, text, html }),
  });
  if (!r.ok) throw new Error(`mail failed with status ${r.status}`); // status only: the response can echo the address
}

module.exports = { sendMail };
