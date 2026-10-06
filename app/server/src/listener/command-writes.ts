// Owner: A. The files a shell command writes, creates or deletes, found by reading the command text (nothing is run).
// Agents change files through the shell as often as through their edit tools: `sed -i`, `cat > f <<EOF`, `mv`,
// `python3 - <<'PY' … Path('app.vue').write_text(…)`, Codex's `apply_patch`. This is the static half: what the command
// says it writes. Only what can be known from the text is returned: a path built from a variable, a glob or a command
// substitution is left out, and so is anything a script computes at run time. Never throws.
import { basename, isAbsolute, resolve } from "node:path";

export type CommandWrite = {
  path: string;
  kind: "write" | "delete";
  /** For a move: the old path (the old path itself is also listed as deleted). */
  from?: string;
};

/**
 * Files a shell command writes or deletes, as absolute paths, deduplicated (the last kind wins), in order of first
 * appearance. `cwd` is the folder it ran in: relative paths resolve against it and `cd dir &&` moves it. Unknown → [].
 * Paths are not looked up on disk: `cp a dir` (no trailing slash) is read as a copy to a file called `dir`.
 */
export function commandWrites(command: string, cwd: string): CommandWrite[] {
  try {
    const out = new Out();
    runShell(command, resolve(cwd), out, 0);
    return out.list();
  } catch {
    return [];
  }
}

class Out {
  private m = new Map<string, CommandWrite>();
  add(w: CommandWrite) { this.m.set(w.path, w); } // an existing path keeps its place and takes the new kind
  list() { return [...this.m.values()]; }
}

// ───────────────────────────── paths ─────────────────────────────

const home = () => process.env.HOME || undefined;

/** An absolute path for text from the command or a script; undefined when it can't be known (or isn't a real file). */
function absPath(text: string | undefined, dir: string | undefined): string | undefined {
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

type Word = { text: string; dynamic: boolean; quoted: boolean };
type Redir = { writes: boolean; target: Word; fd: string };
type Heredoc = { delim: string; strip: boolean; body: string };
type Cmd = { words: Word[]; redirs: Redir[]; heredocs: Heredoc[]; hereString?: Word };
type Seg = { cmd: Cmd } | { paren: "(" | ")" };

const word = (text: string, dynamic = false, quoted = false): Word => ({ text, dynamic, quoted });
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
  if (/\{[^}]*,[^}]*\}/.test(bare)) dynamic = true; // a{,.bak}: brace expansion
  return { w: word(text, dynamic, quoted), end: i };
}

const REDIRECT = /(\d*)(&>>|&>|>>|>\||>&|>|<<<|<<-|<<|<&|<>|<)/y;

/** The command text as simple commands, in order, with ( and ) marked so `cd` inside them stays inside. */
function parseShell(s: string): Seg[] {
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
        else if (op[0] === "<") expect = { kind: "skip" };
        else expect = { kind: "redir", writes: true, amp: op === ">&", fd };
      } else if (c === "&") { flush(); i++; }
      else { const r = readWord(s, i); take(r.w); i = r.end; }
    }
  }
  flush();
  return segs;
}

// ───────────────────────────── shell: what each command does ─────────────────────────────

const MAX_DEPTH = 3; // bash -c "bash -c '…'" and so on
const RESERVED = new Set(["if", "then", "else", "elif", "do", "while", "until", "{", "}", "!"]);
const WRAPPERS = new Set(["sudo", "env", "command", "nohup", "time", "exec", "nice", "builtin"]);
const ASSIGNMENT = /^[A-Za-z_]\w*=/;

function runShell(src: string, cwd: string | undefined, out: Out, depth: number): void {
  let dir: string | undefined = cwd;
  const saved: (string | undefined)[] = [];
  for (const seg of parseShell(src)) {
    if ("paren" in seg) {
      if (seg.paren === "(") saved.push(dir); else if (saved.length) dir = saved.pop();
    } else dir = runCommand(seg.cmd, dir, out, depth);
  }
}

/** Resolves a command word. Dynamic words ($X, globs, $(…)) are not known. */
function pathOf(w: Word | undefined, dir: string | undefined): string | undefined {
  return w && !w.dynamic ? absPath(w.text, dir) : undefined;
}

