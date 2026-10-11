// The files a shell command writes, creates or deletes, found by reading the command text (nothing is run).
// Agents change files through the shell as often as through their edit tools: `sed -i`, `cat > f <<EOF`, `mv`,
// `python3 - <<'PY' … Path('app.vue').write_text(…)`, Codex's `apply_patch`. This is the static half: what the command
// says it writes. Only what can be known from the text is returned: a path built from a variable, a glob or a command
// substitution is left out, and so is anything a script computes at run time. Never throws.
// The text is read by shell-tokens.ts; inline scripts by script-writes.ts. This file is what each command does.
import { basename, resolve } from "node:path";
import { type ArgSpec, type Cmd, type Word, absPath, parseArgs, parseShell, word } from "./shell-tokens";
import { type Lang, scanScript } from "./script-writes";

export { shellArgv } from "./shell-tokens";

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
  private r = new Set<string>();
  /** The folders `pushd` left, for `popd`. */
  dirs: (string | undefined)[] = [];
  add(w: CommandWrite) { this.m.set(w.path, w); } // an existing path keeps its place and takes the new kind
  list() { return [...this.m.values()]; }
  read(p: string | undefined) { if (p && this.r.size < READS_MAX) this.r.add(p); }
  /** What it read, less what it wrote (`sed -n p f > f2` reads f; `cat a > b` writes b, reads a). */
  reads() { return [...this.r].filter((p) => !this.m.has(p)); }
}

const READS_MAX = 24;   // a `cat` of a whole folder's files: the first ones say enough

/**
 * Files a shell command reads, as absolute paths, in order: the operands of the commands that show or search files
 * (`cat`, `head`, `tail`, `sed -n`, `grep`, `rg`, `wc`, `awk`, `jq`, `diff`, …) and `< file`. Only what the text says,
 * like commandWrites: a glob, a variable or a path a script computes is left out. A folder (`grep -r x app/`) is kept:
 * whoever shows it decides what a folder means. Never throws.
 */
export function commandReads(command: string, cwd: string): string[] {
  try {
    const out = new Out();
    runShell(command, resolve(cwd), out, 0);
    return out.reads();
  } catch {
    return [];
  }
}

// ───────────────────────────── shell: what each command does ─────────────────────────────

