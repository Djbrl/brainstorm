import { execFileSync } from "node:child_process";
import { homedir, hostname, userInfo } from "node:os";
import { maskSecrets } from "../privacy/mask";
import { redactReplayJson } from "./redact";

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

/** This computer's names, longest first: the host name, and on macOS the names shell prompts use (it can be an IP). */
export function computerNames(): string[] {
  const names = new Set<string>([hostname().replace(/\.local$/, "")]);
  if (process.platform === "darwin") for (const key of ["ComputerName", "LocalHostName"]) {
    try { names.add(execFileSync("scutil", ["--get", key], { encoding: "utf8", timeout: 2000 }).trim()); } catch { /* not set */ }
  }
  // A host name that's an address (192.168.1.9) shows in prompts too: kept when it's a whole IPv4 address.
  return [...names].filter((n) => n.length >= 3 && (!/^[\d.:]+$/.test(n) || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(n))).sort((a, b) => b.length - a.length);
}

/** "ana.lee" from git's user.email "ana.lee@example.com", when it's distinctive enough to mask on its own. */
function gitEmailName(): string | null {
  try {
    const email = execFileSync("git", ["config", "--global", "--get", "user.email"], { encoding: "utf8", timeout: 2000 }).trim();
    const [name, domain = ""] = email.split("@");
    if (/noreply|no-reply/i.test(domain)) return null; // a public handle (GitHub's no-reply address), not private
    return name.length >= 4 && !/^(git|noreply|no-reply|admin|info|contact|hello|dev|me)$/i.test(name) ? name : null;
  } catch { return null; }
}

/**
 * Everything that leaves the machine goes through here: secrets masked again (steps stored before a masking rule
 * existed), the home folder shown as ~, the account and computer names replaced, then the private redaction list if
 * there is one.
 */
export function forSharing<T>(value: T): T {
  // The home folder as a path (/Users/ana), and as Claude Code writes it in folder names (-Users-ana-Documents-app).
  // Both $HOME and the account's own home, in case they differ.
  let user = "", accountHome = "";
  try { ({ username: user, homedir: accountHome } = userInfo()); } catch { /* no user entry */ }
  const homes = [...new Set([homedir(), accountHome])].filter((h) => h.length > 1);
  // Also as JSON writes it inside a string (\/Users\/ana) and as a URL encodes it (%2FUsers%2Fana).
  const homeForms = homes.flatMap((h) => [h, h.replace(/\//g, "\\/"), encodeURIComponent(h)]);
  const homeRe = homes.length ? new RegExp(`(?:${homeForms.map(esc).join("|")})(?=[/\\\\%]|\\b|$)`, "gi") : null;
  const encoded = homes.map((h) => h.replace(/[^A-Za-z0-9-]/g, "-")).filter((e) => e.length > 2);
  const encodedRe = encoded.length ? new RegExp(`(?:${encoded.map(esc).join("|")})(?=-|\\b|$)`, "g") : null;
  // The account and computer names, which tool output shows too (shell prompts, `ls -l`, `whoami`), and the name part
  // of the git email, which shows up in git output even where a line was cut mid-address.
  const hosts = computerNames();
  const userRe = user.length >= 3 ? new RegExp(`(?<![\\w.-])${esc(user)}(?![\\w-])`, "g") : null;
  // Whole names only: a computer called "dev" must not turn "developer" into "computereloper".
  const hostRe = hosts.length ? new RegExp(`(?<![\\w.-])(?:${hosts.map(esc).join("|")})(?:\\.local)?(?![\\w-]|\\.\\d)`, "gi") : null;
  const mailbox = gitEmailName();
  const mailboxRe = mailbox ? new RegExp(`(?<![\\w.+-])${esc(mailbox)}(?![\\w-])`, "gi") : null;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      let m = maskSecrets(v);
      if (homeRe) m = m.replace(homeRe, "~");
      if (encodedRe) m = m.replace(encodedRe, "-~");
      if (hostRe) m = m.replace(hostRe, "computer");
      if (userRe) m = m.replace(userRe, "user");
      m = m.replace(EMAIL, (e) => (e.startsWith("git@") ? e : "[email]"));
      if (mailboxRe) m = m.replace(mailboxRe, "[email]");
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