const add = (out: Out, p: string | undefined, kind: "write" | "delete", from?: string) => {
  if (p) out.add(from ? { path: p, kind, from } : { path: p, kind });
};

type Parsed = { operands: Word[]; dashed: Word[]; flags: string[]; vals: Map<string, Word> };

/** Splits a command's arguments into flags and operands. `valueFlags` take the next word (or `--flag=value`). */
function parseArgs(args: Word[], valueFlags: string[] = []): Parsed {
  const r: Parsed = { operands: [], dashed: [], flags: [], vals: new Map() };
  for (let k = 0; k < args.length; k++) {
    const w = args[k], t = w.text;
    if (t === "--") { r.dashed = args.slice(k + 1); r.operands.push(...r.dashed); break; }
    if (t.length > 1 && t[0] === "-") {
      const eq = t.indexOf("=");
      if (t.startsWith("--") && eq > 0) r.vals.set(t.slice(0, eq), word(t.slice(eq + 1), w.dynamic, w.quoted));
      else {
        r.flags.push(t);
        if (valueFlags.includes(t) && k + 1 < args.length) r.vals.set(t, args[++k]);
      }
    } else r.operands.push(w);
  }
  return r;
}

/** The commands that run another program's text: the shells, and the languages whose scripts are looked into. */
function langOf(name: string): "sh" | Lang | undefined {
  if (/^(bash|sh|zsh|dash|ksh)$/.test(name)) return "sh";
  if (/^python[\d.]*$/.test(name)) return "py";
  if (/^(node|nodejs|bun|deno)$/.test(name)) return "js";
  if (name === "ruby") return "rb";
  if (name === "perl") return "pl";
  return undefined;
}

function runCommand(cmd: Cmd, dir: string | undefined, out: Out, depth: number): string | undefined {
  for (const r of cmd.redirs) if (r.writes) add(out, pathOf(r.target, dir), "write");

  const words = cmd.words.slice();
  for (;;) {
    const w = words[0];
    if (!w) break;
    if (!w.quoted && (RESERVED.has(w.text) || ASSIGNMENT.test(w.text))) words.shift();
    else if (WRAPPERS.has(basename(w.text))) {
      words.shift();
      while (words.length > 1 && words[0].text.startsWith("-")) words.shift();
    } else break;
  }
  if (!words.length) return dir;

  const name = basename(words[0].text);
  const args = words.slice(1);

  switch (name) {
    case "cd": case "pushd": {
      const t = parseArgs(args).operands[0];
      if (t?.text === "-") return undefined; // the folder before: not known
      return t ? pathOf(t, dir) : name === "cd" && !args.length ? absPath("~", dir) : dir;
    }
    case "tee":
      for (const w of parseArgs(args).operands) if (w.text !== "-") add(out, pathOf(w, dir), "write");
      return dir;
    case "sed":
      for (const w of sedFiles(args)) add(out, pathOf(w, dir), "write");
      return dir;
    case "mv": moveOrCopy(args, dir, out, true); return dir;
    case "cp": moveOrCopy(args, dir, out, false); return dir;
    case "install":
      if (!args.some((a) => a.text === "-d")) moveOrCopy(args, dir, out, false, ["-m", "-o", "-g", "-S", "-t"]);
      return dir;
    case "touch":
      for (const w of parseArgs(args, ["-t", "-d", "-r"]).operands) add(out, pathOf(w, dir), "write");
      return dir;
    case "rm":
      for (const w of parseArgs(args).operands) add(out, pathOf(w, dir), "delete");
      return dir;
    case "truncate":
      for (const w of parseArgs(args, ["-s", "-r"]).operands) add(out, pathOf(w, dir), "write");
      return dir;
    case "dd":
      for (const w of args) if (w.text.startsWith("of=")) add(out, pathOf(word(w.text.slice(3), w.dynamic), dir), "write");
      return dir;
    case "git": gitWrites(args, dir, out); return dir;
    case "apply_patch": case "applypatch": {
      const text = cmd.heredocs.map((h) => h.body).join("\n") || args.find((a) => a.text.includes("*** Begin Patch"))?.text;
      if (text) patchWrites(text, dir, out);
      return dir;
    }
  }

  const lang = langOf(name);
  if (lang) runProgram(lang, cmd, args, dir, out, depth);
  return dir;
}

