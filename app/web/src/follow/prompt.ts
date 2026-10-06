// A prompt's text, split into what the person typed and what Claude Code or its host put around it. Claude Code
// wraps context in tags inside the user's turn (<system-reminder>, <command-name>, <local-command-stdout>,
// <artifact-view-context artifact="…">, <ide_opened_file>, <pasted_content id="…">, <task-notification>…): each one
// becomes a block with a plain name, so the step panel can show it as a small chip and labels can leave it out.
//
// A block is a lowercase tag with optional attributes, opening a line (or right after another block) and closed
// further on. Tags we know are always blocks; others count only when they look machine-made (a dash or an underscore
// in the name, like `user-prompt-submit-hook`), and never when they're HTML: a person who pastes `<div>` or writes
// `<context>…</context>` keeps their words. Nothing inside ``` fences is read.

export type Block = {
  tag: string;
  attrs: Record<string, string>;
  /** What's between the tags (for a grouped command: its output). */
  body: string;
  /** Plain words for the chip: "Artifact view", "Command: /compact", "Pasted text · 12 lines". */
  name: string;
};
export type Part = { t: "text"; text: string } | { t: "paste"; block: Block };
export type Prompt = {
  /** The person's words and their pastes, in order (blocks Claude Code added are left out). */
  parts: Part[];
  /** What Claude Code or its host added, in order. */
  blocks: Block[];
  /** The person's words on one line's worth of text: no blocks; a paste only when nothing was typed around it. */
  words: string;
  /** `words`, or a block's name when the prompt is only blocks. */
  label: string;
};

const KNOWN = new Set([
  "artifact-view-context", "system-reminder", "command-name", "command-message", "command-args", "command-contents",
  "local-command-stdout", "local-command-stderr", "local-command-caveat", "bash-input", "bash-stdout", "bash-stderr",
  "ide_selection", "ide_opened_file", "ide_diagnostics", "user-prompt-submit-hook", "pasted_content", "task-notification",
  "cross-session-message", "agent-message", "scheduled-task", "user-memory-input",
]);
/** Element names a person might paste as markup; custom elements (`my-widget`) are rare enough in prompts to read as blocks. */
const HTML = new Set("a abbr article aside b body br button code div em footer form h1 h2 h3 h4 h5 h6 head header html i img input label li main nav ol option p pre script section select small span strong style svg table tbody td template textarea th thead tr ul".split(" "));

