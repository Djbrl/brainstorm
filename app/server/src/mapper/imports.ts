import { existsSync, lstatSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { inside, relativeTo } from "../core/paths";

// A file's imports, per language: parseImports reads the specifiers a file names (pure: its text in, a list out, one
// reader per language), ImportResolver finds the project files they mean (it reads tsconfig.json and go.mod, and keeps
// indexes of the mapped files).

const JS_EXT = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
/** Components whose <script> imports like JavaScript does. */
const COMPONENT_EXT = new Set([".vue", ".svelte", ".astro"]);
/** C and C++ (and CUDA, Arduino): their `#include`s. */
const C_EXT = new Set([".c", ".h", ".cc", ".cpp", ".cxx", ".hh", ".hpp", ".hxx", ".ipp", ".inl", ".ino", ".cu", ".cuh", ".m", ".mm"]);

/**
 * JS/TS imports and re-exports: `import x from`, `import type { a, b } from` (over several lines), `import x, * as y
 * from`, `export * as x from`, `export { a } from`, `import "x"`, `require("x")`, `import("x")`. Each pattern spells out
 * what may stand between its keyword and `from`, and a brace list stops at the next brace: a lazy scan to the next quote
 * after every `export` was quadratic (a 500 KB file of `export const` lines took seconds, at each save).
 */
const JS_IMPORTS = [
  /\bimport\s+(?:type\s+)?(?:[\w$]+\s*,\s*)?(?:[\w$]+\s+|\*\s*as\s+[\w$]+\s+|\{[^{}]*\}\s*)from\s*['"]([^'"]+)['"]/g,
  /\bexport\s+(?:type\s+)?(?:\*\s*(?:as\s+[\w$]+\s+)?|\{[^{}]*\}\s*)from\s*['"]([^'"]+)['"]/g,
  /import\s+['"]([^'"]+)['"]/g,
  /require\(\s*['"]([^'"]+)['"]\s*\)/g,
  /import\(\s*['"]([^'"]+)['"]\s*\)/g,
];
export function jsImports(content: string): string[] {
  const specs: string[] = [];
  const code = stripComments(content, "c");
  for (const re of JS_IMPORTS) for (const m of code.matchAll(re)) specs.push(m[1]);
  return specs;
}

/**
 * The text with its comments blanked out (newlines kept, so line-anchored patterns still work), strings left alone: an
 * import in a comment or a docstring isn't an edge. "c": // and /* *\/ (JS, TS, Go, Java, C); "rust": the same, with
 * ' left alone (lifetimes); "py": # and triple-quoted strings. One pass, linear. A quote never runs past its line
 * (except a backtick or a triple quote), so an apostrophe in JSX text can't hide the rest of the file.
 */
export function stripComments(src: string, lang: "c" | "rust" | "py"): string {
  let out = "";
  let i = 0, from = 0;
  const n = src.length;
  const blank = (a: number, b: number) => { out += src.slice(from, a) + src.slice(a, b).replace(/[^\n]/g, " "); from = b; };
  while (i < n) {
    const ch = src[i];
    if (lang === "py" && (src.startsWith('"""', i) || src.startsWith("'''", i))) {
      const end = src.indexOf(src.slice(i, i + 3), i + 3);
      const stop = end === -1 ? n : end + 3;
      blank(i, stop); i = stop; continue;
    }
    if (lang === "py" ? ch === "#" : ch === "/" && src[i + 1] === "/") {
      let end = src.indexOf("\n", i); if (end === -1) end = n;
      blank(i, end); i = end; continue;
    }
    if (lang !== "py" && ch === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? n : end + 2;
      blank(i, stop); i = stop; continue;
    }
    if (ch === '"' || ch === "`" || (ch === "'" && lang !== "rust")) {
      i++;
      while (i < n && src[i] !== ch && (ch === "`" || src[i] !== "\n")) i += src[i] === "\\" ? 2 : 1;
      i++; continue;
    }
    i++;
  }
  return out + src.slice(from);
}

// ---- reading the imports a file names ----

/** Python: from a.b import c, d  /  from . import x  /  from ..pkg import (x, y)  /  import a.b, c as d. Each name after
 * `import` may be a module too (from pkg import sub): tried as "<module>.<name>" as well. */
function pyImports(content: string): string[] {
  const specs: string[] = [];
  const code = stripComments(content, "py");
  let m: RegExpExecArray | null;
  const reFrom = /^[ \t]*from[ \t]+(\.+[\w.]*|[A-Za-z_][\w.]*)[ \t]+import[ \t]+(\([^)]*\)|[^\n]*)/gm;
  while ((m = reFrom.exec(code))) {
    specs.push(m[1]);
    for (const name of m[2].replace(/[()\\]/g, " ").split(",")) {
      const n = name.trim().split(/\s+/)[0];
      if (n && n !== "*" && /^\w+$/.test(n)) specs.push(m[1].endsWith(".") ? m[1] + n : `${m[1]}.${n}`);
    }
  }
  const reImport = /^[ \t]*import[ \t]+([\w.]+(?:[ \t]+as[ \t]+\w+)?(?:[ \t]*,[ \t]*[\w.]+(?:[ \t]+as[ \t]+\w+)?)*)/gm;
  while ((m = reImport.exec(code))) for (const part of m[1].split(",")) specs.push(part.trim().split(/\s+/)[0]);
  return specs;
}