/** `sed -i` files, in the GNU forms (-i, -i.bak, --in-place) and the BSD one (-i ''); none when it isn't in place. */
function sedFiles(args: Word[]): Word[] {
  let inPlace = false, hasScript = false;
  const operands: Word[] = [];
  for (let k = 0; k < args.length; k++) {
    const t = args[k].text;
    if (t === "--") { operands.push(...args.slice(k + 1)); break; }
    if (t.startsWith("--")) {
      if (/^--in-place(=|$)/.test(t)) inPlace = true;
      else if (/^--(expression|file)(=|$)/.test(t)) { hasScript = true; if (!t.includes("=")) k++; }
    } else if (t.length > 1 && t[0] === "-") {
      for (let j = 1; j < t.length; j++) {
        if (t[j] === "i") {
          inPlace = true;
          const next = args[k + 1];
          if (j === t.length - 1 && next?.quoted && next.text === "") k++; // BSD: -i '' (no backup)
          break;
        }
        if (t[j] === "e" || t[j] === "f") { hasScript = true; if (j === t.length - 1) k++; break; }
      }
    } else operands.push(args[k]);
  }
  if (!inPlace) return [];
  return hasScript ? operands : operands.slice(1); // else the first operand is the script
}

/** mv / cp / install: the destination is written (a directory gets the file's own name); for mv the source is deleted. */
function moveOrCopy(args: Word[], dir: string | undefined, out: Out, move: boolean, valueFlags: string[] = []) {
  const p = parseArgs(args, ["-t", "--target-directory", "-S", "--suffix", ...valueFlags]);
  const dirFlag = p.vals.get("-t") ?? p.vals.get("--target-directory");
  let sources = p.operands, target = dirFlag;
  if (!target) {
    if (sources.length < 2) return;
    target = sources[sources.length - 1];
    sources = sources.slice(0, -1);
  }
  const into = !!dirFlag || sources.length > 1 || target.text.endsWith("/");
  const t = pathOf(target, dir);
  for (const src of sources) {
    if (into && src.dynamic) continue; // its name is part of the destination
    const from = pathOf(src, dir);
    const dest = into ? (t ? absPath(basename(src.text), t) : undefined) : t;
    if (!dest || dest === from) continue;
    add(out, dest, "write", move ? from : undefined);
    if (move) add(out, from, "delete");
  }
}

function gitWrites(args: Word[], dir: string | undefined, out: Out) {
  let k = 0;
  for (; k < args.length; k++) { // git -C sub -c k=v …
    const t = args[k].text;
    if (t === "-C") { dir = pathOf(args[k + 1], dir); k++; }
    else if (t === "-c") k++;
    else if (!t.startsWith("-")) break;
  }
  const sub = args[k]?.text;
  const p = parseArgs(args.slice(k + 1), ["-s", "--source"]);
  const files = (ws: Word[]) => ws.filter((w) => w.text !== "." && !w.text.startsWith(":"));
  if (sub === "checkout") for (const w of files(p.dashed)) add(out, pathOf(w, dir), "write"); // only `-- files` is a file
  else if (sub === "restore") {
    const indexOnly = (p.flags.includes("--staged") || p.flags.includes("-S")) && !p.flags.includes("--worktree") && !p.flags.includes("-W");
    if (!indexOnly) for (const w of files(p.operands)) add(out, pathOf(w, dir), "write");
  } else if (sub === "rm") {
    if (!p.flags.includes("--cached")) for (const w of files(p.operands)) add(out, pathOf(w, dir), "delete");
  } else if (sub === "mv") moveOrCopy(args.slice(k + 1), dir, out, true);
}

/** Codex's patch format: Update/Add File write, Delete File deletes, Move to renames. */
function patchWrites(text: string, dir: string | undefined, out: Out) {
  let last: string | undefined;
  for (const line of text.split("\n")) {
    const f = /^\*\*\* (Update|Add|Delete) File: (.+?)\s*$/.exec(line);
    if (f) {
      last = absPath(f[2], dir);
      add(out, last, f[1] === "Delete" ? "delete" : "write");
      continue;
    }
    const mv = /^\*\*\* Move to: (.+?)\s*$/.exec(line);
    if (mv && last) {
      add(out, absPath(mv[1], dir), "write", last);
      add(out, last, "delete");
    }
  }
}

