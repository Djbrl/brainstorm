import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Two random values made fresh each time the server starts. Neither is ever sent to another site.
//
// LIVE_TOKEN: what a page needs to open the live feed (/ws). Only Rundown's own page can read it (GET /api/live-token
// answers without CORS headers, so another site, or another app on another localhost port, gets an opaque response).
// SECRET: written to server.json (0600) for the launcher and the hooks, which ask /api/health to prove it knows it
// before they trust whatever answers on that port. Never sent over HTTP itself.
export const LIVE_TOKEN = randomBytes(24).toString("base64url");
export const SECRET = randomBytes(32).toString("hex");

const hmac = (what: string) => createHmac("sha256", SECRET).update(what).digest("hex");

/** Proof that this server knows SECRET, for a challenge the caller picked. */
export const proof = (challenge: string) => hmac(`health:${challenge}`);

/** Which Anthropic key the server runs with, comparable only by someone who knows SECRET (the launcher). */
export const keyTag = (key?: string) => (key ? hmac(`key:${key}`).slice(0, 12) : null);

export function liveTokenOk(token: string | null | undefined): boolean {
  if (!token) return false;
  const a = Buffer.from(token), b = Buffer.from(LIVE_TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}