/** Go: import "x/y", or a block: import ( "x/y"; alias "x/z" ). */
function goImports(content: string): string[] {
  const specs: string[] = [];
  content = stripComments(content, "c");
  const block = /^\s*import\s*\(([\s\S]*?)\)/gm;
  const single = /^\s*import\s+(?:[\w.]+\s+)?"([^"]+)"/gm;
  let m: RegExpExecArray | null;
  while ((m = block.exec(content))) for (const q of m[1].matchAll(/"([^"]+)"/g)) specs.push(q[1]);
  while ((m = single.exec(content))) specs.push(m[1]);
  return specs;
}

/** Rust: mod child;  use crate::a::b;  use super::x;  use self::y::{z, w}; */
function rustImports(content: string): string[] {
  const specs: string[] = [];
  content = stripComments(content, "rust");
  let m: RegExpExecArray | null;
  const mods = /^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*;/gm;
  while ((m = mods.exec(content))) specs.push(`mod:${m[1]}`);
  const uses = /^\s*(?:pub(?:\([^)]*\))?\s+)?use\s+((?:crate|super|self)(?:::\w+)*)/gm;
  while ((m = uses.exec(content))) specs.push(`use:${m[1]}`);
  return specs;
}

/** Java: import a.b.C;  import static a.b.C.m;  import a.b.*; */
function javaImports(content: string): string[] {
  const specs: string[] = [];
  content = stripComments(content, "c");
  const re = /^\s*import\s+(?:static\s+)?([\w.]+(?:\.\*)?)\s*;/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) specs.push(m[1]);
  return specs;
}

/** C and C++: #include "local.h" (searched from this file's folder first); #include <lib/x.h> only when it names a
 * folder, so <stdio.h> isn't matched to a project file by chance. #import (Objective-C) the same. */
function cIncludes(content: string): string[] {
  const specs: string[] = [];
  content = stripComments(content, "c");
  const re = /^\s*#\s*(?:include|import)\s*(?:"([^"]+)"|<([^>]+\/[^>]+)>)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) specs.push(m[1] !== undefined ? `q:${m[1]}` : `a:${m[2]}`);
  return specs;
}

/** Each language's reader, by file extension. A file of any other kind names no imports. */
const IMPORT_READERS: [(ext: string) => boolean, (content: string) => string[]][] = [
  [(ext) => ext === ".py", pyImports],
  [(ext) => JS_EXT.has(ext) || COMPONENT_EXT.has(ext), jsImports],
  [(ext) => ext === ".go", goImports],
  [(ext) => ext === ".rs", rustImports],
  [(ext) => ext === ".java", javaImports],
  [(ext) => C_EXT.has(ext), cIncludes],
];

/** The import specifiers `file` names, as its language writes them (ImportResolver finds the files they mean). */
export function parseImports(file: string, content: string): string[] {
  if (!content) return [];
  const ext = extname(file);
  return IMPORT_READERS.find(([is]) => is(ext))?.[1](content) ?? [];
}

// ---- which project files they are ----

/** A tsconfig's (or jsconfig's) import aliases: where its `paths` and `baseUrl` point. */
type TsAliases = { base: string; paths: [prefix: string, suffix: string, targets: string[], exact: boolean][]; hasBaseUrl: boolean };
const TS_EXT = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".vue", ".svelte"];
/** `./x.js` written in TypeScript (NodeNext) means x.ts: the source a compiled name stands for. */
const COMPILED_TO_SOURCE: Record<string, string[]> = { ".js": [".ts", ".tsx"], ".jsx": [".tsx"], ".mjs": [".mts"], ".cjs": [".cts"] };