// ───────────────────────────── programs: shells and the languages' inline scripts ─────────────────────────────

/** The scripts a program is given on its command line (-c / -e), or on its input (a heredoc, a here-string). */
function runProgram(lang: "sh" | Lang, cmd: Cmd, args: Word[], dir: string | undefined, out: Out, depth: number) {
  const scripts: string[] = [];
  let inPlaceFiles: Word[] = [];
  if (lang === "pl" || lang === "rb") {
    const r = perlRubyArgs(args);
    scripts.push(...r.scripts);
    if (r.inPlace && r.scripts.length) inPlaceFiles = r.operands; // perl -pi -e 's/a/b/' files
  } else {
    for (let k = 0; k < args.length; k++) {
      const t = args[k].text;
      const takes = lang === "sh" ? /^-[a-zA-Z]*c[a-zA-Z]*$/.test(t)
        : lang === "py" ? t === "-c"
        : t === "-e" || t === "--eval" || t === "-p" || t === "--print" || t === "-pe";
      if (takes && args[k + 1]) { scripts.push(args[k + 1].text); k++; }
      else if (lang === "sh" && (t === "-o" || t === "+o")) k++;
      else if (lang === "js" && /^--eval=/.test(t)) scripts.push(t.slice(7));
      else if (lang === "sh" && !t.startsWith("-") && !scripts.length) break; // a script file
    }
  }
  if (!scripts.length) {
    // The program reads its script from the input, unless it was given a script file (python3 x.py <<EOF).
    const file = args.find((a) => !a.text.startsWith("-") || a.text === "-");
    if (!file || file.text === "-") {
      scripts.push(...cmd.heredocs.map((h) => h.body));
      if (cmd.hereString) scripts.push(cmd.hereString.text);
    }
  }
  for (const w of inPlaceFiles) add(out, pathOf(w, dir), "write");
  for (const s of scripts) {
    if (lang === "sh") { if (depth < MAX_DEPTH) runShell(s, dir, out, depth + 1); }
    else for (const f of scanScript(lang, s, dir)) out.add(f.w);
  }
}

/** perl / ruby command lines: -e scripts, whether -i (in place) is on, and the operands after the options. */
function perlRubyArgs(args: Word[]): { scripts: string[]; inPlace: boolean; operands: Word[] } {
  const r = { scripts: [] as string[], inPlace: false, operands: [] as Word[] };
  for (let k = 0; k < args.length; k++) {
    const t = args[k].text;
    if (t === "--") { r.operands.push(...args.slice(k + 1)); break; }
    if (t.length > 1 && t[0] === "-" && !t.startsWith("--")) {
      for (let j = 1; j < t.length; j++) {
        const ch = t[j];
        if (ch === "i") { r.inPlace = true; break; } // the rest is the backup suffix
        if (ch === "e" || ch === "E") { const rest = t.slice(j + 1); if (rest) r.scripts.push(rest); else if (args[k + 1]) r.scripts.push(args[++k].text); break; }
        if ("IMmrF0x".includes(ch)) { if (j === t.length - 1 && (ch === "I" || ch === "r")) k++; break; }
      }
    } else if (!t.startsWith("--")) {
      if (r.scripts.length) r.operands.push(...args.slice(k));
      break;
    }
  }
  return r;
}

// ───────────────────────────── inline scripts ─────────────────────────────
// Not a parser: the calls that write files are found by name, and their arguments are read only when they are
// literals, or variables assigned a literal earlier (`p = Path('app.vue')`), or path.join / Path(…) / os.path.join of those.

type Lang = "py" | "js" | "rb" | "pl";
type Val = string | undefined;
type Args = { pos: Val[]; kw: Record<string, Val> };
type Var = { name: string; at: number; value: Val };

const PASS_THROUGH = new Set(["resolve", "expanduser", "absolute", "as_posix", "toString"]); // `.resolve()` keeps the path

class Ev {
  i = 0;
  private depth = 0;
  private origin = 0;
  constructor(private s: string, private lang: Lang, private dir: string | undefined, private vars: Var[]) {}

