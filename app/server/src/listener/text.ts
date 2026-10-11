// What every log source does to text before it's stored: secrets masked, long texts clipped; and a thread's
// title from its first prompt. Shared by the Claude Code and Codex sources (claude.source.ts, codex.source.ts).
import { maskSecrets } from "../privacy/mask";

export const TEXT_LIMIT = 20_000;
/** A thread's title until a prompt or the person names it. */
export const UNTITLED = "(untitled session)";
/** What a NUL character in a log's text is stored as: SQLite hands text back cut at the first one. */
const NUL_MARK = "\u2400";
export const TOOL_RESULT_LIMIT = 2_000;
/** How far past the limit a long text is cut before masking (see sanitizeText). */
const MASK_MARGIN = 1024;

/** Recursively mask string leaves and clip them to `limit` chars, keeping JSON-shaped values intact. */
export function sanitizeDeep(v: unknown, limit = TEXT_LIMIT): unknown {
  if (typeof v === "string") return sanitizeText(v, limit);
  if (Array.isArray(v)) return v.map((x) => sanitizeDeep(x, limit));
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = sanitizeDeep(val, limit);
    return out;
  }
  return v;
}
/** Mask, then clip to `limit` chars. A long text (a 5 MB tool output kept to 2,000 chars) is cut first, a margin past
 * the limit, so the masking runs on what is kept rather than on all of it. The cut lands on a line break (else a
 * space): no key, token or connection string spans one, and a PEM block cut short is still masked to its end. If
 * masking shortens the kept part a lot (big keys replaced), text near the cut could move inside the limit: then the
 * whole text is masked, as before. */
export function sanitizeText(s: string, limit = TEXT_LIMIT): string {
  if (s.includes("\u0000")) s = s.replace(/\u0000/g, NUL_MARK);
  let masked: string | undefined;
  if (s.length > limit + MASK_MARGIN) {
    // With no break or space within reach (minified code, base64), cut at the margin itself: it is longer than any
    // key, so a key cut through it is still masked whole. Masking all of such a text costs ~1.7 us a char.
    const cut = safeCut(s, limit + MASK_MARGIN);
    const head = s.slice(0, cut > 0 ? cut : limit + MASK_MARGIN);
    const m = maskSecrets(head);
    if (head.length - m.length <= MASK_MARGIN / 4) masked = m;
  }
  masked ??= maskSecrets(s);
  return masked.length > limit ? masked.slice(0, limit) + "\n…(truncated)" : masked;
}
/** Where to cut `s` at or after `from`: the next line break, else the next space or tab, within 16k chars; -1 if none. */
function safeCut(s: string, from: number): number {
  const to = Math.min(s.length, from + 16_384);
  const nl = s.indexOf("\n", from);
  if (nl !== -1 && nl < to) return nl;
  for (let i = from; i < to; i++) { const c = s.charCodeAt(i); if (c === 32 || c === 9 || c === 13) return i; }
  return -1;
}

const PASTE = /<pasted_content\b[^>]*>([\s\S]*?)(<\/pasted_content>|$)/g;

/** Text pasted into a prompt arrives wrapped in `<pasted_content id="…">`. What the person typed around it makes the
 * better title ("help me draft it?"); with nothing typed around it, the pasted text itself. Same rule as the web's. */
export function withoutPastes(text: string): string {
  const typed = text.replace(PASTE, " ").trim();
  return typed || text.replace(PASTE, "$1");
}

/**
 * A readable thread title from the first prompt. Claude Code wraps slash commands and local output in tags
 * (<command-name>, <local-command-caveat>, <local-command-stdout>...): keep the command, drop the rest.
 * Undefined when nothing readable is left, so a later prompt can title the thread.
 */
export function promptTitle(text: string, max = 80): string | undefined {
  const command = /<command-name>([^<]*)/.exec(text)?.[1]?.trim();
  const args = /<command-args>([^<]*)<\/command-args>/.exec(text)?.[1]?.trim();
  if (command) return `${command}${args ? " " + args : ""}`.slice(0, max);
  const plain = withoutPastes(text)
    .replace(/<bash-input>([\s\S]*?)(<\/bash-input>|$)/g, "$ $1") // a command run with ! in Claude Code
    .replace(/<(bash-stdout|bash-stderr)>[\s\S]*?(<\/\1>|$)/g, "")
    .replace(/<(local-command-caveat|local-command-stdout|local-command-stderr|system-reminder|command-message|command-args)>[\s\S]*?(<\/\1>|$)/g, "")
    .replace(/<\/?[a-z_-]+(\s[^>]*)?>/g, "")
    .trim();
  return plain ? plain.slice(0, max) : undefined;
}

/** A title as stored: secrets masked (a key typed in a first prompt or a /rename), NULs made visible. A prompt's is
 * worked out with a margin past `max` and masked before it is cut, so a key across the cut is still masked. */
export function storedTitle(text: string, max = 80): string {
  return sanitizeText(text, Infinity).slice(0, max);
}
export function titleOfPrompt(raw: string, max = 80): string | undefined {
  const t = promptTitle(raw, max + MASK_MARGIN);
  return t === undefined ? undefined : storedTitle(t, max) || undefined;
}
