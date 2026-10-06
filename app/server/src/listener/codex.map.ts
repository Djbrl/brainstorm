// Owner: A. What Codex's log lines say, in the shapes Claude Code's steps use (see codex.source.ts): its diffs and
// patches as before/after, its command outputs as a Claude Code terminal shows them, its prompts with the context
// Codex Desktop adds to them set apart. Pure functions, no state.

/** Claude's MultiEdit shape: per hunk, before = context + removed lines, after = context + added lines. */
const HUNK_SEP = "\n---\n";

/** A unified diff (Codex's FileChange.unified_diff: hunks from `@@`, no file headers) as before/after. */
export function diffToBeforeAfter(diff: string): { before: string; after: string } {
  const before: string[] = [];
  const after: string[] = [];
  let b: string[] | null = null;
  let a: string[] = [];
  const flush = () => { if (b) { before.push(b.join("\n")); after.push(a.join("\n")); } b = null; a = []; };
  const lines = diff.split("\n");
  if (lines[lines.length - 1] === "") lines.pop(); // the diff's final newline
  for (const line of lines) {
    if (line.startsWith("@@")) { flush(); b = []; a = []; continue; }
    if (!b) continue; // before the first hunk: headers (---/+++), if any
    if (line.startsWith("\\")) continue; // "\ No newline at end of file"
    const c = line[0];
    if (c === "-") b.push(line.slice(1));
    else if (c === "+") a.push(line.slice(1));
    else { const t = c === " " ? line.slice(1) : line; b.push(t); a.push(t); }
  }
  flush();
  return { before: before.join(HUNK_SEP), after: after.join(HUNK_SEP) };
}

/** One file of an apply_patch text. */
export type PatchFile = { kind: "add" | "update" | "delete"; path: string; movePath?: string; before: string; after: string; diff: string };

/**
 * Codex's apply_patch format: `*** Begin Patch`, then per file `*** Add File: p` (lines `+…`), `*** Update File: p`
 * (optionally `*** Move to: q`, then `@@` hunks of ` `/`-`/`+` lines) or `*** Delete File: p`; `*** End Patch`.
 */
export function parsePatch(text: string): PatchFile[] {
  const out: PatchFile[] = [];
  let cur: { kind: PatchFile["kind"]; path: string; movePath?: string; lines: string[] } | null = null;
  const done = () => {
    if (!cur) return;
    if (cur.kind === "add") {
      const after = cur.lines.map((l) => (l.startsWith("+") ? l.slice(1) : l)).join("\n");
      out.push({ kind: "add", path: cur.path, before: "", after, diff: cur.lines.join("\n") });
    } else if (cur.kind === "delete") {
      out.push({ kind: "delete", path: cur.path, before: "", after: "", diff: "" });
    } else {
      // Hunks may start without an @@ line (the first one): open one at the start.
      const body = cur.lines[0]?.startsWith("@@") ? cur.lines : ["@@", ...cur.lines];
      const diff = body.join("\n");
      out.push({ kind: "update", path: cur.path, ...(cur.movePath ? { movePath: cur.movePath } : {}), ...diffToBeforeAfter(diff), diff });
    }
    cur = null;
  };
  for (const line of text.split("\n")) {
    let m: RegExpExecArray | null;
    if ((m = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(line))) {
      done();
      cur = { kind: m[1].toLowerCase() as PatchFile["kind"], path: m[2].trim(), lines: [] };
    } else if ((m = /^\*\*\* Move to: (.+)$/.exec(line)) && cur) {
      cur.movePath = m[1].trim();
    } else if (/^\*\*\* (Begin|End) Patch/.test(line)) {
      done();
    } else if (line === "*** End of File") {
      continue;
    } else if (cur) {
      cur.lines.push(line);
    }
  }
  done();
  return out;
}

/** A tool's output (a string, or Codex's [{type: "input_text", text}] blocks) as text; images become a short note. */
export function outputText(out: unknown): string {
  if (typeof out === "string") {
    // apply_patch's output is sometimes JSON: {"output": "...", "metadata": {"exit_code": 0}}.
    if (out.startsWith('{"output":')) {
      try { const j = JSON.parse(out) as { output?: unknown; metadata?: { exit_code?: number } }; if (typeof j.output === "string") return withExit(j.output, j.metadata?.exit_code); } catch { /* not JSON after all */ }
    }
    return out;
  }
  if (Array.isArray(out)) {
    return out.map((b: any) => (b?.type === "input_text" || b?.type === "output_text" || b?.type === "text" ? String(b.text ?? "") : b?.type === "input_image" || b?.type === "image" ? "[image]" : "")).join("");
  }
  if (out && typeof out === "object") {
    const o = out as { content?: unknown; output?: unknown };
    if (o.content !== undefined) return outputText(o.content);
    if (o.output !== undefined) return outputText(o.output);
  }
  return out === undefined || out === null ? "" : JSON.stringify(out);
}

