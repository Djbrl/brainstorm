// Reading a shell command's text: simple commands as words (quotes removed, escapes resolved, expansions marked
// unknown), their redirections and heredocs, ( ) kept so `cd` inside them stays inside; and a command's words as
// options and operands (parseArgs). Nothing is run. POSIX shells only.
import { config } from "../core/config";
import { isAbsolute, resolve } from "node:path";

// ───────────────────────────── paths ─────────────────────────────

export const home = () => config.home;

/** An absolute path for text from the command or a script; undefined when it can't be known (or isn't a real file). */
export function absPath(text: string | undefined, dir: string | undefined): string | undefined {
  if (!text) return undefined;
  if (text === "~" || text.startsWith("~/")) {
    const h = home();
    if (!h) return undefined;
    text = h + text.slice(1);
  }
  if (!isAbsolute(text) && !dir) return undefined;
  const p = resolve(dir ?? "/", text);
  return p.startsWith("/dev/") ? undefined : p; // /dev/null, /dev/stderr, /dev/fd/3: not files of the project
}

// ───────────────────────────── shell: reading the text ─────────────────────────────

export type Word = { text: string; dynamic: boolean; quoted: boolean };
type Redir = { writes: boolean; target: Word; fd: string };
type Heredoc = { delim: string; strip: boolean; body: string };
export type Cmd = { words: Word[]; redirs: Redir[]; heredocs: Heredoc[]; hereString?: Word };
type Seg = { cmd: Cmd } | { paren: "(" | ")" };

export const word = (text: string, dynamic = false, quoted = false): Word => ({ text, dynamic, quoted });
const newCmd = (): Cmd => ({ words: [], redirs: [], heredocs: [] });

/** Index just after the `)` that closes the `(` at `i` (quotes inside are skipped). */
function skipParens(s: string, i: number): number {
  let depth = 0;
  for (; i < s.length; i++) {
    const c = s[i];
    if (c === "\\") i++;
    else if (c === "'" || c === '"') { const e = s.indexOf(c, i + 1); if (e < 0) return s.length; i = e; }
    else if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return i + 1;
  }
  return s.length;
}

/** What `$…` or a backtick at `i` stands for: $HOME is known, anything else (variables, substitutions) is not. */
function expansion(s: string, i: number): { text: string; dynamic: boolean; end: number } {
  const unknown = (end: number) => ({ text: "", dynamic: true, end });
  if (s[i] === "`") {
    let j = i + 1;
    while (j < s.length && s[j] !== "`") j += s[j] === "\\" ? 2 : 1;
    return unknown(j + 1);
  }
  const n = s[i + 1];
  if (n === "(") return unknown(skipParens(s, i + 1));
  if (n === "{") {
    const e = s.indexOf("}", i);
    const end = e < 0 ? s.length : e + 1;
    const h = home();
    return s.slice(i + 2, e < 0 ? s.length : e) === "HOME" && h ? { text: h, dynamic: false, end } : unknown(end);
  }
  const m = /[A-Za-z_]\w*/y;
  m.lastIndex = i + 1;
  const name = m.exec(s)?.[0];
  if (name) {
    const h = home();
    return name === "HOME" && h ? { text: h, dynamic: false, end: m.lastIndex } : unknown(m.lastIndex);
  }
  if (n && "0123456789@*#?!$-".includes(n)) return unknown(i + 2);
  return { text: "$", dynamic: false, end: i + 1 };
}

const META = " \t\r\n;&|()<>";

/** One shell word from `start`: quotes removed, escapes resolved, expansions marked unknown. */
function readWord(s: string, start: number): { w: Word; end: number } {
  let i = start, text = "", dynamic = false, quoted = false, bare = "";
  while (i < s.length && !META.includes(s[i])) {
    const c = s[i];
    if (c === "\\") {
      if (s[i + 1] !== "\n") { text += s[i + 1] ?? ""; quoted = true; }
      i += 2;
    } else if (c === "'") {
      const e = s.indexOf("'", i + 1), stop = e < 0 ? s.length : e;
      text += s.slice(i + 1, stop); quoted = true; i = stop + 1;
    } else if (c === '"') {
      quoted = true; i++;
      while (i < s.length && s[i] !== '"') {
        const d = s[i];
        if (d === "\\" && i + 1 < s.length) {
          const n = s[i + 1];
          if ('"\\$`'.includes(n)) text += n; else if (n !== "\n") text += d + n;
          i += 2;
        } else if (d === "$" || d === "`") {
          const x = expansion(s, i);
          text += x.text; dynamic ||= x.dynamic; i = x.end;
        } else { text += d; i++; }
      }
      i++;
    } else if (c === "$" && s[i + 1] === "'") { // $'a\nb': escapes inside single quotes
      quoted = true; i += 2;
      while (i < s.length && s[i] !== "'") {
        if (s[i] === "\\") { const n = s[i + 1]; text += n === "n" ? "\n" : n === "t" ? "\t" : n; i += 2; } else text += s[i++];
      }
      i++;
    } else if (c === "$" && s[i + 1] === '"') {
      i++;
    } else if (c === "$" || c === "`") {
      const x = expansion(s, i);
      text += x.text; dynamic ||= x.dynamic; i = x.end;
    } else if (c === "~" && i === start && (i + 1 >= s.length || "/ \t\r\n;&|()<>".includes(s[i + 1]))) {
      const h = home();
      if (h) text += h; else dynamic = true;
      i++;
    } else {
      if (c === "*" || c === "?" || c === "[") dynamic = true; // a glob: which files is not known
      text += c; bare += c; i++;
    }
  }
  if (hasBraceList(bare)) dynamic = true; // a{,.bak}: brace expansion
  return { w: word(text, dynamic, quoted), end: i };
}