  /** Evaluates the expression at `from`; `this.i` ends just after it. */
  eval(from: number): Val { this.i = from; this.origin = from; this.depth = 0; return this.expr(); }
  /** The same, on the text before `end` only (so a method call after it is not read as part of it). */
  evalBefore(from: number, end: number): Val {
    const sub = new Ev(this.s.slice(0, end), this.lang, this.dir, this.vars);
    const v = sub.eval(from);
    sub.ws(false);
    return sub.i === end ? v : undefined;
  }

  ws(newlines = this.depth > 0) {
    const re = newlines ? /\s*/y : /[ \t]*/y;
    re.lastIndex = this.i;
    re.exec(this.s);
    this.i = re.lastIndex;
  }

  /** The arguments of a call whose name ends at `at`: `(a, b)`, or in ruby and perl, `a, b` without brackets. */
  callArgs(at: number): Args | undefined {
    this.i = at; this.origin = at; this.depth = 0;
    this.ws(false);
    if (this.s[this.i] === "(") { this.i++; this.depth++; return this.args(); }
    if (this.lang !== "rb" && this.lang !== "pl") return undefined;
    const pos: Val[] = [];
    for (;;) {
      pos.push(this.expr());
      this.ws(false);
      if (this.s[this.i] !== ",") break;
      this.i++;
    }
    return { pos, kw: {} };
  }
  /** Arguments after the comma that follows a perl filehandle. */
  argsAfter(at: number): Args {
    this.i = at; this.origin = at; this.depth = 0;
    const pos: Val[] = [];
    for (;;) {
      pos.push(this.expr());
      this.ws(false);
      if (this.s[this.i] !== ",") break;
      this.i++;
    }
    return { pos, kw: {} };
  }

  private args(): Args {
    const pos: Val[] = [], kw: Record<string, Val> = {};
    for (;;) {
      this.ws();
      const c = this.s[this.i];
      if (c === undefined) break;
      if (c === ")") { this.i++; break; }
      if (c === ",") { this.i++; continue; }
      const before = this.i;
      let name: string | undefined;
      if (this.lang === "py") {
        const k = /([A-Za-z_]\w*)[ \t]*=(?!=)/y;
        k.lastIndex = this.i;
        const m = k.exec(this.s);
        if (m) { name = m[1]; this.i = k.lastIndex; }
      }
      const v = this.expr();
      this.skipArg();
      if (name) kw[name] = v; else pos.push(v);
      if (this.i === before) this.i++; // a stray ] or } that no argument owns
    }
    this.depth--;
    return { pos, kw };
  }

  /** Moves to the next top-level "," or ")" (not consumed). */
  private skipArg() {
    let d = 0;
    while (this.i < this.s.length) {
      const c = this.s[this.i];
      if (c === "'" || c === '"' || c === "`") { this.skipString(); continue; }
      if (c === "(" || c === "[" || c === "{") d++;
      else if (c === ")" || c === "]" || c === "}") { if (d === 0) return; d--; }
      else if (c === "," && d === 0) return;
      this.i++;
    }
  }

  private skipString() {
    const q = this.s[this.i];
    const triple = this.s.startsWith(q.repeat(3), this.i);
    this.i += triple ? 3 : 1;
    while (this.i < this.s.length) {
      if (this.s[this.i] === "\\") this.i += 2;
      else if (triple ? this.s.startsWith(q.repeat(3), this.i) : this.s[this.i] === q) { this.i += triple ? 3 : 1; return; }
      else this.i++;
    }
  }

  private expr(): Val {
    let v = this.term();
    for (;;) {
      this.ws(false);
      const c = this.s[this.i], n = this.s[this.i + 1];
      const op = c === "/" && this.lang === "py" ? "/" : c === "+" && n !== "=" ? "+" : c === "." && this.lang === "pl" && n === " " ? "." : "";
      if (!op) return v;
      this.i++;
      const r = this.term();
      v = v === undefined || r === undefined ? undefined : op === "/" ? joinPaths(v, r, true) : v + r;
    }
  }

