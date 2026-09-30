import { execFileSync } from "node:child_process";
import { homedir, hostname, userInfo } from "node:os";
import { maskSecrets } from "../privacy/mask";
import { redactReplayJson } from "./redact";

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

/** This computer's names, longest first: the host name, and on macOS the names shell prompts use (it can be an IP). */
function computerNames(): string[] {
  const names = new Set<string>([hostname().replace(/\.local$/, "")]);
  if (process.platform === "darwin") for (const key of ["ComputerName", "LocalHostName"]) {
    try { names.add(execFileSync("scutil", ["--get", key], { encoding: "utf8", timeout: 2000 }).trim()); } catch { /* not set */ }
  }
  return [...names].filter((n) => n.length >= 3 && !/^[\d.:]+$/.test(n)).sort((a, b) => b.length - a.length);
}

/**
 * Everything that leaves the machine goes through here: secrets masked again (steps stored before a masking rule
 * existed), the home folder shown as ~, the account and computer names replaced, then the private redaction list if
 * there is one.
 */
export function forSharing<T>(value: T): T {
  const home = homedir();
  // The home folder as a path (/Users/ana), and as Claude Code writes it in folder names (-Users-ana-Documents-app).
  const homeRe = home.length > 1 ? new RegExp(`${esc(home)}(?=[/\\\\]|\\b|$)`, "g") : null;
  const encoded = home.replace(/[^A-Za-z0-9-]/g, "-");
  const encodedRe = encoded.length > 2 ? new RegExp(`${esc(encoded)}(?=-|\\b|$)`, "g") : null;
  // The account and computer names, which tool output shows too (shell prompts, `ls -l`, `whoami`).
  let user = "";
  try { user = userInfo().username; } catch { /* no user entry */ }
  const hosts = computerNames();
  const userRe = user.length >= 3 ? new RegExp(`(?<![\\w.-])${esc(user)}(?![\\w-])`, "g") : null;
  const hostRe = hosts.length ? new RegExp(`(?:${hosts.map(esc).join("|")})(?:\\.local)?`, "gi") : null;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      let m = maskSecrets(v);
      if (homeRe) m = m.replace(homeRe, "~");
      if (encodedRe) m = m.replace(encodedRe, "-~");
      if (hostRe) m = m.replace(hostRe, "computer");
      if (userRe) m = m.replace(userRe, "user");
      m = m.replace(EMAIL, (e) => (e.startsWith("git@") ? e : "[email]"));
      return m;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return JSON.parse(redactReplayJson(JSON.stringify(walk(value))).json) as T;
}

/** A file name from a title: "Fix the login bug!" → "fix-the-login-bug". */
export const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_-]+/g, "-").slice(0, 60) || "thread";