const REDIRECT = /(\d*)(&>>|&>|>>|>\||>&|>|<<<|<<-|<<|<&|<>|<)/y;

/** The command text as simple commands, in order, with ( and ) marked so `cd` inside them stays inside. */
export function parseShell(s: string): Seg[] {
  const segs: Seg[] = [];
  let cur = newCmd();
  const pending: Heredoc[] = [];
  let expect: { kind: "redir"; writes: boolean; amp: boolean; fd: string } | { kind: "heredoc"; strip: boolean } | { kind: "herestring" } | { kind: "skip" } | null = null;
  const flush = () => {
    if (cur.words.length || cur.redirs.length || cur.heredocs.length) segs.push({ cmd: cur });
    cur = newCmd();
    expect = null;
  };
  const take = (w: Word) => {
    const e = expect;
    expect = null;
    if (!e) cur.words.push(w);
    else if (e.kind === "redir") {
      const toFd = e.amp && /^(\d+|-)$/.test(w.text); // 2>&1, >&2, >&-
      if (!toFd) cur.redirs.push({ writes: e.writes, target: w, fd: e.fd });
    } else if (e.kind === "heredoc") {
      const h = { delim: w.text, strip: e.strip, body: "" };
      cur.heredocs.push(h); pending.push(h);
    } else if (e.kind === "herestring") cur.hereString = w;
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "\n") {
      flush(); i++;
      for (const h of pending) { // heredoc bodies start on the line after the one that named them
        const lines: string[] = [];
        while (i < s.length) {
          let e = s.indexOf("\n", i);
          if (e < 0) e = s.length;
          const line = s.slice(i, e).replace(/\r$/, "");
          i = Math.min(s.length, e + 1);
          if ((h.strip ? line.replace(/^\t+/, "") : line) === h.delim) break;
          lines.push(line);
        }
        h.body = lines.join("\n");
      }
      pending.length = 0;
    } else if (c === " " || c === "\t" || c === "\r") i++;
    else if (c === "\\" && s[i + 1] === "\n") i += 2;
    else if (c === "#") { while (i < s.length && s[i] !== "\n") i++; }
    else if (s.startsWith("&&", i) || s.startsWith("||", i)) { flush(); i += 2; }
    else if (c === ";" || c === "|") { flush(); i += s.startsWith("|&", i) ? 2 : 1; }
    else if (c === "(" || c === ")") { flush(); segs.push({ paren: c }); i++; }
    else {
      REDIRECT.lastIndex = i;
      const m = REDIRECT.exec(s);
      if (m) {
        i = REDIRECT.lastIndex;
        const op = m[2];
        if ((op === ">" || op === "<") && s[i] === "(") { take(word("", true)); i = skipParens(s, i); continue; } // process substitution
        const fd = m[1] || (op[0] === "&" ? "all" : op[0] === ">" ? "1" : "0");
        if (op === "<<<") expect = { kind: "herestring" };
        else if (op === "<<" || op === "<<-") expect = { kind: "heredoc", strip: op === "<<-" };
        else if (op === "<") expect = { kind: "redir", writes: false, amp: false, fd };   // a file read on stdin (commandReads)
        else if (op[0] === "<") expect = { kind: "skip" };
        else expect = { kind: "redir", writes: true, amp: op === ">&", fd };
      } else if (c === "&") { flush(); i++; }
      else if (!cur.words.length && !expect && s.startsWith("[[", i) && /\s/.test(s[i + 2] ?? "")) {
        // [[ a > b ]]: a test, whose < and > compare, not redirect. Its words are not files.
        const e = s.indexOf("]]", i + 2);
        if (e < 0) { const r = readWord(s, i); take(r.w); i = r.end; }
        else { take(word("[[", false, true)); i = e + 2; }
      }
      else { const r = readWord(s, i); take(r.w); i = r.end; }
    }
  }
  flush();
  return segs;
}