const withExit = (text: string, code?: number) => (code ? `Exit code ${code}\n${text}` : text);

/** A command's result as Claude Code's Bash shows it: the output, with "Exit code N" first when it failed. */
export type ShellResult = { text: string; exitCode?: number; failed: boolean; background?: boolean };

/**
 * Codex's command outputs: exec_command's "Chunk ID … / Wall time … / Process exited with code N / Original token
 * count … / Output:\n…" (or "Process running with session ID N" while it runs), shell_command's "Exit code: N / Wall
 * time … / Output:\n…", and the exec tool's "Script completed|failed|running … / Wall time … / Output:\n…".
 */
export function shellResult(raw: string): ShellResult {
  const head = raw.slice(0, 600);
  const at = raw.indexOf("Output:\n");
  const body = at !== -1 && at < 600 ? raw.slice(at + "Output:\n".length) : raw;
  const exited = /Process exited with code (-?\d+)/.exec(head) ?? /^Exit code:? (-?\d+)/m.exec(head);
  const running = /Process running with session ID (\S+)/.exec(head) ?? /^Script running with cell ID (\S+)/m.exec(head);
  if (running && !exited) return { text: `Command running in background with ID: ${running[1]}.\n${body}`.trimEnd(), failed: false, background: true };
  const exitCode = exited ? Number(exited[1]) : undefined;
  const failed = (exitCode !== undefined && exitCode !== 0) || /^Script failed/m.test(head.split("\n")[0] ?? "");
  const text = exitCode ? `Exit code ${exitCode}\n${body}` : failed ? `Exit code 1\n${body}` : body;
  return { text, exitCode, failed };
}

/** A command as Codex runs it (["/bin/zsh", "-lc", "<script>"]) as the script someone typed. */
export function commandString(cmd: unknown): string {
  if (typeof cmd === "string") return cmd;
  if (!Array.isArray(cmd)) return "";
  const parts = cmd.map(String);
  if (parts.length === 3 && /(^|\/)(ba|z|da|k)?sh$/.test(parts[0]) && /^-l?c$/.test(parts[1])) return parts[2];
  return parts.map((p) => (/^[\w@%+=:,./-]+$/.test(p) ? p : `'${p.replace(/'/g, `'\\''`)}'`)).join(" ");
}

/**
 * The calls to `tool` inside a script Codex ran with its `exec` tool (JavaScript calling `tools.exec_command({...})`,
 * `tools.update_plan({...})`…), in order, as their arguments. Best effort: the argument is usually a JSON object
 * literal; otherwise only its "cmd" and "workdir" strings are looked for.
 */
export function execCalls(code: string, tool: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const re = new RegExp(`tools\\.${tool}\\s*\\(`, "g");
  for (let m; (m = re.exec(code)); ) {
    const start = code.indexOf("{", m.index);
    if (start === -1 || start > m.index + m[0].length + 4) continue;
    const end = objectEnd(code, start);
    const lit = end === -1 ? code.slice(start, start + 20_000) : code.slice(start, end + 1);
    let args: Record<string, unknown> | undefined;
    try { args = JSON.parse(lit); } catch {
      // A JavaScript object literal: `cmd: "…"`, `cmd: '…'` or `cmd: \`…\`` (a template's ${…} kept as written).
      const val = (k: string): string | undefined => {
        const hit = new RegExp(`["']?${k}["']?\\s*:\\s*("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|\`(?:[^\`\\\\]|\\\\.)*\`)`).exec(lit)?.[1];
        if (!hit) return undefined;
        if (hit[0] === '"') { try { return JSON.parse(hit) as string; } catch { return undefined; } }
        return hit.slice(1, -1).replace(/\\(.)/g, "$1");
      };
      const cmd = val("cmd");
      args = cmd ? { cmd, ...(val("workdir") ? { workdir: val("workdir") } : {}) } : undefined;
    }
    if (args && typeof args === "object") out.push(args);
  }
  return out;
}

/** The index of the `}` closing the object opened at `start`, skipping strings; -1 if it isn't closed. */
function objectEnd(s: string, start: number): number {
  let depth = 0;
  let q: string | null = null;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === "\\") i++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === "`") q = c;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
  }
  return -1;
}