/** Finds the project files import specifiers mean, keeping what it learns on the way (tsconfig aliases, go.mod, indexes). */
export class ImportResolver {
  /** Per file set: Java files by package path ("com/acme/Foo.java" → abs paths), Go files by folder. Dropped when the set changes. */
  private indexes = new WeakMap<Set<string>, { java: Map<string, string[]>; goDirs: Map<string, string[]>; headers: Map<string, string[]> }>();
  private goModules = new Map<string, { dir: string; module: string } | null>(); // folder → nearest go.mod
  private tsconfigs = new Map<string, TsAliases | null>(); // folder → nearest tsconfig's aliases

  /** A map dropped from memory: what was learned under its root goes too. */
  forgetRoot(root: string) {
    for (const dir of this.goModules.keys()) if (inside(dir, root)) this.goModules.delete(dir);
    for (const dir of this.tsconfigs.keys()) if (inside(dir, root)) this.tsconfigs.delete(dir);
  }

  /** A tsconfig changed: every alias is read again. */
  configsChanged() { this.tsconfigs.clear(); }

  /** Files came or went from `fileSet`: its indexes are built again. */
  filesChanged(fileSet: Set<string>) { this.indexes.delete(fileSet); }

  /** How imports resolve, by the importing file's extension: every file of the package for Go and Java wildcard
   * imports, one file otherwise. Python, JS/TS and the components: resolveOne. */
  private readonly resolvers: [(ext: string) => boolean, (root: string, fromFile: string, spec: string, fileSet: Set<string>) => string[]][] = [
    [(ext) => ext === ".go", (_root, fromFile, spec, fileSet) => this.resolveGo(fromFile, spec, fileSet)],
    [(ext) => ext === ".rs", (_root, fromFile, spec, fileSet) => this.resolveRust(fromFile, spec, fileSet)],
    [(ext) => ext === ".java", (_root, _fromFile, spec, fileSet) => this.resolveJava(spec, fileSet)],
    [(ext) => C_EXT.has(ext), (_root, fromFile, spec, fileSet) => this.resolveInclude(fromFile, spec, fileSet)],
  ];

  /** Files an import points to. */
  private resolveImport(root: string, fromFile: string, spec: string, fileSet: Set<string>): string[] {
    const ext = extname(fromFile);
    const lang = this.resolvers.find(([is]) => is(ext));
    if (lang) return lang[1](root, fromFile, spec, fileSet);
    const one = this.resolveOne(root, fromFile, spec, fileSet);
    return one ? [one] : [];
  }

  /** The files `abs` imports, each once. */
  resolveSpecs(root: string, abs: string, specs: string[], fileSet: Set<string>): Set<string> {
    const out = new Set<string>();
    for (const spec of specs) for (const to of this.resolveImport(root, abs, spec, fileSet)) if (to !== abs) out.add(to);
    return out;
  }

  private resolveOne(root: string, fromFile: string, spec: string, fileSet: Set<string>): string | undefined {
    const ext = extname(fromFile);
    if (ext === ".py") {
      const pyFile = (base: string) => [`${base}.py`, join(base, "__init__.py")].find((c) => fileSet.has(c));
      if (!spec.startsWith(".")) {
        // Absolute: a/b.py or a/b/__init__.py under the nearest folder above this file that has it (the project root,
        // src/, a package's own root). The standard library and installed packages aren't project files: no match.
        const rel = spec.replace(/\./g, sep);
        for (let d = dirname(fromFile); ; d = dirname(d)) {
          const hit = pyFile(join(d, rel));
          if (hit) return hit;
          if (dirname(d) === d) return undefined;
        }
      }
      const dots = spec.match(/^\.+/)?.[0].length ?? 1;
      const rest = spec.slice(dots).replace(/\./g, "/");
      let base = dirname(fromFile);
      for (let i = 1; i < dots; i++) base = dirname(base);
      return pyFile(rest ? join(base, rest) : base);
    }
    if (spec.startsWith(".")) return this.jsFile(resolve(dirname(fromFile), spec), fileSet);
    // A bare specifier: an alias from the nearest tsconfig (paths, baseUrl), else a package (not on the map).
    const ts = this.tsAliasesFor(root, dirname(fromFile));
    if (!ts) return undefined;
    let best: [string, string, string[], boolean] | undefined;
    for (const p of ts.paths) {
      if (p[3] && spec !== p[0]) continue; // an alias without * means that name only
      if (spec.length >= p[0].length + p[1].length && spec.startsWith(p[0]) && spec.endsWith(p[1]) && (!best || p[0].length > best[0].length)) best = p;
    }
    if (best) {
      const star = spec.slice(best[0].length, spec.length - best[1].length);
      for (const target of best[2]) {
        const hit = this.jsFile(resolve(ts.base, target.replace("*", star)), fileSet);
        if (hit) return hit;
      }
    }
    return ts.hasBaseUrl ? this.jsFile(resolve(ts.base, spec), fileSet) : undefined;
  }