/** A `{` then a `,` then a `}` with no `}` in between (a{,.bak}): one pass; the regex for it, /\{[^}]*,[^}]*\}/, is quadratic on `{{{{`. */
function hasBraceList(s: string): boolean {
  let open = false, comma = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "{") open = true;
    else if (c === "," && open) comma = true;
    else if (c === "}") { if (open && comma) return true; open = comma = false; }
  }
  return false;
}

// ───────────────────────────── a command's options ─────────────────────────────

export type Parsed = {
  operands: Word[];
  /** The operands after `--`. */
  dashed: Word[];
  flags: string[];
  vals: Map<string, Word>;
  /** Every option in order, with its value if it took one (an option given twice: `git -C a -C b`). */
  opts: { name: string; value?: Word }[];
};

/** How a command's options read. */
export type ArgSpec = {
  /** Options that take the next word as their value (or `--name=value`). */
  values?: readonly string[];
  /** Short options read letter by letter (`-pi`, `-ne 'p'`), by what each letter does. "value": the rest of the word
   * is its value, or else the next word; "rest": the rest of the word is its value (never the next word); "suffix":
   * the rest of the word, or else an empty quoted next word (`sed -i ''` on BSD). A letter that isn't listed is an
   * option of its own and the next letter is read; a listed one ends the word. */
  letters?: Record<string, "value" | "rest" | "suffix">;
  /** Options end at the first operand: every word after it is an operand (perl, git, sudo). */
  stopAtOperand?: boolean;
  /** Every word that starts with `-` is an option, `-` and `--` too (wrappers: `env - cmd`, and git before its
   * subcommand). */
  dashWordsAreOptions?: boolean;
};

/** Splits a command's arguments into options and operands. A plain list is the options that take a value. */
export function parseArgs(args: Word[], spec: readonly string[] | ArgSpec = []): Parsed {
  const { values = [], letters, stopAtOperand = false, dashWordsAreOptions = false }: ArgSpec = isSpec(spec) ? spec : { values: spec };
  const r: Parsed = { operands: [], dashed: [], flags: [], vals: new Map(), opts: [] };
  for (let k = 0; k < args.length; k++) {
    const w = args[k], t = w.text;
    if (t === "--" && !dashWordsAreOptions) { r.dashed = args.slice(k + 1); r.operands.push(...r.dashed); break; }
    const option = dashWordsAreOptions ? t.startsWith("-") : t.length > 1 && t[0] === "-";
    if (!option) {
      if (stopAtOperand) { r.operands.push(...args.slice(k)); break; }
      r.operands.push(w);
      continue;
    }
    if (letters && t.length > 1 && t[1] !== "-") { k = readLetters(args, k, letters, r); continue; }
    const eq = t.indexOf("=");
    if (t.startsWith("--") && eq > 0) {
      const name = t.slice(0, eq), value = word(t.slice(eq + 1), w.dynamic, w.quoted);
      r.vals.set(name, value);
      r.opts.push({ name, value });
    } else {
      r.flags.push(t);
      if (values.includes(t) && k + 1 < args.length) { r.vals.set(t, args[++k]); r.opts.push({ name: t, value: args[k] }); }
      else r.opts.push({ name: t });
    }
  }
  return r;
}

const isSpec = (s: readonly string[] | ArgSpec): s is ArgSpec => !Array.isArray(s);

/** A word of short options, letter by letter (see ArgSpec.letters); returns the index of the last word it used. */
function readLetters(args: Word[], k: number, letters: NonNullable<ArgSpec["letters"]>, r: Parsed): number {
  const w = args[k], t = w.text;
  for (let j = 1; j < t.length; j++) {
    const name = "-" + t[j], how = letters[t[j]];
    r.flags.push(name);
    if (!how) { r.opts.push({ name }); continue; }
    const rest = t.slice(j + 1), next = args[k + 1];
    let value: Word | undefined;
    if (rest || how === "rest") value = word(rest, w.dynamic, w.quoted);
    else if (how === "value" && next) { value = next; k++; }
    else if (how === "suffix" && next?.quoted && next.text === "") { value = next; k++; }
    if (value) r.vals.set(name, value);
    r.opts.push({ name, value });
    break;
  }
  return k;
}

// ───────────────────────────── for readers of a command's program ─────────────────────────────

/**
 * The simple commands of a shell text as lists of words, quotes removed, in order (`;`, `&&`, `||`, pipes and newlines
 * separate them; heredoc bodies, comments and redirections are left out; an expansion ($X, $(…)) is an empty word).
 * For readers of a command's program and flags (cowork/classify.ts). Never throws.
 */
export function shellArgv(command: string): string[][] {
  try {
    const out: string[][] = [];
    for (const seg of parseShell(command)) if ("cmd" in seg && seg.cmd.words.length) out.push(seg.cmd.words.map((w) => w.text));
    return out;
  } catch {
    return [];
  }
}