/** Text Codex itself puts in a user turn (its context, instructions, notices): never something the person typed. */
const INJECTED = /^\s*(<(environment_context|user_instructions|INSTRUCTIONS|turn_aborted|skill|recommended_plugins|subagent_notification|user_shell_command|collaboration_mode|permissions instructions|apps_instructions|plugins_instructions|skills_instructions|personality_spec|image|\/image)\b|# AGENTS\.md instructions|## AGENTS\.md instructions)/i;
export const isInjected = (text: string) => INJECTED.test(text);

/** Codex's reply to a question it asked (request_user_input), sent back as a user turn: the call it answers. */
export function questionReply(text: string): { callId?: string; text: string } | null {
  const t = text.trim();
  if (!t.startsWith("<send_user_message_question_reply>") && !t.startsWith('[{"questionItemId"')) return null;
  const callId = /request_user_input(?:_async)?\\*"\s*,\s*\\*"(call_[A-Za-z0-9_-]+)/.exec(t)?.[1];
  const body = t.replace(/^<send_user_message_question_reply>\s*/, "").replace(/\s*<\/send_user_message_question_reply>\s*$/, "").replace(/^user:\s*/, "");
  let answer = body;
  try {
    const j = JSON.parse(body) as { question?: string; answers?: unknown; answer?: unknown; selected?: unknown; text?: unknown }[];
    if (Array.isArray(j)) answer = j.map((x) => { const { question: _q, questionItemId: _id, ...rest } = x as Record<string, unknown>; return Object.values(rest).flat().filter((v) => typeof v === "string").join(", ") || JSON.stringify(rest); }).join("\n");
  } catch { /* plain text */ }
  return { callId, text: answer || body };
}

const MY_REQUEST = /^#{1,3} My request(?: for Codex)?:\s*$/m;
const BLOCK = /<([a-z][a-z0-9]*(?:[-_][a-z0-9]+)+)(\s[^>]*)?>[\s\S]*?(<\/\1>|$)/g;

/**
 * A Codex Desktop prompt: what the person asked, with the context Codex Desktop puts before it ("# Files mentioned by
 * the user: …", "# In app browser: …", then "## My request for Codex:") wrapped in a tag, so the web shows it as a
 * chip as it does Claude Code's (follow/prompt.ts). `title`: the person's words alone.
 */
export function codexPrompt(text: string): { text: string; title: string } {
  const m = MY_REQUEST.exec(text);
  let context = "";
  let request = text;
  if (m && /^#/.test(text.trimStart())) {
    context = text.slice(0, m.index).trim();
    request = text.slice(m.index + m[0].length).trim();
  }
  const blocks = context
    ? context.split(/^(?=# )/m).map((part) => part.trim()).filter(Boolean).map((part) => {
      const head = /^# (.+?):?\s*$/m.exec(part.split("\n")[0])?.[1] ?? "Codex context";
      const tag = head.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "codex-context";
      const name = tag.includes("-") ? tag : `${tag}-context`;
      return `<${name}>\n${part.replace(/^# .+\n?/, "").trim()}\n</${name}>`;
    })
    : [];
  const out = blocks.length ? `${blocks.join("\n")}\n\n${request}` : text;
  const title = request.replace(BLOCK, " ").replace(/\s+/g, " ").trim();
  return { text: out, title };
}

/** Codex's plan statuses as TodoWrite's. */
export function todoStatus(s: unknown): string {
  return s === "in_progress" || s === "completed" ? s : "pending";
}

/** Shell words, quotes removed; null if the command has anything beyond plain words (pipes, redirects, variables). */
function words(cmd: string): string[] | null {
  const out: string[] = [];
  const re = /\s*(?:'([^']*)'|"((?:[^"\\$`]|\\.)*)"|([^\s'"|&;<>$`()*?]+))/y;
  let i = 0;
  const s = cmd.trim();
  while (i < s.length) {
    re.lastIndex = i;
    const m = re.exec(s);
    if (!m || re.lastIndex === i) return null;
    out.push(m[1] ?? (m[2] !== undefined ? m[2].replace(/\\(.)/g, "$1") : m[3]));
    i = re.lastIndex;
    while (s[i] === " " || s[i] === "\t") i++;
  }
  return out;
}

/**
 * The files a command only reads, when that's all it does: `sed -n '1,80p' f`, `cat f`, `nl -ba f`, `head -n 40 f`,
 * `tail f`, several joined by `&&`. What Codex itself works out for a command since 0.149 (parsed_cmd), for the
 * commands it logged without it. Null for anything else.
 */
export function readsOf(cmd: string): string[] | null {
  const files: string[] = [];
  for (const part of cmd.split(/\s*&&\s*/)) {
    const w = words(part);
    if (!w || w.length < 2) return null;
    const [prog, ...args] = w;
    let rest: string[];
    if (prog === "sed" && args[0] === "-n" && /^\d+(,\d+)?p$/.test(args[1] ?? "")) rest = args.slice(2);
    else if (prog === "cat") rest = args;
    else if (prog === "nl" && /^-ba$/.test(args[0] ?? "")) rest = args.slice(1);
    else if ((prog === "head" || prog === "tail") && args[0] === "-n" && /^\d+$/.test(args[1] ?? "")) rest = args.slice(2);
    else if ((prog === "head" || prog === "tail") && /^-\d+$/.test(args[0] ?? "")) rest = args.slice(1);
    else if (prog === "head" || prog === "tail") rest = args;
    else return null;
    if (!rest.length || rest.some((a) => a.startsWith("-"))) return null;
    files.push(...rest);
  }
  return files.length ? files : null;
}