  private term(): Val {
    this.ws();
    const s = this.s, c = s[this.i];
    if (c === undefined) return undefined;
    const str = this.string();
    if (str !== null) return this.postfix(str.value);
    if (c === "(") {
      this.i++; this.depth++;
      const v = this.expr();
      this.ws();
      this.depth--;
      if (s[this.i] === ")") { this.i++; return this.postfix(v); }
      return undefined;
    }
    if (/\d/.test(c)) { const m = /[\w.]+/y; m.lastIndex = this.i; m.exec(s); this.i = m.lastIndex; return undefined; }
    const id = /[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/y;
    id.lastIndex = this.i;
    const m = id.exec(s);
    if (!m) return undefined;
    this.i = id.lastIndex;
    const name = m[0];
    if (s[this.i] === "(") {
      this.i++; this.depth++;
      return this.postfix(this.callValue(name, this.args()));
    }
    return this.postfix(this.variable(name));
  }

  private variable(name: string): Val {
    if (name === "__dirname" && this.lang === "js") return this.dir;
    if (name.includes(".")) return undefined;
    for (let k = this.vars.length - 1; k >= 0; k--) if (this.vars[k].name === name && this.vars[k].at < this.origin) return this.vars[k].value;
    return undefined;
  }

  /** `.name` and `.name(…)` after a value: a few keep the path, the rest make it unknown. */
  private postfix(v: Val): Val {
    for (;;) {
      const m = /\.([A-Za-z_]\w*)/y;
      m.lastIndex = this.i;
      const r = this.s[this.i] === "." ? m.exec(this.s) : null;
      if (!r) return v;
      this.i = m.lastIndex;
      let call = false;
      if (this.s[this.i] === "(") { this.i++; this.depth++; this.args(); call = true; }
      if (!(call && PASS_THROUGH.has(r[1]))) v = undefined;
    }
  }

  /** A string literal at `this.i`: prefixes (r'', b'') and quotes read; null when there isn't one. */
  private string(): { value: Val } | null {
    const s = this.s;
    const m = (this.lang === "py" ? /([rRbBuUfF]{0,2})('''|"""|'|")/y : /()('''|"""|'|"|`)/y);
    m.lastIndex = this.i;
    const h = m.exec(s);
    if (!h || (h[2].length === 3 && this.lang !== "py")) return null;
    const prefix = h[1], q = h[2], raw = /r/i.test(prefix);
    const single = q === "'" && (this.lang === "rb" || this.lang === "pl");
    let i = m.lastIndex, value = "", known = true;
    while (i < s.length && !s.startsWith(q, i)) {
      const c = s[i];
      if (c === "\\" && i + 1 < s.length) {
        const n = s[i + 1];
        if (raw) value += c + n;
        else if (single) value += n === "\\" || n === "'" ? n : c + n;
        else value += n === "n" ? "\n" : n === "t" ? "\t" : n === "\n" ? "" : /[\\'"`$]/.test(n) ? n : c + n;
        i += 2;
        continue;
      }
      if (c === "{" && /f/i.test(prefix) && s[i + 1] !== "{") known = false; // an f-string with a value inside
      if (c === "$" && q === "`" && s[i + 1] === "{") known = false; // a JS template with ${…}
      if (c === "#" && s[i + 1] === "{" && this.lang === "rb" && q !== "'") known = false;
      if (this.lang === "pl" && !single && (c === "$" || c === "@") && /[\w{]/.test(s[i + 1] ?? "")) known = false;
      value += c;
      i++;
    }
    this.i = i + q.length;
    return { value: known ? value : undefined };
  }

  private callValue(name: string, a: Args): Val {
    const strings = a.pos.every((x) => x !== undefined) ? (a.pos as string[]) : undefined;
    if (/^(path\.)?(posix\.)?join$|^File\.join$/.test(name)) return strings?.reduce((x, y) => joinPaths(x, y, false));
    if (/^(path\.)?(posix\.)?resolve$|^os\.path\.join$|^(pathlib\.)?(Pure|Posix)?Path$|^Pathname(\.new)?$/.test(name)) {
      return strings?.length ? strings.reduce((x, y) => joinPaths(x, y, true)) : undefined;
    }
    if (/^(str|String|os\.fspath|os\.path\.(abspath|normpath|realpath|expanduser)|path\.normalize)$/.test(name)) return a.pos[0];
    if (name === "File.expand_path") return a.pos.length > 1 && strings ? joinPaths(strings[1], strings[0], true) : a.pos[0];
    if (/^(Path\.cwd|os\.getcwd|process\.cwd|Dir\.(pwd|getwd))$/.test(name)) return this.dir;
    if (/^(Path\.home|os\.homedir|Dir\.home)$/.test(name)) return home();
    return undefined;
  }
}

/** a joined with b; with `reset`, an absolute b replaces a (pathlib, path.resolve) instead of being appended. */
function joinPaths(a: string, b: string, reset: boolean): string {
  return reset && (b.startsWith("/") || b.startsWith("~")) ? b : a.replace(/\/+$/, "") + "/" + b;
}

type Op = "write" | "delete" | "deleteAll" | "move" | "copy" | "open";

const PY_CALLS: Record<string, Op> = {
  "open": "open", "io.open": "open", "codecs.open": "open", "gzip.open": "open", "bz2.open": "open", "lzma.open": "open",
  "os.remove": "delete", "os.unlink": "delete", "os.rmdir": "delete", "os.removedirs": "delete", "shutil.rmtree": "delete",
  "os.rename": "move", "os.replace": "move", "shutil.move": "move",
  "shutil.copy": "copy", "shutil.copy2": "copy", "shutil.copyfile": "copy", "shutil.copytree": "copy",
};
const RB_CALLS: Record<string, Op> = {
  "File.write": "write", "File.binwrite": "write", "IO.write": "write", "IO.binwrite": "write", "File.truncate": "write",
  "File.open": "open", "File.new": "open", "File.delete": "deleteAll", "File.unlink": "deleteAll", "File.rename": "move",
  "FileUtils.rm": "deleteAll", "FileUtils.rm_f": "deleteAll", "FileUtils.rm_r": "deleteAll", "FileUtils.rm_rf": "deleteAll",
  "FileUtils.remove": "deleteAll", "FileUtils.remove_file": "deleteAll", "FileUtils.remove_entry": "deleteAll",
  "FileUtils.mv": "move", "FileUtils.move": "move", "FileUtils.cp": "copy", "FileUtils.cp_r": "copy", "FileUtils.copy": "copy",
  "FileUtils.touch": "write",
};
const JS_CALLS: Record<string, Op> = {
  writeFileSync: "write", writeFile: "write", appendFileSync: "write", appendFile: "write", createWriteStream: "write",
  outputFileSync: "write", outputFile: "write", writeJsonSync: "write", writeJson: "write", truncateSync: "write", truncate: "write",
  unlinkSync: "delete", unlink: "delete", rmSync: "delete", rm: "delete", rmdirSync: "delete", rmdir: "delete", removeSync: "delete", remove: "delete",
  renameSync: "move", rename: "move", moveSync: "move", move: "move",
  copyFileSync: "copy", copyFile: "copy", cpSync: "copy", cp: "copy", copySync: "copy", copy: "copy",
  openSync: "open", open: "open", "Bun.write": "write",
};
// fs.writeFile and writeFileSync(…) after a destructured import are fine bare; `rename(…)` or `rm(…)` need an fs. in front.
const JS_BARE_OK = /Sync$|^(writeFile|appendFile|createWriteStream|Bun\.write)$/;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const callRe = (names: string[]) => new RegExp("(?<![\\w$.:])(" + names.map(escapeRe).join("|") + ")\\b", "g");
const PY_RE = callRe(Object.keys(PY_CALLS));
const RB_RE = callRe(Object.keys(RB_CALLS));
const JS_RE = new RegExp(
  "(?<![\\w$.])((?:(?:fs|fsp|fse|fsPromises|promises|fs\\.promises)|require\\(\\s*['\"](?:node:)?fs(?:\\/promises|-extra)?['\"]\\s*\\))\\.)?(" +
  Object.keys(JS_CALLS).map(escapeRe).join("|") + ")\\b", "g");
const PY_METHOD_RE = /\.[ \t]*(write_text|write_bytes|unlink|touch|open)\b/g;
const PL_OPEN_RE = /(?<![\w$>.:])open\s*\(?\s*(?:(?:my|our|local)\s+)?(?:\$\w+|[A-Z_]\w*|\*\w+)\s*,/g;
const PL_CALL_RE = /(?<![\w$>.:])(unlink|rename)\b/g;
const ASSIGN_RE = /(?:^|[;\n{])[ \t]*(?:(?:const|let|var|my|our|local)\s+)?([A-Za-z_$][\w$]*)[ \t]*=(?![=~>])[ \t]*/g;

const writeMode = (m: Val) => typeof m === "string" && /[wax+]/.test(m);
const perlWriteMode = (m: string) => /^\s*(\+<|\+?>)/.test(m);

/** Where the receiver of a method call starts, going left from the dot at `end`: `Path('a').resolve()`, `p`, `(a / b)`. */
function receiverStart(s: string, end: number): number {
  let p = end;
  for (;;) {
    while (p > 0 && /[\w.$]/.test(s[p - 1])) p--;
    if (s[p - 1] !== ")") return p;
    let depth = 0, q = p - 1;
    for (; q >= 0; q--) {
      if (s[q] === ")") depth++;
      else if (s[q] === "(" && --depth === 0) break;
    }
    if (q < 0) return p;
    p = q;
  }
}

/** The writes an inline script makes, in order of appearance. */
function scanScript(lang: Lang, src: string, dir: string | undefined): { at: number; w: CommandWrite }[] {
  const vars: Var[] = [];
  const ev = new Ev(src, lang, dir, vars);
  // Variables first, so a call can use `p = Path('app.vue')` from lines above it.
  for (const m of src.matchAll(ASSIGN_RE)) {
    const from = m.index + m[0].length;
    let value = ev.eval(from);
    ev.ws(false);
    const c = src[ev.i];
    if (c !== undefined && !";\n\r#}".includes(c)) value = undefined; // `a if x else b`, `a || b`: not a plain value
    vars.push({ name: m[1], at: from, value });
  }

  const found: { at: number; w: CommandWrite }[] = [];
  const put = (at: number, kind: "write" | "delete", raw: Val, from?: Val): string | undefined => {
    const p = absPath(raw, dir);
    if (!p) return undefined;
    const f = absPath(from, dir);
    found.push({ at, w: f ? { path: p, kind, from: f } : { path: p, kind } });
    return p;
  };
  const apply = (at: number, op: Op, a: Args | undefined) => {
    if (!a) return;
    const [p0, p1] = a.pos;
    if (op === "write") put(at, "write", p0);
    else if (op === "delete") put(at, "delete", p0);
    else if (op === "deleteAll") for (const p of a.pos) put(at, "delete", p);
    else if (op === "copy") put(at, "write", p1);
    else if (op === "move") { put(at, "write", p1, p0); put(at, "delete", p0); }
    else if (writeMode(a.pos[1] ?? a.kw.mode)) put(at, "write", p0);
  };
  const calls = (re: RegExp, table: Record<string, Op>) => {
    for (const m of src.matchAll(re)) apply(m.index, table[m[1]], ev.callArgs(m.index + m[0].length));
  };

  if (lang === "py") {
    calls(PY_RE, PY_CALLS);
    for (const m of src.matchAll(PY_METHOD_RE)) {
      const recv = ev.evalBefore(receiverStart(src, m.index), m.index);
      if (recv === undefined) continue;
      const a = ev.callArgs(m.index + m[0].length);
      if (m[1] === "unlink") put(m.index, "delete", recv);
      else if (m[1] === "open") { if (a && writeMode(a.pos[0] ?? a.kw.mode)) put(m.index, "write", recv); }
      else if (a) put(m.index, "write", recv);
    }
  } else if (lang === "js") {
    for (const m of src.matchAll(JS_RE)) {
      if (!m[1] && !JS_BARE_OK.test(m[2])) continue;
      apply(m.index, JS_CALLS[m[2]], ev.callArgs(m.index + m[0].length));
    }
  } else if (lang === "rb") calls(RB_RE, RB_CALLS);
  else {
    for (const m of src.matchAll(PL_OPEN_RE)) {
      const a = ev.argsAfter(m.index + m[0].length);
      const [first, second] = a.pos;
      if (a.pos.length >= 2) { if (first !== undefined && perlWriteMode(first)) put(m.index, "write", second); } // open(FH, '>', 'f')
      else if (first !== undefined && perlWriteMode(first)) put(m.index, "write", first.replace(/^\s*\+?[<>]+\s*/, "")); // open(FH, ">f")
    }
    for (const m of src.matchAll(PL_CALL_RE)) {
      const a = ev.callArgs(m.index + m[0].length);
      apply(m.index, m[1] === "rename" ? "move" : "deleteAll", a);
    }
  }
  return found.sort((x, y) => x.at - y.at); // stable: a move's write stays before its delete
}
