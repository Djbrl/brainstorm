import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import chokidar, { FSWatcher } from "chokidar";
import type { Edge, FileNode, ProjectMap, Snapshot } from "../types";
import { BusService } from "../core/bus.service";
import { EventsGateway } from "../core/events.gateway";
import { ConfigService } from "../core/config.service";

const IGNORE_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "out", "data", ".claude", ".vercel",
  "__pycache__", ".venv", "venv", ".next", ".turbo", "coverage", ".cache",
]);
const LOCKFILES = new Set(["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "Cargo.lock", "poetry.lock", "composer.lock"]);
const SOURCE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs", ".java", ".md", ".json", ".css", ".html"]);
const JS_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const MAX_FILES = 800;

type Cached = { map: ProjectMap; gitTimes: Map<string, number>; byPath: Map<string, FileNode> };

// Owner: B. Walk the project, imports → edges, lastChangedAt from git + mtime, watch for changes.
@Injectable()
export class MapperService implements OnModuleInit {
  private log = new Logger("Mapper");
  private cache = new Map<string, Cached>();
  /** Per file set: Java files by package path ("com/acme/Foo.java" → abs paths), Go files by folder. Rebuilt when the set changes. */
  private indexes = new WeakMap<Set<string>, { java: Map<string, string[]>; goDirs: Map<string, string[]> }>();
  private goModules = new Map<string, { dir: string; module: string } | null>(); // folder → nearest go.mod
  private watchers = new Map<string, FSWatcher>();
  private activeClearTimers = new Map<string, NodeJS.Timeout>();
  private building = new Set<string>();
  /** The workspace's active root: the one we keep a live chokidar watch on (owner: S). */
  private activeRoot?: string;
  buildMs = 0;

  constructor(private bus: BusService, private gateway: EventsGateway, private cfg: ConfigService) {}

  onModuleInit() {
    // Build + watch the default root eagerly so live updates and the reader have something to work with.
    this.activeRoot = resolve(this.cfg.defaultRoot);
    this.getMap(this.activeRoot);
    this.watch(this.activeRoot);
    this.bus.on("file-touched", ({ path, sessionId, ts }) => this.onFileTouched(this.cfg.defaultRoot, path, sessionId, ts));
    this.bus.on("workspace", ({ root }) => this.switchRoot(root));
  }

  getMap(root: string): ProjectMap {
    const abs = resolve(root);
    const existing = this.cache.get(abs);
    if (existing) return existing.map;
    this.building.add(abs);
    try {
      const t0 = Date.now();
      const built = this.buildMap(abs);
      this.buildMs = Date.now() - t0;
      this.cache.set(abs, built);
      this.log.log(`built map for ${abs}: ${built.map.files.length} files, ${built.map.edges.length} edges, ${built.map.modules.length} modules in ${this.buildMs}ms`);
      return built.map;
    } finally {
      this.building.delete(abs);
    }
  }

  getHistory(_root: string): Snapshot[] { return []; } // history/snapshots cut for the demo

  /** Internal: cached ProjectMap for a root, if it has been built. Used by the reader to attach summaries. */
  getCached(root: string): Cached | undefined { return this.cache.get(resolve(root)); }

  /** True while `getMap(root)` is walking the tree for the first time (used by the setup checklist). */
  isBuilding(root: string): boolean { return this.building.has(resolve(root)); }

  /** React to the active workspace changing: watch the new root, build its map, broadcast it. */
  switchRoot(root: string): ProjectMap {
    const abs = resolve(root);
    if (this.activeRoot && this.activeRoot !== abs) {
      const oldWatcher = this.watchers.get(this.activeRoot);
      if (oldWatcher) { oldWatcher.close(); this.watchers.delete(this.activeRoot); }
    }
    const map = this.getMap(abs); // cache hit if something already built it (e.g. the reader)
    this.activeRoot = abs;
    this.watch(abs);
    this.gateway.broadcast({ type: "map", map });
    this.log.log(`switched active map root to ${abs}: ${map.files.length} files, ${map.edges.length} edges, ${map.modules.length} modules`);
    return map;
  }

  // ---- build ----

  private buildMap(root: string): Cached {
    const files: string[] = [];
    this.walk(root, root, files);

    const gitTimes = this.gitLastCommitTimes(root);
    const fileSet = new Set(files);
    const nodes: FileNode[] = [];
    const byPath = new Map<string, FileNode>();
    const edges: Edge[] = [];
    const moduleIds = new Map<string, { id: string }>();

    for (const abs of files) {
      let content = "";
      try { content = readFileSync(abs, "utf8"); } catch { continue; }
      const lines = content.length ? content.split("\n").length : 0;
      const rel = relative(root, abs);
      const moduleId = this.moduleOf(rel);
      if (!moduleIds.has(moduleId)) moduleIds.set(moduleId, { id: moduleId });
      const lastChangedAt = this.lastChangedAt(root, abs, rel, gitTimes);
      const node: FileNode = { path: abs, module: moduleId, lines, lastChangedAt };
      nodes.push(node);
      byPath.set(abs, node);

      for (const to of this.importsOf(abs, content, fileSet)) edges.push({ from: abs, to });
    }

    const map: ProjectMap = { root, files: nodes, edges, modules: [...moduleIds.values()] };
    return { map, gitTimes, byPath };
  }

  private walk(root: string, dir: string, out: string[]) {
    if (out.length >= MAX_FILES) return;
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    for (const name of entries) {
      if (out.length >= MAX_FILES) return;
      if (LOCKFILES.has(name)) continue;
      const abs = join(dir, name);
      let st;
      try { st = statSync(abs); } catch { continue; }
      if (st.isDirectory()) {
        if (IGNORE_DIRS.has(name) || name.startsWith(".")) continue;
        this.walk(root, abs, out);
      } else if (st.isFile()) {
        const ext = extname(name);
        if (!SOURCE_EXT.has(ext)) continue;
        out.push(abs);
      }
    }
  }

  private moduleOf(rel: string): string {
    const parts = rel.split(sep);
    const folders = parts.slice(0, -1).slice(0, 2);
    return folders.length ? folders.join("/") : ".";
  }

  // ---- imports ----

  private parseImports(file: string, content: string): string[] {
    const specs: string[] = [];
    const ext = extname(file);
    if (ext === ".py") {
      const reFrom = /^\s*from\s+(\.+[\w.]*)\s+import\b/gm;
      let m: RegExpExecArray | null;
      while ((m = reFrom.exec(content))) specs.push(m[1]);
      return specs;
    }
    if (ext === ".go") {
      // import "x/y", or a block: import ( "x/y"; alias "x/z" )
      const block = /^\s*import\s*\(([\s\S]*?)\)/gm;
      const single = /^\s*import\s+(?:[\w.]+\s+)?"([^"]+)"/gm;
      let m: RegExpExecArray | null;
      while ((m = block.exec(content))) for (const q of m[1].matchAll(/"([^"]+)"/g)) specs.push(q[1]);
      while ((m = single.exec(content))) specs.push(m[1]);
      return specs;
    }
    if (ext === ".rs") {
      // mod child;  use crate::a::b;  use super::x;  use self::y::{z, w};
      let m: RegExpExecArray | null;
      const mods = /^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*;/gm;
      while ((m = mods.exec(content))) specs.push(`mod:${m[1]}`);
      const uses = /^\s*(?:pub(?:\([^)]*\))?\s+)?use\s+((?:crate|super|self)(?:::\w+)*)/gm;
      while ((m = uses.exec(content))) specs.push(`use:${m[1]}`);
      return specs;
    }
    if (ext === ".java") {
      const re = /^\s*import\s+(?:static\s+)?([\w.]+(?:\.\*)?)\s*;/gm;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content))) specs.push(m[1]);
      return specs;
    }
    if (JS_EXT.has(ext)) {
      const patterns = [
        /import\s+[^'"]*?from\s+['"]([^'"]+)['"]/g,
        /export\s+[^'"]*?from\s+['"]([^'"]+)['"]/g,
        /import\s+['"]([^'"]+)['"]/g,
        /require\(\s*['"]([^'"]+)['"]\s*\)/g,
        /import\(\s*['"]([^'"]+)['"]\s*\)/g,
      ];
      for (const re of patterns) {
        let m: RegExpExecArray | null;
        while ((m = re.exec(content))) specs.push(m[1]);
      }
    }
    return specs;
  }

  /** The files `abs` imports, each once. */
  private importsOf(abs: string, content: string, fileSet: Set<string>): Set<string> {
    const out = new Set<string>();
    for (const spec of this.parseImports(abs, content)) for (const to of this.resolveImport(abs, spec, fileSet)) if (to !== abs) out.add(to);
    return out;
  }

  /** Files an import points to: one for most languages, every file of the package for Go and Java wildcard imports. */
  private resolveImport(fromFile: string, spec: string, fileSet: Set<string>): string[] {
    const ext = extname(fromFile);
    if (ext === ".go") return this.resolveGo(fromFile, spec, fileSet);
    if (ext === ".rs") return this.resolveRust(fromFile, spec, fileSet);
    if (ext === ".java") return this.resolveJava(spec, fileSet);
    const one = this.resolveOne(fromFile, spec, fileSet);
    return one ? [one] : [];
  }

  private resolveOne(fromFile: string, spec: string, fileSet: Set<string>): string | undefined {
    const ext = extname(fromFile);
    if (ext === ".py") {
      if (!spec.startsWith(".")) return undefined; // package import, ignore
      const dots = spec.match(/^\.+/)?.[0].length ?? 1;
      const rest = spec.slice(dots).replace(/\./g, "/");
      let base = dirname(fromFile);
      for (let i = 1; i < dots; i++) base = dirname(base);
      const candidateBase = rest ? join(base, rest) : base;
      for (const cand of [`${candidateBase}.py`, join(candidateBase, "__init__.py")]) {
        if (fileSet.has(cand)) return cand;
      }
      return undefined;
    }
    if (!spec.startsWith(".")) return undefined; // bare package specifier, ignore
    const base = resolve(dirname(fromFile), spec);
    const candidates = [
      base,
      `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, `${base}.mjs`, `${base}.cjs`,
      join(base, "index.ts"), join(base, "index.tsx"), join(base, "index.js"), join(base, "index.jsx"),
    ];
    for (const cand of candidates) if (fileSet.has(cand)) return cand;
    return undefined;
  }

  private index(fileSet: Set<string>) {
    let idx = this.indexes.get(fileSet);
    if (idx) return idx;
    idx = { java: new Map(), goDirs: new Map() };
    for (const f of fileSet) {
      if (f.endsWith(".java")) {
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

  // ---- git + mtime ----

  private gitLastCommitTimes(root: string): Map<string, number> {
    const map = new Map<string, number>();
    try {
      const out = execFileSync("git", ["-C", root, "log", "--name-only", "--pretty=format:\u0001%ct"], {
        maxBuffer: 64 * 1024 * 1024,
        encoding: "utf8",
      });
      let currentCt = 0;
      for (const line of out.split("\n")) {
        if (line.startsWith("\u0001")) { currentCt = Number(line.slice(1)) || 0; continue; }
        const rel = line.trim();
        if (!rel) continue;
        if (!map.has(rel)) map.set(rel, currentCt);
      }
    } catch (e) {
      this.log.warn(`git log unavailable, falling back to mtime only: ${(e as Error).message}`);
    }
    return map;
  }

  private lastChangedAt(root: string, abs: string, rel: string, gitTimes: Map<string, number>): string {
    let mtimeMs = 0;
    try { mtimeMs = statSync(abs).mtimeMs; } catch { /* ignore */ }
    const gitSec = gitTimes.get(rel) ?? 0;
    const ms = Math.max(mtimeMs, gitSec * 1000);
    return new Date(ms || Date.now()).toISOString();
  }

  // ---- live updates ----

  private watch(root: string) {
    if (this.watchers.has(root)) return;
    const watcher = chokidar.watch(root, {
      ignored: (p: string) => {
        const name = basename(p);
        if (IGNORE_DIRS.has(name)) return true;
        if (LOCKFILES.has(name)) return true;
        if (existsSync(p) && statSync(p).isFile() && !SOURCE_EXT.has(extname(name))) return true;
        return false;
      },
      ignoreInitial: true,
      persistent: true,
    });
    watcher.on("add", (p: string) => this.recompute(root, resolve(p)));
    watcher.on("change", (p: string) => this.recompute(root, resolve(p)));
    watcher.on("unlink", (p: string) => this.remove(root, resolve(p)));
    this.watchers.set(root, watcher);
  }

  private recompute(root: string, abs: string) {
    const ext = extname(abs);
    if (!SOURCE_EXT.has(ext)) return;
    const cached = this.cache.get(root);
    if (!cached) return;
    let content: string;
    try { content = readFileSync(abs, "utf8"); } catch { return; }
    const lines = content.length ? content.split("\n").length : 0;
    const rel = relative(root, abs);
    const moduleId = this.moduleOf(rel);
    const lastChangedAt = this.lastChangedAt(root, abs, rel, cached.gitTimes);

    let node = cached.byPath.get(abs);
    if (!node) {
      node = { path: abs, module: moduleId, lines, lastChangedAt };
      cached.byPath.set(abs, node);
      cached.map.files.push(node);
      if (!cached.map.modules.some((m) => m.id === moduleId)) cached.map.modules.push({ id: moduleId });
    } else {
      node.lines = lines;
      node.lastChangedAt = lastChangedAt;
    }

    // Recompute this file's outgoing edges, and send them along so the web's import lines stay current.
    cached.map.edges = cached.map.edges.filter((e) => e.from !== abs);
    const fileSet = new Set(cached.map.files.map((f) => f.path));
    const edges: Edge[] = [...this.importsOf(abs, content, fileSet)].map((to) => ({ from: abs, to }));
    cached.map.edges.push(...edges);

    this.gateway.broadcast({ type: "file", file: node, edges });
  }

  private remove(root: string, abs: string) {
    const cached = this.cache.get(root);
    if (!cached) return;
    cached.byPath.delete(abs);
    cached.map.files = cached.map.files.filter((f) => f.path !== abs);
    cached.map.edges = cached.map.edges.filter((e) => e.from !== abs && e.to !== abs);
    this.gateway.broadcast({ type: "file-removed", path: abs });
  }

  private onFileTouched(root: string, path: string, sessionId: string, ts: string) {
    const cached = this.cache.get(root);
    if (!cached) return;
    const node = cached.byPath.get(path);
    if (!node) return;
    node.activeSessionId = sessionId;
    node.lastChangedAt = ts;
    this.gateway.broadcast({ type: "file", file: node });

    const key = path;
    const existingTimer = this.activeClearTimers.get(key);
    if (existingTimer) clearTimeout(existingTimer);
    const timer = setTimeout(() => {
      node.activeSessionId = undefined;
      this.activeClearTimers.delete(key);
      this.gateway.broadcast({ type: "file", file: node });
    }, 60_000);
    this.activeClearTimers.set(key, timer);
  }
}
