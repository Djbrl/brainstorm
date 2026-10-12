import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Two random values made fresh each time the server starts. Neither is ever sent to another site.
//
// LIVE_TOKEN: what a page needs to open the live feed (/ws). Only Rundown's own page can read it (GET /api/live-token
// answers without CORS headers, so another site, or another app on another localhost port, gets an opaque response).
// SECRET: written to server.json (0600) for the launcher and the hooks, which ask /api/health to prove it knows it
// before they trust whatever answers on that port, and the hooks sign what they post with it (hookCheck). Never sent
// over HTTP itself.
export const LIVE_TOKEN = randomBytes(24).toString("base64url");
export const SECRET = randomBytes(32).toString("hex");

const hmac = (what: string) => createHmac("sha256", SECRET).update(what).digest("hex");

/** True once SECRET is in server.json, where the hooks read it (a dev server never writes one). */
let shared = false;
export function shareSecret(): string { shared = true; return SECRET; }

/** How old (or how far ahead) a hook's signed time may be. */
export const HOOK_MAX_AGE_MS = 2 * 60_000;

/** The signature a hook sends with its message: HMAC of its time and the exact body (plugin/scripts/signal.mjs). */
export const hookSignature = (ts: string, body: Buffer | string) => createHmac("sha256", SECRET).update(`hook:${ts}:`).update(body).digest("hex");

/** Whether a hook's message is signed with SECRET, recently. "no-secret": the hooks can't know it (no server.json). */
export function hookCheck(ts: string | undefined, sig: string | undefined, body: Buffer | undefined, now = Date.now()): "ok" | "no-secret" | "unsigned" | "bad" | "stale" {
  if (!shared) return "no-secret";
  if (!ts || !sig || !body) return "unsigned";
  const a = Buffer.from(sig), b = Buffer.from(hookSignature(ts, body));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return "bad";
  const at = Number(ts);
  return Number.isFinite(at) && Math.abs(now - at) <= HOOK_MAX_AGE_MS ? "ok" : "stale";
}

/** Proof that this server knows SECRET, for a challenge the caller picked. */
export const proof = (challenge: string) => hmac(`health:${challenge}`);

/** Which Anthropic key the server runs with, comparable only by someone who knows SECRET (the launcher). */
export const keyTag = (key?: string) => (key ? hmac(`key:${key}`).slice(0, 12) : null);

export function liveTokenOk(token: string | null | undefined): boolean {
  if (!token) return false;
  const a = Buffer.from(token), b = Buffer.from(LIVE_TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}
