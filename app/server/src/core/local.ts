import { resolve } from "node:path";

/** A setting from the environment: RUNDOWN_<name>, or its name before the rename, BRAINSTORM_<name> (read until 0.6). */
export const env = (name: string): string | undefined => process.env[`RUNDOWN_${name}`] ?? process.env[`BRAINSTORM_${name}`];

/** Where Rundown keeps its database and private files. The plugin sets RUNDOWN_DATA_DIR; dev uses app/server/data. */
export const dataDir = () => resolve(env("DATA_DIR") ?? resolve(__dirname, "../../data"));

const LOCAL_NAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
// "*.localhost" names (a dev proxy's "web.rundown.localhost") always resolve to this machine (RFC 6761): no site can claim one.
const isLocalName = (name: string) => LOCAL_NAMES.has(name) || name.endsWith(".localhost");

/** A Host header naming this machine (anything else is a DNS-rebinding attempt: some site pointing its own name at 127.0.0.1). */
export function isLocalHost(host: string | undefined): boolean {
  if (!host) return false;
  const name = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
  return isLocalName(name.toLowerCase());
}

/** A request that may change something: reads always pass; a write needs a JSON body and, from a browser, a page on
 * this machine. Forms and no-cors fetches from other sites can't send `application/json` without a preflight. */
export function isLocalWrite(method: string, contentType: string | undefined, origin: string | undefined): boolean {
  if (method === "GET" || method === "HEAD") return true;
  return /^application\/json\s*(;|$)/i.test(contentType ?? "") && isLocalOrigin(origin);
}

/** A browser Origin from this machine, or none (curl, scripts). Blocks other websites from reading the live feed. */
export function isLocalOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  try { return isLocalName(new URL(origin).hostname.toLowerCase()); } catch { return false; }
}
