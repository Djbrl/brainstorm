// Pure helpers that turn raw tool inputs and results into something readable in the step panel.
import { stripNoise } from "../format";

export const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\x1b\][^\x07]*\x07/g, "");

/** Parse text that is JSON (object or array). Undefined if it isn't. */
export function parseJson(s: string | undefined): unknown | undefined {
  const t = (s ?? "").trim();
  if (!/^[[{]/.test(t) || !/[\]}]$/.test(t)) return undefined;
  try { return JSON.parse(t); } catch { return undefined; }
}

/** Notes harnesses add to results for the agent, not the reader. */
export function cleanResult(s: string): string {
  return stripNoise(stripAnsi(s))
    .replace(/\(This tool result is internal metadata[^)]*\)/g, "")
    .replace(/^agentId: .*$/gm, "")
    .replace(/^The agent is working in the background\.[\s\S]*$/m, "")
    .trim();
}

// ---- browsers ----

export type Tab = { id: string; title?: string; url?: string };
/** Both browsers end every result with a "Tab Context:" footer listing the tabs. Split it off. */
export function splitTabContext(text: string): { body: string; tab?: Tab; viewport?: string } {
  const i = text.search(/\n*\s*Tab Context:\s*\n/);
  if (i === -1) return { body: text.trim() };
  const footer = text.slice(i);
  const executed = /Executed on tabId: (\S+)/.exec(footer)?.[1];
  const tabs: Tab[] = [];
  for (let m, re = /tabId (\S+?): "((?:[^"\\\n]|\\.)*)" \("?([^")\s]*)"?\)/g; (m = re.exec(footer)); ) tabs.push({ id: m[1], title: m[2] || undefined, url: m[3] || undefined });
  const viewport = /Viewport: emulating (\S+)/.exec(footer)?.[1];
  return { body: text.slice(0, i).trim(), tab: tabs.find((t) => t.id === executed) ?? tabs[0], viewport };
}

export type BatchPart = { label: string; text: string; failed?: boolean };
/** A browser batch result: "[navigate] …", "[computer:screenshot] …" segments, plus "actions[2] (…) failed: …". */
export function splitBatch(text: string): BatchPart[] {
  const parts: BatchPart[] = [];
  const re = /^\[([a-z_]+(?::[a-z_]+)?)\]\s?/gm;
  const marks: { at: number; end: number; label: string }[] = [];
  for (let m; (m = re.exec(text)); ) marks.push({ at: m.index, end: m.index + m[0].length, label: m[1] });
  marks.forEach((m, i) => parts.push({ label: m.label, text: text.slice(m.end, marks[i + 1]?.at ?? text.length).trim() }));
  const fail = /actions\[(\d+)\] \(([^)]*)\) failed: ([^\n]*)/.exec(text);
  if (fail) {
    const idx = Number(fail[1]);
    const msg = fail[3].replace(/\s*\(\d+ completed, \d+ remaining\)\s*$/, "");
    if (parts[idx]) parts[idx] = { ...parts[idx], failed: true, text: msg };
    else parts[idx] = { label: fail[2], text: msg, failed: true };
    // The failure line is glued to the last successful segment's text.
    const prev = parts[idx - 1];
    if (prev) prev.text = prev.text.replace(/\s*actions\[\d+\][\s\S]*$/, "").trim();
  }
  return parts;
}

// ---- terminal ----

export type ShellResult = { exitCode?: number; background?: string; output: string };
export function parseShell(text: string): ShellResult {
  let out = cleanResult(text);
  const bg = /^Command running in background with ID: (\S+?)\.?(\s|$)/.exec(out);
  if (bg) return { background: bg[1], output: "" };
  const exit = /^Exit code (\d+)\s*\n?/.exec(out);
  if (exit) out = out.slice(exit[0].length);
  out = out.replace(/^\(Bash completed with no output\)$/, "");
  return { exitCode: exit ? Number(exit[1]) : undefined, output: out.replace(/\n…\(truncated\)$/, "\n…") };
}

/** A shell token, for light highlighting. */
export type ShellTok = { t: string; k: "cmd" | "flag" | "str" | "op" | "var" | "text" | "ws" };

