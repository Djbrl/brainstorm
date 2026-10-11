import { execFileSync } from "node:child_process";
import { homedir, hostname, userInfo } from "node:os";
import { gitEnv } from "../core/git-safety";
import { maskSecrets } from "../privacy/mask";
import { redactReplayJson } from "./redact";

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// The local part is capped at 64 (the most an address can have): an unbounded one is re-scanned from every character of a long run.
export const EMAIL =/[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

const LOCAL = /[A-Za-z0-9._%+-]/;
/** Every e-mail address becomes "[email]" (git@ remotes stay). EMAIL caps the local part at 64 characters so it stays
 *  linear; a longer one is widened back here, one pass, so no part of it is left showing. */
export function maskEmails(s: string): string {
  let out = "", last = 0;
  for (const m of s.matchAll(EMAIL)) {
    let start = m.index!;
    while (start > last && LOCAL.test(s[start - 1])) start--;
    const e = s.slice(start, m.index! + m[0].length);
    out += s.slice(last, start) + (e.startsWith("git@") ? e : "[email]");
    last = m.index! + m[0].length;
  }
  return out + s.slice(last);
}

/** Words too common to replace wherever they appear, even when they are an account, computer or git name: "dev"
 * would turn `npm run dev` into `npm run user`, "Studio" would turn "Android Studio" into "Android computer". */
const COMMON = new Set([
  "dev", "max", "pro", "air", "mac", "mini", "studio", "test", "tests", "admin", "user", "users", "home", "root", "guest",
  "main", "master", "local", "localhost", "macbook", "imac", "server", "desktop", "laptop", "computer", "office", "work",
  "code", "data", "demo", "build", "docs", "null", "none", "default", "staff", "shared", "public", "temp", "backup",
  "node", "docker", "ubuntu", "debian", "linux", "owner", "info", "hello", "contact", "mail", "team", "git", "noreply",
  "no-reply", "me", "app", "web", "api", "rundown", "claude", "agent", "runner", "ci", "deploy", "macmini",
]);
/** A name distinctive enough to replace wherever it appears as a whole word: 4 characters or more, not a common word. */
const distinctive = (n: string) => n.length >= 4 && !COMMON.has(n.toLowerCase());

/** This computer's names, longest first: the host name, and on macOS the names shell prompts use (it can be an IP). */
export function computerNames(): string[] {
  const names = new Set<string>([hostname().replace(/\.local$/, "")]);
  if (process.platform === "darwin") for (const key of ["ComputerName", "LocalHostName"]) {
    try { names.add(execFileSync("scutil", ["--get", key], { encoding: "utf8", timeout: 2000 }).trim()); } catch { /* not set */ }
  }
  // A host name that's an address (192.168.1.9) shows in prompts too: kept when it's a whole IPv4 address.
  return [...names].filter((n) => distinctive(n) && (!/^[\d.:]+$/.test(n) || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(n))).sort((a, b) => b.length - a.length);
}

/** One of git's global settings (user.email, user.name), read without any repository's config. */
function gitGlobal(key: string): string {
  try { return execFileSync("git", ["config", "--global", "--get", key], { encoding: "utf8", timeout: 2000, env: gitEnv() }).trim(); } catch { return ""; }
}

/** "ana.lee" from git's user.email "ana.lee@example.com", when it's distinctive enough to mask on its own. */
function gitEmailName(email: string): string | null {
  const [name, domain = ""] = email.split("@");
  if (/noreply|no-reply/i.test(domain)) return null; // a public handle (GitHub's no-reply address), not private
  return name && distinctive(name) ? name : null;
}

/** Who the person is, as it shows up in text: their home folders, account, computers, git email's name and git name. */
export type Identity = { homes: string[]; user: string; hosts: string[]; mailbox: string | null; name: string | null };

export function localIdentity(): Identity {
  let user = "", accountHome = "";
  try { ({ username: user, homedir: accountHome } = userInfo()); } catch { /* no user entry */ }
  // Both $HOME and the account's own home, in case they differ.
  const homes = [...new Set([homedir(), accountHome])].filter((h) => h.length > 1);
  const name = gitGlobal("user.name");
  return { homes, user, hosts: computerNames(), mailbox: gitEmailName(gitGlobal("user.email")), name: name && distinctive(name) ? name : null };
}

/**
 * Everything that leaves the machine goes through here: secrets masked again (steps stored before a masking rule
 * existed), the home folder shown as ~, emails, the git name and the account and computer names replaced, then the
 * private redaction list if there is one. Object keys are masked like values (a tool's input can be keyed by path).
 */
export function forSharing<T>(value: T, id: Identity = localIdentity()): T {
  const { homes, user } = id;
  // The home folder as a path (/Users/ana), and as Claude Code writes it in folder names (-Users-ana-Documents-app).
  // Also as JSON writes it inside a string (\/Users\/ana) and as a URL encodes it (%2FUsers%2Fana).
  const homeForms = homes.flatMap((h) => [h, h.replace(/\//g, "\\/"), encodeURIComponent(h)]);
  const homeRe = homes.length ? new RegExp(`(?:${homeForms.map(esc).join("|")})(?=[/\\\\%]|\\b|$)`, "gi") : null;
  const encoded = homes.map((h) => h.replace(/[^A-Za-z0-9-]/g, "-")).filter((e) => e.length > 2);
  const encodedRe = encoded.length ? new RegExp(`(?:${encoded.map(esc).join("|")})(?=-|\\b|$)`, "g") : null;
  // The account and computer names, which tool output shows too (shell prompts, `ls -l`, `whoami`), the name part of
  // the git email, which shows up in git output even where a line was cut mid-address, and the git name (`git log`,
  // Signed-off-by). Whole words, exact case, distinctive names only: a computer called "dev" must not turn "developer"
  // into "computereloper", nor `npm run dev` into `npm run computer`.
  const whole = (name: string) => new RegExp(`(?<![\\w.-])${esc(name)}(?![\\w-])`, "g");
  const hosts = id.hosts.filter(distinctive);
  const hostRe = hosts.length ? new RegExp(`(?<![\\w.-])(?:${hosts.map(esc).join("|")})(?:\\.local)?(?![\\w-]|\\.\\d)`, "g") : null;
  const userRe = distinctive(user) ? whole(user) : null;
  const mailboxRe = id.mailbox && distinctive(id.mailbox) ? new RegExp(`(?<![\\w.+-])${esc(id.mailbox)}(?![\\w-])`, "g") : null;
  const nameRe = id.name && distinctive(id.name) ? whole(id.name) : null;
  const str = (v: string): string => {
    let m = maskSecrets(v);
    if (homeRe) m = m.replace(homeRe, "~");
    if (encodedRe) m = m.replace(encodedRe, "-~");
    if (m.includes("@")) m = maskEmails(m);
    // The longer names first: the mailbox (ana.lee) and the git name (Ana Lee) before the account name (ana) breaks them.
    if (mailboxRe) m = m.replace(mailboxRe, "[email]");
    if (nameRe) m = m.replace(nameRe, "[name]");
    if (hostRe) m = m.replace(hostRe, "computer");
    if (userRe) m = m.replace(userRe, "user");
    return m;
  };
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return str(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [str(k), walk(x)]));
    return v;
  };
  return JSON.parse(redactReplayJson(JSON.stringify(walk(value))).json) as T;
}

/** A file name from a title: "Fix the login bug!" → "fix-the-login-bug". */
export const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_-]+/g, "-").slice(0, 60) || "thread";