const MAX_DEPTH = 3; // bash -c "bash -c '…'" and so on
const RESERVED = new Set(["if", "then", "else", "elif", "do", "while", "until", "{", "}", "!"]);
const WRAPPERS = new Set(["sudo", "env", "command", "nohup", "time", "exec", "nice", "builtin"]);
/** The options of a wrapper that take a value (`sudo -u www rm x`: www is not the command). */
const WRAPPER_VALUES: Record<string, string[]> = {
  sudo: ["-u", "-g", "-h", "-p", "-C", "-D", "-R", "-T", "-U", "-r", "-t"],
  nice: ["-n", "--adjustment"], env: ["-u", "-C", "--unset", "--chdir"], time: ["-f", "-o", "--format", "--output"], exec: ["-a"],
};
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
  for (const r of cmd.redirs) if (r.writes) add(out, pathOf(r.target, dir), "write"); else if (r.fd === "" || r.fd === "0") out.read(pathOf(r.target, dir));

  let words = cmd.words.slice();
  for (;;) {
    const w = words[0];
    if (!w) break;
    if (!w.quoted && (RESERVED.has(w.text) || ASSIGNMENT.test(w.text))) words.shift();
    else if (WRAPPERS.has(basename(w.text))) {
      // Its options up to the command it runs; the last word is always the command (`sudo -u` alone runs nothing).
      words.shift();
      const last = words.pop();
      const p = parseArgs(words, { values: WRAPPER_VALUES[basename(w.text)] ?? [], stopAtOperand: true, dashWordsAreOptions: true });
      words = last ? [...p.operands, last] : [];
    } else break;
  }
  if (!words.length) return dir;

  const name = basename(words[0].text);
  const args = words.slice(1);

  const reads = READERS[name];
  if (reads) for (const w of reads(args)) if (w.text !== "-") out.read(pathOf(w, dir));

  switch (name) {
    case "popd": return out.dirs.length ? out.dirs.pop() : dir;
    case "cd": case "pushd": {
      if (name === "pushd") out.dirs.push(dir);
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

/** The commands that show or search files, and which of their words are the files they read. */
const operandsOf = (valueFlags: string[] = [], skip = 0) => (args: Word[]) => parseArgs(args, valueFlags).operands.slice(skip);
/** A program text first (grep's pattern, awk's or jq's program, sed's script), unless it came with -e or -f. */
const afterProgram = (valueFlags: string[], given: string[]) => (args: Word[]) => {
  const p = parseArgs(args, valueFlags);
  return given.some((f) => p.vals.has(f) || p.flags.includes(f)) ? p.operands : p.operands.slice(1);
};
const GREP_VALUES = ["-e", "-f", "-m", "-A", "-B", "-C", "--include", "--exclude", "--exclude-dir", "-g", "--glob", "-t", "--type", "-T", "--type-not", "--max-count", "--context", "--color", "--colour"];
const READERS: Record<string, (args: Word[]) => Word[]> = {
  cat: operandsOf(), bat: operandsOf(["-l", "--language", "-r", "--line-range"]), less: operandsOf(), more: operandsOf(), nl: operandsOf(),
  head: operandsOf(["-n", "-c"]), tail: operandsOf(["-n", "-c"]), wc: operandsOf(), file: operandsOf(), stat: operandsOf(["-f", "-c", "--format"]),
  diff: operandsOf(["-U", "-C", "--label"]), cmp: operandsOf(), md5: operandsOf(), shasum: operandsOf(["-a"]), xxd: operandsOf(["-l", "-s", "-c"]),
  grep: afterProgram(GREP_VALUES, ["-e", "-f"]), egrep: afterProgram(GREP_VALUES, ["-e", "-f"]), fgrep: afterProgram(GREP_VALUES, ["-e", "-f"]),
  rg: afterProgram(GREP_VALUES, ["-e", "-f"]), ag: afterProgram(GREP_VALUES, ["-e", "-f"]),
  awk: afterProgram(["-F", "-v", "-f"], ["-f"]), jq: afterProgram(["--arg", "--argjson", "-f", "--slurpfile", "--rawfile"], ["-f"]),
  // sed: the files after its script, unless it edits them in place (then they're writes: sedFiles).
  sed: (args) => (sedFiles(args).length ? [] : afterProgram(["-e", "-f"], ["-e", "-f"])(args)),
};

/** `sed -i` files, in the GNU forms (-i, -i.bak, --in-place) and the BSD one (-i ''); none when it isn't in place. */
const SED_ARGS: ArgSpec = { values: ["--expression", "--file", "--line-length"], letters: { i: "suffix", e: "value", f: "value", l: "value" } }; // -l N: the line length, not the script
function sedFiles(args: Word[]): Word[] {
  const p = parseArgs(args, SED_ARGS);
  const has = (...names: string[]) => names.some((n) => p.flags.includes(n) || p.vals.has(n));
  if (!has("-i", "--in-place")) return [];
  return has("-e", "-f", "--expression", "--file") ? p.operands : p.operands.slice(1); // else the first operand is the script
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
  const global = parseArgs(args, { values: ["-C", "-c"], stopAtOperand: true, dashWordsAreOptions: true }); // git -C sub -c k=v …
  for (const o of global.opts) if (o.name === "-C") dir = pathOf(o.value, dir);
  const sub = global.operands[0]?.text;
  const rest = global.operands.slice(1);
  const p = parseArgs(rest, ["-s", "--source"]);
  const files = (ws: Word[]) => ws.filter((w) => w.text !== "." && !w.text.startsWith(":"));
  if (sub === "checkout") for (const w of files(p.dashed)) add(out, pathOf(w, dir), "write"); // only `-- files` is a file
  else if (sub === "restore") {
    const indexOnly = (p.flags.includes("--staged") || p.flags.includes("-S")) && !p.flags.includes("--worktree") && !p.flags.includes("-W");
    if (!indexOnly) for (const w of files(p.operands)) add(out, pathOf(w, dir), "write");
  } else if (sub === "rm") {
    if (!p.flags.includes("--cached")) for (const w of files(p.operands)) add(out, pathOf(w, dir), "delete");
  } else if (sub === "mv") moveOrCopy(rest, dir, out, true);
}

/** Codex's patch format: Update/Add File write, Delete File deletes, Move to renames. */
function patchWrites(text: string, dir: string | undefined, out: Out) {
  let last: string | undefined;
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd(); // not `(.+?)\s*$` in the patterns: a long run of spaces inside the path is re-scanned from every character
    const f = /^\*\*\* (Update|Add|Delete) File: (.+)$/.exec(line);
    if (f) {
      last = absPath(f[2], dir);
      add(out, last, f[1] === "Delete" ? "delete" : "write");
      continue;
    }
    const mv = /^\*\*\* Move to: (.+)$/.exec(line);
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
const PERL_RUBY_ARGS: ArgSpec = { letters: { i: "rest", e: "value", E: "value", I: "value", r: "value", M: "rest", m: "rest", F: "rest", 0: "rest", x: "rest" }, stopAtOperand: true }; // -i.bak: the backup suffix
function perlRubyArgs(args: Word[]): { scripts: string[]; inPlace: boolean; operands: Word[] } {
  const p = parseArgs(args, PERL_RUBY_ARGS);
  const scripts = p.opts.filter((o) => (o.name === "-e" || o.name === "-E") && o.value).map((o) => o.value!.text);
  return { scripts, inPlace: p.flags.includes("-i"), operands: p.operands };
}