  /** The file a JS/TS import of `base` (absolute, maybe without extension) means: itself, with an extension, the TS source of a .js name, or a folder's index. */
  private jsFile(base: string, fileSet: Set<string>): string | undefined {
    if (fileSet.has(base)) return base;
    for (const e of TS_EXT) if (fileSet.has(base + e)) return base + e;
    const ext = extname(base);
    for (const e of COMPILED_TO_SOURCE[ext] ?? []) { const c = base.slice(0, -ext.length) + e; if (fileSet.has(c)) return c; }
    for (const e of [".ts", ".tsx", ".js", ".jsx"]) { const c = join(base, `index${e}`); if (fileSet.has(c)) return c; }
    return undefined;
  }

  /** The nearest tsconfig.json (or jsconfig.json) above a folder and inside the project, with its aliases; null when
   * none has any. `extends` is not followed. Only a regular file under 1 MB is read. */
  private tsAliasesFor(root: string, dir: string): TsAliases | null {
    if (this.tsconfigs.has(dir)) return this.tsconfigs.get(dir)!;
    let found: TsAliases | null = null;
    const file = ["tsconfig.json", "jsconfig.json"].map((f) => join(dir, f)).find((f) => existsSync(f));
    if (file) {
      try {
        const st = lstatSync(file);
        if (!st.isFile() || st.size > 1_000_000) throw new Error("not a small regular file");
        const json = stripComments(readFileSync(file, "utf8"), "c").replace(/,(\s*[}\]])/g, "$1");
        const opts = (JSON.parse(json) as { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } }).compilerOptions ?? {};
        const base = resolve(dir, opts.baseUrl ?? ".");
        const paths = Object.entries(opts.paths ?? {}).filter(([, t]) => Array.isArray(t)).map(([k, t]): [string, string, string[], boolean] => {
          const star = k.indexOf("*");
          return star === -1 ? [k, "", t.map((x) => x.replace("*", "")), true] : [k.slice(0, star), k.slice(star + 1), t, false];
        });
        found = paths.length || opts.baseUrl ? { base, paths, hasBaseUrl: !!opts.baseUrl } : null;
      } catch { found = null; } // unreadable or not JSON: no aliases
    } else if (relativeTo(dir, root)) found = this.tsAliasesFor(root, dirname(dir)); // never above the project
    this.tsconfigs.set(dir, found);
    return found;
  }

  private index(fileSet: Set<string>) {
    let idx = this.indexes.get(fileSet);
    if (idx) return idx;
    idx = { java: new Map(), goDirs: new Map(), headers: new Map() };
    for (const f of fileSet) {
      if (C_EXT.has(extname(f))) {
        // Every suffix path too: "net/socket.h" finds src/net/socket.h whatever the include folders are.
        const parts = f.split(sep);
        for (let i = parts.length - 1; i >= 1; i--) {
          const key = parts.slice(i).join("/");
          const list = idx.headers.get(key) ?? [];
          list.push(f);
          idx.headers.set(key, list);
        }
      } else if (f.endsWith(".java")) {
        // Index every suffix path, so "com/acme/Foo.java" finds src/main/java/com/acme/Foo.java.
        const parts = f.split(sep);
        for (let i = parts.length - 1; i >= 1; i--) {
          const key = parts.slice(i).join("/");
          const list = idx.java.get(key) ?? [];
          list.push(f);
          idx.java.set(key, list);
        }
      } else if (f.endsWith(".go") && !f.endsWith("_test.go")) {
        const list = idx.goDirs.get(dirname(f)) ?? [];
        list.push(f);
        idx.goDirs.set(dirname(f), list);
      }
    }
    this.indexes.set(fileSet, idx);
    return idx;
  }

  /** C/C++: next to the including file first, else a project file ending with that path (the nearest one). */
  private resolveInclude(fromFile: string, spec: string, fileSet: Set<string>): string[] {
    const quoted = spec.startsWith("q:");
    const path = spec.slice(2);
    if (quoted) {
      const local = resolve(dirname(fromFile), path);
      if (fileSet.has(local)) return [local];
    }
    const found = this.index(fileSet).headers.get(path.replace(/^(\.\.?\/)+/, ""));
    if (!found?.length) return [];
    if (found.length === 1) return [found[0]];
    // Several (include/x.h and vendor/x.h): the one sharing the longest folder prefix with the includer.
    const score = (f: string) => { let i = 0; while (i < f.length && f[i] === fromFile[i]) i++; return i; };
    return [found.reduce((a, b) => (score(b) > score(a) ? b : a))];
  }

  /** Go: an import inside this module ("<module path>/pkg/x") links to every file of that package folder. */
  private resolveGo(fromFile: string, spec: string, fileSet: Set<string>): string[] {
    const mod = this.goModuleOf(dirname(fromFile));
    if (!mod || (spec !== mod.module && !spec.startsWith(mod.module + "/"))) return []; // standard library or another module
    const dir = join(mod.dir, spec.slice(mod.module.length));
    return (this.index(fileSet).goDirs.get(resolve(dir)) ?? []).filter((f) => f !== fromFile);
  }

  private goModuleOf(dir: string): { dir: string; module: string } | null {
    if (this.goModules.has(dir)) return this.goModules.get(dir)!;
    let found: { dir: string; module: string } | null = null;
    const gomod = join(dir, "go.mod");
    if (existsSync(gomod)) {
      const m = /^module\s+(\S+)/m.exec(readFileSync(gomod, "utf8"));
      if (m) found = { dir, module: m[1] };
    } else if (dirname(dir) !== dir) found = this.goModuleOf(dirname(dir));
    this.goModules.set(dir, found);
    return found;
  }

  /** Rust: `mod x;` is x.rs or x/mod.rs next to this module; `use crate::a::b` walks from the crate root (the folder of lib.rs or main.rs). */
  private resolveRust(fromFile: string, spec: string, fileSet: Set<string>): string[] {
    const name = basename(fromFile);
    const isRoot = name === "lib.rs" || name === "main.rs" || name === "mod.rs";
    // Where this file's child modules live: its own folder for lib.rs/main.rs/mod.rs, else a folder named after it.
    const childDir = isRoot ? dirname(fromFile) : join(dirname(fromFile), basename(fromFile, ".rs"));
    const moduleFile = (dir: string, seg: string) => [join(dir, `${seg}.rs`), join(dir, seg, "mod.rs")].find((c) => fileSet.has(c));
    if (spec.startsWith("mod:")) { const f = moduleFile(childDir, spec.slice(4)); return f ? [f] : []; }

    const segs = spec.slice(4).split("::");
    let dir: string;
    if (segs[0] === "crate") {
      let d = dirname(fromFile);
      while (!fileSet.has(join(d, "lib.rs")) && !fileSet.has(join(d, "main.rs")) && dirname(d) !== d) d = dirname(d);
      dir = d;
    } else if (segs[0] === "self") dir = childDir;
    else { // super: one module up (the parent of this file's own module folder)
      dir = dirname(childDir);
      while (segs[1] === "super") { segs.shift(); dir = dirname(dir); }
    }
    // Longest path that is a module file: crate::a::b::Thing → a/b.rs (Thing is an item inside it).
    let hit: string | undefined;
    for (const seg of segs.slice(1)) {
      const f = moduleFile(dir, seg);
      if (!f) break;
      hit = f;
      dir = join(dir, seg);
    }
    return hit && hit !== fromFile ? [hit] : [];
  }

  /** Java: com.acme.Foo → …/com/acme/Foo.java; com.acme.* → every file of that package; static imports drop the member. */
  private resolveJava(spec: string, fileSet: Set<string>): string[] {
    const idx = this.index(fileSet).java;
    const parts = spec.split(".");
    if (parts[parts.length - 1] === "*") {
      const pkg = parts.slice(0, -1).join("/") + "/";
      const out = new Set<string>();
      for (const [key, files] of idx) if (key.startsWith(pkg) && !key.slice(pkg.length).includes("/")) files.forEach((f) => out.add(f));
      return [...out];
    }
    for (let n = parts.length; n >= 2; n--) { // Foo.Inner or a static member: drop trailing parts until a file matches
      const files = idx.get(parts.slice(0, n).join("/") + ".java");
      if (files?.length === 1) return files;
    }
    return [];
  }
}
