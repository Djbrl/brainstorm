// The files an inline script writes or deletes (`python3 - <<'PY' … Path('app.vue').write_text(…)`, `node -e`,
// `ruby -e`, `perl -e`), found by reading the script text. Python, JavaScript, Ruby and Perl only, and in them only the
// calls listed below (PY_CALLS, RB_CALLS, JS_CALLS, the Perl open/unlink/rename): nothing else is added here.
import { absPath, home } from "./shell-tokens";
import type { CommandWrite } from "./command-writes";

// ───────────────────────────── inline scripts ─────────────────────────────
// Not a parser: the calls that write files are found by name, and their arguments are read only when they are
// literals, or variables assigned a literal earlier (`p = Path('app.vue')`), or path.join / Path(…) / os.path.join of those.

export type Lang = "py" | "js" | "rb" | "pl";
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
const PL_OPEN_RE = /(?<![\w$>.:])open\s*(?:\(\s*)?(?:(?:my|our|local)\s+)?(?:\$\w+|[A-Z_]\w*|\*\w+)\s*,/g;
const PL_CALL_RE = /(?<![\w$>.:])(unlink|rename)\b/g;
const ASSIGN_RE = /(?:^|[;\n{])[ \t]*(?:(?:const|let|var|my|our|local)\s+)?([A-Za-z_$][\w$]*)[ \t]*=(?![=~>])[ \t]*/g;

const writeMode = (m: Val) => typeof m === "string" && /^[^:]*[wax+]/.test(m);   // before any ":encoding" ('r:windows-1252' reads)
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
export function scanScript(lang: Lang, src: string, dir: string | undefined): { at: number; w: CommandWrite }[] {
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