/** Split a command into lines at && / || / ; / | (outside quotes), and pull heredoc bodies out as scripts. */
export function formatCommand(cmd: string): { lines: ShellTok[][]; scripts: { lang: string; body: string }[] } {
  const scripts: { lang: string; body: string }[] = [];
  const heredoc = /(\S+)?([^\n]*?)<<-?\s*['"]?(\w+)['"]?([^\n]*)\n([\s\S]*?)\n\s*\3\s*(?=\n|$)/g;
  const flat = cmd.replace(heredoc, (_m, prog: string | undefined, mid: string, tag: string, rest: string, body: string) => {
    const head = `${prog ?? ""}${mid}`;
    const lang = /python/.test(head) ? "Python" : /node/.test(head) ? "JavaScript" : /cat\s*>|tee/.test(head) ? "File contents" : /\b(ba|z|)sh\b/.test(head) ? "Shell" : "Input";
    scripts.push({ lang, body });
    return `${head}<<${tag}${rest} ⟨script ${scripts.length}⟩`;
  });
  const lines: ShellTok[][] = [[]];
  let cmdNext = true;
  const push = (tok: ShellTok) => lines[lines.length - 1].push(tok);
  const re = /(\s+)|('(?:[^'\\]|\\.)*'?|"(?:[^"\\]|\\.)*"?)|(&&|\|\||;|\|)|(\$\{?[\w@#?*]+\}?|\$\()|(⟨script \d+⟩)|([^\s'";|&]+|&)/g;
  for (let m; (m = re.exec(flat)); ) {
    const [tok, ws, str, op, v, scr, word] = m;
    if (ws !== undefined) { if (/\n/.test(ws)) { lines.push([]); cmdNext = true; } else if (lines[lines.length - 1].length) push({ t: " ", k: "ws" }); continue; }
    if (op) { if (op === ";") { push({ t: ";", k: "op" }); lines.push([]); } else { lines.push([{ t: op, k: "op" }, { t: " ", k: "ws" }]); } cmdNext = true; continue; }
    if (str) { push({ t: str, k: "str" }); cmdNext = false; continue; }
    if (v) { push({ t: v, k: "var" }); continue; }
    if (scr) { push({ t: scr, k: "var" }); continue; }
    if (word !== undefined) {
      if (cmdNext && /^\w+=/.test(word)) { push({ t: word, k: "var" }); continue; }
      push({ t: word, k: cmdNext ? "cmd" : /^-/.test(word) ? "flag" : "text" });
      cmdNext = false;
      continue;
    }
    push({ t: tok, k: "text" });
  }
  return { lines: lines.filter((l) => l.some((t) => t.k !== "ws")), scripts };
}

// ---- files and searches ----

/** Claude Code's Read output: "  95\tcode" per line (older logs use "95→code"). */
export function parseNumbered(text: string): { start: number; lines: string[] } | null {
  const raw = text.replace(/\n…\(truncated\)$/, "").split("\n");
  if (raw.length && raw[raw.length - 1] === "") raw.pop();
  const re = /^\s*(\d+)(?:\t|→)(.*)$/;
  const hits = raw.filter((l) => re.test(l)).length;
  if (!raw.length || hits / raw.length < 0.6) return null;
  const first = re.exec(raw.find((l) => re.test(l))!)!;
  return { start: Number(first[1]), lines: raw.map((l) => re.exec(l)?.[2] ?? l) };
}

/** WebSearch: 'Web search results for query: "…"' then 'Links: [{title,url}…]' then the summary. */
export function parseSearch(text: string): { links: { title: string; url: string }[]; summary: string } | null {
  const i = text.indexOf("Links: [");
  if (i === -1) return null;
  let depth = 0, end = -1;
  for (let j = i + 7; j < text.length; j++) {
    const c = text[j];
    if (c === "[") depth++;
    else if (c === "]" && --depth === 0) { end = j + 1; break; }
  }
  if (end === -1) return null;
  const links = parseJson(text.slice(i + 7, end));
  if (!Array.isArray(links)) return null;
  return {
    links: links.filter((l) => l && typeof l.url === "string").map((l) => ({ title: String(l.title ?? l.url), url: l.url })),
    summary: text.slice(end).trim(),
  };
}

export const hostOf = (url: string) => { try { return new URL(url).host.replace(/^www\./, ""); } catch { return url; } };

/** "file_path" → "File path", "maxResults" → "Max results". */
export const humanKey = (k: string) => {
  const s = k.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
};