const OPEN = /<([a-z][a-z0-9]*(?:[-_][a-z0-9]+)*)((?:\s+[\w:.-]+(?:=(?:"[^"]*"|'[^']*'|[^\s>"']+))?)*)\s*>/g;
const ATTR = /([\w:.-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g;

const isBlockTag = (tag: string) => KNOWN.has(tag) || (/[-_]/.test(tag) && !HTML.has(tag));

const basename = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const oneLine = (s: string, max = 90) => { const l = s.replace(/\s+/g, " ").trim(); return l.length > max ? `${l.slice(0, max - 1).trimEnd()}…` : l; };
const lines = (s: string) => s.trim().split("\n").length;

/** The child tags of a block (`<summary>…</summary>` inside a task notification), first one per name. */
export function childTags(body: string): Map<string, string> {
  const out = new Map<string, string>();
  for (let m, re = /<([a-z][\w-]*)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g; (m = re.exec(body)); ) if (!out.has(m[1])) out.set(m[1], m[2]);
  return out;
}

function nameOf(tag: string, attrs: Record<string, string>, body: string): string {
  const b = body.trim();
  switch (tag) {
    case "artifact-view-context": return "Artifact view";
    case "system-reminder": case "local-command-caveat": return "Note from Claude Code";
    case "local-command-stdout": return b && b.length <= 40 && !b.includes("\n") ? `Command output: ${b}` : "Command output";
    case "local-command-stderr": return "Command error";
    case "ide_opened_file": { const f = /opened the file (\S+)/.exec(b)?.[1]; return f ? `Opened in your editor: ${basename(f)}` : "Opened in your editor"; }
    case "ide_selection": { const f = /\bfrom (\S+?):?\s/.exec(b)?.[1]; return f ? `Selected in your editor: ${basename(f)}` : "Selected in your editor"; }
    case "ide_diagnostics": return "Problems your editor found";
    case "user-prompt-submit-hook": return "Added by a hook";
    case "pasted_content": { const n = lines(b); return n > 1 ? `Pasted text · ${n} lines` : "Pasted text"; }
    case "task-notification": { const s = childTags(b).get("summary"); return s ? oneLine(s) : "A background task finished"; }
    case "cross-session-message": return `Message from ${attrs["from-name"] || "another session"}`;
    case "agent-message": return /Subagent hand-back/i.test(b) ? "A subagent reported back" : "Message from an agent";
    case "scheduled-task": return attrs.name ? `Scheduled task: ${attrs.name}` : "Scheduled task";
    case "user-memory-input": return "Saved to memory";
    default: return capital(tag.replace(/[-_]+/g, " "));
  }
}

const block = (tag: string, attrs: Record<string, string>, body: string, name = nameOf(tag, attrs, body)): Block => ({ tag, attrs, body, name });

type Raw = { t: "text"; text: string } | { t: "block"; tag: string; attrs: Record<string, string>; body: string };

function scan(text: string): Raw[] {
  // ``` fences: nothing inside them is a block.
  const fences: [number, number][] = [];
  for (let m, re = /^[ \t]*```[\s\S]*?^[ \t]*```/gm; (m = re.exec(text)); ) fences.push([m.index, m.index + m[0].length]);
  const fenced = (i: number) => fences.some(([a, b]) => i >= a && i < b);

  const out: Raw[] = [];
  let pos = 0;
  OPEN.lastIndex = 0;
  for (let m; (m = OPEN.exec(text)); ) {
    const [whole, tag, attrText] = m;
    const at = m.index;
    if (!isBlockTag(tag) || fenced(at)) continue;
    const lineStart = text.lastIndexOf("\n", at - 1) + 1;
    if (text.slice(lineStart, at).trim() && text.slice(pos, at).trim()) continue; // mid-sentence: someone writing about a tag
    const closer = new RegExp(`</${tag}(?:\\s[^>]*)?>`, "g"); // Claude Code writes </pasted_content id="…"> too
    closer.lastIndex = at + whole.length;
    const found = closer.exec(text);
    const close = found ? found.index : -1;
    let end: number;
    if (!found) {
      if (!KNOWN.has(tag)) continue;
      end = text.length; // a log cut short
    } else {
      end = close + found[0].length;
      if (!KNOWN.has(tag) && !/^[ \t]*(\n|$|<)/.test(text.slice(end))) continue;
    }
    const attrs: Record<string, string> = {};
    for (let a; (a = ATTR.exec(attrText)); ) attrs[a[1]] = a[2] ?? a[3] ?? a[4] ?? "";
    ATTR.lastIndex = 0;
    if (at > pos) out.push({ t: "text", text: text.slice(pos, at) });
    out.push({ t: "block", tag, attrs, body: text.slice(at + whole.length, close === -1 ? text.length : close) });
    pos = end;
    OPEN.lastIndex = end;
  }
  if (pos < text.length) out.push({ t: "text", text: text.slice(pos) });
  return out;
}

const QUIET = new Set(["note", "system-reminder", "local-command-caveat"]);
const PREAMBLE = /\s*Another Claude session sent a message:\s*$/;
/** Notes Claude Code puts in the person's turn without a tag, each running to the next block or the end. */
const UNTAGGED: [RegExp, string, string][] = [
  [/^\s*Codebase and user instructions are shown below\b/, "claude-md", "Project instructions"], // the project's CLAUDE.md, after the folder changes
  [/^\s*This came from another Claude session\b/, "note", "Note from Claude Code"], // after a message from another session
  [/^\s*\[SYSTEM NOTIFICATION\b/, "note", "Note from Claude Code"], // before a background task's notification
  [/^\s*Base directory for this skill:/, "skill", "Skill instructions"], // a skill's text, loaded when it's used
];
const IMAGE_NOTE = /^\[Image[:#][^\]]*\]\s*$/gm;

function build(text: string): Prompt {
  const raw = scan(text);
  const parts: Part[] = [];
  const blocks: Block[] = [];
  const words: string[] = [];
  const pastes: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i];
    if (r.t === "text") {
      let t = r.text;
      const next = raw[i + 1];
      if (next?.t === "block" && (next.tag === "cross-session-message" || next.tag === "agent-message")) t = t.replace(PREAMBLE, "");
      const note = UNTAGGED.find(([re]) => re.test(t));
      if (note) { blocks.push(block(note[1], {}, t.trim(), note[2])); continue; }
      if (t.trim()) { parts.push({ t: "text", text: t }); words.push(t); }
      continue;
    }
    if (r.tag === "pasted_content") {
      const b = block(r.tag, r.attrs, r.body.replace(/^\n+|\n+$/g, ""));
      parts.push({ t: "paste", block: b });
      pastes.push(b.body);
      continue;
    }
    // A slash command arrives as three tags (name, message, args): one chip.
    if (r.tag === "command-name" || r.tag === "command-message" || r.tag === "command-args") {
      const group = new Map<string, string>();
      let j = i;
      for (; j < raw.length; j++) {
        const x = raw[j];
        if (x.t === "text" && !x.text.trim()) continue;
        if (x.t !== "block" || !x.tag.startsWith("command-") || group.has(x.tag)) break;
        group.set(x.tag, x.body.trim());
      }
      i = j - 1;
      const name = group.get("command-name") || (group.get("command-message") ? `/${group.get("command-message")}` : "");
      const args = group.get("command-args") ?? "";
      blocks.push(block("command", {}, args, name ? oneLine(`Command: ${name}${args ? ` ${args}` : ""}`) : "Command"));
      continue;
    }
    // A command run with ! in Claude Code: its input, then what it printed.
    if (r.tag === "bash-input") {
      const cmd = r.body.trim();
      let out = "";
      while (raw[i + 1]?.t === "block" && /^bash-std(out|err)$/.test((raw[i + 1] as { tag: string }).tag)) out += (raw[++i] as { body: string }).body;
      blocks.push(block("bash", { command: cmd }, out.trim(), oneLine(`You ran: ${cmd}`)));
      words.push(`$ ${cmd}`); // a command you ran is something you did: it names its chapter
      continue;
    }
    if (r.tag === "bash-stdout" || r.tag === "bash-stderr") { if (r.body.trim()) blocks.push(block(r.tag, r.attrs, r.body, "Command output")); continue; }
    blocks.push(block(r.tag, r.attrs, r.body));
  }
  const typed = words.join(" ").replace(IMAGE_NOTE, "").trim();
  const w = typed || pastes.join("\n").trim();
  // Only blocks: name the prompt for the one that says most (a task's summary over the note Claude Code put before it).
  const lead = blocks.find((x) => !QUIET.has(x.tag)) ?? blocks[0];
  return { parts, blocks, words: w, label: w || lead?.name || "" };
}

const seen = new Map<string, Prompt>();

/** A prompt's parts, worked out once per text (labels ask for it on every render). */
export function parsePrompt(text = ""): Prompt {
  let p = seen.get(text);
  if (!p) {
    if (seen.size > 4000) seen.clear();
    seen.set(text, (p = build(text)));
  }
  return p;
}
