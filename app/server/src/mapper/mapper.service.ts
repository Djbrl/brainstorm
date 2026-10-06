import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from "@nestjs/common";
import { existsSync, readFileSync, statSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import type { Edge, FileNode, ProjectMap, Snapshot } from "../types";
import { BusService } from "../core/bus.service";
import { EventsGateway } from "../core/events.gateway";
import { ConfigService } from "../core/config.service";
import { DbService } from "../core/db.service";
import { formerRoots } from "../listener/moved";
import { isInIgnoredDir, liveHeadroom, maxFiles, isMappableRel, moduleOf } from "./ignore";
import { type Listing, gitIgnored, listFolder, listProjectFiles, listProjectFilesSync } from "./list-files";
import { type Signals, scoreFrom, selectFiles } from "./select";
import { gitLastCommitTimes } from "./git-times";
import { Batcher, ProjectWatcher, foldersToWatch } from "./watch";

const JS_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
/** Maps kept in memory, one per project root (the active one is never dropped). */
const MAX_ROOTS = 4;
/** Live changes are applied together, at most this long after the first one. */
const BATCH_MS = 100;
/**
 * A batch that changes more files than this (a branch switch, a codegen run) sends one "map" instead of a message per
 * file (each carries the file and its imports; 50 of them already weigh about as much as an 800-file map)…
 */
const MAP_BROADCAST_OVER = 50;
/** …and those "map" messages go out at most this often (a long burst sends a few, not one per batch). */
const MAP_BROADCAST_GAP_MS = 750;
/** Files read at once. */
const IO_CONCURRENCY = 32;
/** Bigger files are counted (lines) but not searched for imports. */
const MAX_PARSE_BYTES = 1024 * 1024;

type Read = { abs: string; lines: number; content: string; mtimeMs: number };
type Cached = {
  map: ProjectMap;
  /** Newest commit time (s) per mapped file, keyed by its path relative to the root with "/" separators. Filled in after the map is sent. */
  gitTimes: Map<string, number>;
  byPath: Map<string, FileNode>;
  /** The mapped files (byPath's keys), updated in place: import resolution looks files up here. */
  fileSet: Set<string>;
  /** Import specifiers each file contains, kept so imports can be re-resolved when files come and go without re-reading them. */
  specs: Map<string, string[]>;
  /** Resolved imports by importing file: map.edges is this, flattened. */
  out: Map<string, Set<string>>;
  mtimes: Map<string, number>;
  /** Mapped files git tracks (relative, "/" separators); undefined when not a git repo. */
  tracked?: Set<string>;
  listing: Pick<Listing, "source" | "total"> & { ms: number };
  /** Files the cap left out (absolute). A change to one doesn't put it on the map (a branch switch would flood it); an agent's edit does. */
  unselected: Set<string>;
  /** Mappable files never even listed (a giant repo past the candidate limit), for totalFiles. */
  uncounted: number;
  /** Files an agent edited while this map was live: they join the map whatever the cap. */
  agentTouched: Set<string>;
};
type Live = { root: string; watcher: ProjectWatcher; batch: Batcher<string>; pending: Set<string>; running: boolean; folders: Set<string> };

const posix = (rel: string) => (sep === "/" ? rel : rel.split(sep).join("/"));

function countLines(buf: Buffer): number {
  if (!buf.length) return 0;
  let n = 1;
  for (let i = buf.indexOf(10); i !== -1; i = buf.indexOf(10, i + 1)) n++;
  return n;
}

function toRead(abs: string, buf: Buffer, mtimeMs: number): Read {
  return { abs, lines: countLines(buf), content: buf.length <= MAX_PARSE_BYTES ? buf.toString("utf8") : "", mtimeMs };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

const sameSet = (a: Set<string> | undefined, b: Set<string>) => !!a && a.size === b.size && [...a].every((x) => b.has(x));

// Owner: B. List the project's files (git, else a walk), imports → edges, lastChangedAt from mtime then git, watch for changes.
@Injectable()
export class MapperService implements OnModuleInit, OnModuleDestroy {
  private log = new Logger("Mapper");
  /** Built maps by root, least recently used first (bounded by MAX_ROOTS). */
  private cache = new Map<string, Cached>();
  private inflight = new Map<string, Promise<Cached>>();
  /** Per file set: Java files by package path ("com/acme/Foo.java" → abs paths), Go files by folder. Dropped when the set changes. */
  private indexes = new WeakMap<Set<string>, { java: Map<string, string[]>; goDirs: Map<string, string[]> }>();
  private goModules = new Map<string, { dir: string; module: string } | null>(); // folder → nearest go.mod
  private live?: Live;
  private activeClearTimers = new Map<string, NodeJS.Timeout>();
  private building = new Set<string>();
  /** The workspace's active root: the one we keep a live watch on (owner: S). */
  private activeRoot?: string;
  private mapBroadcast: { last: number; timer?: NodeJS.Timeout } = { last: 0 };
  buildMs = 0;

  /** An agent's edit to a file not on the map yet: the activity to show once the file joins. */
  private pendingTouches = new Map<string, { sessionId: string; ts: string }>();

  constructor(private bus: BusService, private gateway: EventsGateway, private cfg: ConfigService, @Optional() private dbs?: DbService) {}

  onModuleInit() {
    // Build + watch the default root right away (in the background) so live updates and the reader have something to work with.
    const root = resolve(this.cfg.defaultRoot);
    this.activeRoot = root;
    this.ensure(root).then((c) => { if (this.activeRoot === root) this.startWatch(root, c); }).catch((e) => this.log.warn(`map build failed for ${root}: ${(e as Error).message}`));
    this.bus.on("file-touched", ({ path, sessionId, ts }) => this.onFileTouched(this.cfg.defaultRoot, path, sessionId, ts));
    this.bus.on("workspace", ({ root }) => { this.switchRoot(root).catch((e) => this.log.warn(`switching the map to ${root} failed: ${(e as Error).message}`)); });
  }

  onModuleDestroy() {
    this.stopWatch();
    if (this.mapBroadcast.timer) clearTimeout(this.mapBroadcast.timer);
    for (const t of this.activeClearTimers.values()) clearTimeout(t);
    this.activeClearTimers.clear();
  }

  /** The map for a root, built now (blocking) if nothing has built it yet. Prefer getMapAsync where a promise is fine. */
  getMap(root: string): ProjectMap {
    const abs = resolve(root);
    const hit = this.cache.get(abs);
    if (hit) { this.remember(abs, hit); return hit.map; }
    this.building.add(abs);
    try {
      const t0 = Date.now();
      const built = this.buildSync(abs);
      this.store(abs, built, t0);
      return built.map;
    } finally {
      this.building.delete(abs);
    }
  }

  /** The map for a root, built in the background if needed (the event loop stays free while files are listed and read). */
  async getMapAsync(root: string): Promise<ProjectMap> {
    return (await this.ensure(resolve(root))).map;
  }

  getHistory(_root: string): Snapshot[] { return []; } // history/snapshots cut for the demo

  /** Internal: cached ProjectMap for a root, if it has been built. Used by the reader to attach summaries. */
  getCached(root: string): Cached | undefined { return this.cache.get(resolve(root)); }

  /** True while the map for `root` is being built for the first time (used by the setup checklist). */
  isBuilding(root: string): boolean { return this.building.has(resolve(root)); }

  /** React to the active workspace changing: watch the new root, build its map, broadcast it. */
  async switchRoot(root: string): Promise<ProjectMap> {
    const abs = resolve(root);
    if (this.live && this.live.root !== abs) this.stopWatch();
    this.activeRoot = abs;
    const c = await this.ensure(abs); // cache hit if something already built it (e.g. the reader)
    if (this.activeRoot === abs) {
      this.startWatch(abs, c);
      this.gateway.broadcast({ type: "map", map: c.map });
      this.log.log(`switched active map root to ${abs}: ${c.map.files.length} files, ${c.map.edges.length} edges, ${c.map.modules.length} modules`);
    }
    return c.map;
  }

  // ---- build ----

  private ensure(abs: string): Promise<Cached> {
    const hit = this.cache.get(abs);
    if (hit) { this.remember(abs, hit); return Promise.resolve(hit); }
    let p = this.inflight.get(abs);
    if (!p) {
      const t0 = Date.now();
      this.building.add(abs);
      p = this.buildAsync(abs)
        .then((built) => {
          const raced = this.cache.get(abs); // a blocking getMap() got there first
          if (raced) return raced;
          this.store(abs, built, t0);
          return built;
        })
        .finally(() => { this.inflight.delete(abs); this.building.delete(abs); });
      this.inflight.set(abs, p);
    }
    return p;
  }

  // A small project maps every file. Past the cap (select.ts): rank all files by agent activity and recency, read a
  // pool of twice the cap, then pick the final files with what reading tells (how many files import each, size).

  private async buildAsync(root: string): Promise<Cached> {
    const t0 = Date.now();
    const listing = await listProjectFiles(root, maxFiles());
    const listMs = Date.now() - t0;
    const readAll = async (rels: string[]) => (await mapLimit(rels, IO_CONCURRENCY, async (rel): Promise<Read | null> => {
      const abs = join(root, rel);
      try {
        const [buf, st] = await Promise.all([readFile(abs), stat(abs)]);
        return toRead(abs, buf, st.mtimeMs);
      } catch { return null; }
    })).filter((r): r is Read => !!r);
    if (listing.rels.length <= maxFiles()) return this.assemble(root, listing, await readAll(listing.rels), listMs);
    const sig = this.firstSignals(root, listing);
    const pool = await readAll(selectFiles(listing.rels, Math.min(listing.rels.length, 2 * maxFiles()), scoreFrom(sig)));
    return this.assemble(root, listing, this.chooseFromPool(root, sig, pool), listMs);
  }

  private buildSync(root: string): Cached {
    const t0 = Date.now();
    const listing = listProjectFilesSync(root, maxFiles());
    const listMs = Date.now() - t0;
    const readAll = (rels: string[]) => {
      const reads: Read[] = [];
      for (const rel of rels) {
        const abs = join(root, rel);
        try { reads.push(toRead(abs, readFileSync(abs), statSync(abs).mtimeMs)); } catch { /* gone or unreadable */ }
      }
      return reads;
    };
    if (listing.rels.length <= maxFiles()) return this.assemble(root, listing, readAll(listing.rels), listMs);
    const sig = this.firstSignals(root, listing);
    const pool = readAll(selectFiles(listing.rels, Math.min(listing.rels.length, 2 * maxFiles()), scoreFrom(sig)));
    return this.assemble(root, listing, this.chooseFromPool(root, sig, pool), listMs);
  }

  /** Before reading anything: when files changed (git, mtime, an agent's last step on it) and which ones agents touched. */
  private firstSignals(root: string, listing: Listing): Signals {
    const changedAt = new Map(listing.changedAt ?? []);
    const touched = this.agentFiles(root);
    for (const [rel, t] of touched) if (t > (changedAt.get(rel) ?? 0)) changedAt.set(rel, t);
    return { changedAt, touched: new Set(touched.keys()) };
  }

  /** The final files out of the pool, now that we know how central (imported by others in the pool) and big each one is. */
  private chooseFromPool(root: string, sig: Signals, pool: Read[]): Read[] {
    const poolSet = new Set(pool.map((r) => r.abs));
    const importedBy = new Map<string, number>();
    const lines = new Map<string, number>();
    const rels = pool.map((r) => {
      const rel = posix(relative(root, r.abs));
      lines.set(rel, r.lines);
      for (const to of this.resolveSpecs(r.abs, this.parseImports(r.abs, r.content), poolSet)) {
        const k = posix(relative(root, to));
        importedBy.set(k, (importedBy.get(k) ?? 0) + 1);
      }
      return rel;
    });
    const chosen = new Set(selectFiles(rels, maxFiles(), scoreFrom({ ...sig, importedBy, lines })));
    return pool.filter((_, i) => chosen.has(rels[i]));
  }

  /** Files agents touched in this project's threads (newest step time, s), from the steps the listener stored. */
  private agentFiles(root: string): Map<string, number> {
    const out = new Map<string, number>();
    if (!this.dbs) return out;
    try {
      const rows = this.dbs.db.prepare(`SELECT file_path AS p, MAX(ts) AS ts FROM steps WHERE file_path >= ? AND file_path < ? GROUP BY file_path`)
        .all(root + sep, root + sep + "￿") as { p: string; ts: string }[];
      for (const { p, ts } of rows) {
        const rel = posix(relative(root, p));
        if (isMappableRel(rel)) out.set(rel, (Date.parse(ts) || 0) / 1000);
      }
    } catch { /* no steps table yet */ }
    return out;
  }

  /** The map from the chosen files, already read: modules, imports, edges, times from mtime and any commit times known (the rest come later). */
  private assemble(root: string, listing: Listing, reads: Read[], listMs: number): Cached {
    const fileSet = new Set(reads.map((r) => r.abs));
    const nodes: FileNode[] = [];
    const byPath = new Map<string, FileNode>();
    const specs = new Map<string, string[]>();
    const mtimes = new Map<string, number>();
    const moduleIds = new Map<string, { id: string }>();
    const gitTimes = new Map<string, number>();
    const chosen = new Set<string>();
    for (const r of reads) {
      const rel = posix(relative(root, r.abs));
      chosen.add(rel);
      const moduleId = moduleOf(rel);
      if (!moduleIds.has(moduleId)) moduleIds.set(moduleId, { id: moduleId });
      const committed = listing.recent?.get(rel); // a big repo's ranking already read its recent history
      if (committed) gitTimes.set(rel, committed);
      const ms = Math.max(r.mtimeMs, (committed ?? 0) * 1000);
      const node: FileNode = { path: r.abs, module: moduleId, lines: r.lines, lastChangedAt: new Date(ms || Date.now()).toISOString() };
      nodes.push(node);
      byPath.set(r.abs, node);
      mtimes.set(r.abs, r.mtimeMs);
      specs.set(r.abs, this.parseImports(r.abs, r.content));
    }
    const out = new Map<string, Set<string>>();
    for (const [abs, s] of specs) out.set(abs, this.resolveSpecs(abs, s, fileSet));
    const unselected = new Set(listing.rels.filter((rel) => !chosen.has(rel)).map((rel) => join(root, rel)));
    const map: ProjectMap = { root, files: nodes, edges: [], modules: [...moduleIds.values()], formerRoots: formerRoots(this.cfg.claudeProjectsDir, root) };
    const c: Cached = {
      map, gitTimes, byPath, fileSet, specs, out, mtimes,
      tracked: listing.tracked && new Set([...chosen].filter((rel) => listing.tracked!.has(rel))),
      listing: { source: listing.source, total: listing.total, ms: listMs },
      unselected, uncounted: Math.max(0, listing.total - listing.rels.length), agentTouched: new Set(),
    };
    this.flattenEdges(c);
    this.countFiles(c);
    return c;
  }

  /** map.totalFiles: the files shown plus the ones the cap left out. */
  private countFiles(c: Cached) {
    c.map.totalFiles = c.map.files.length + c.unselected.size + c.uncounted;
  }

  private flattenEdges(c: Cached) {
    const edges: Edge[] = [];
    for (const [from, tos] of c.out) for (const to of tos) edges.push({ from, to });
    c.map.edges = edges;
  }

  /** Keep a built map, drop the least recently used ones past MAX_ROOTS, and start fetching commit times. */
  private store(abs: string, c: Cached, t0: number) {
    this.buildMs = Date.now() - t0;
    this.remember(abs, c);
    const capped = c.listing.total > c.map.files.length ? ` (${c.listing.total} found, capped at ${maxFiles()})` : "";
    this.log.log(`built map for ${abs}: ${c.map.files.length} files${capped}, ${c.map.edges.length} edges, ${c.map.modules.length} modules in ${this.buildMs}ms (listed with ${c.listing.source} in ${c.listing.ms}ms)`);
    this.loadGitTimes(abs, c).catch((e) => this.log.warn(`git times failed for ${abs}: ${(e as Error).message}`));
  }

  private remember(abs: string, c: Cached) {
    this.cache.delete(abs);
    this.cache.set(abs, c);
    for (const key of this.cache.keys()) {
      if (this.cache.size <= MAX_ROOTS) break;
      if (key === abs || key === this.activeRoot) continue;
      this.cache.delete(key);
      for (const dir of this.goModules.keys()) if (dir === key || dir.startsWith(key + sep)) this.goModules.delete(dir);
    }
  }

  // ---- imports ----

  private parseImports(file: string, content: string): string[] {
    const specs: string[] = [];
    if (!content) return specs;
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
  private resolveSpecs(abs: string, specs: string[], fileSet: Set<string>): Set<string> {
    const out = new Set<string>();
    for (const spec of specs) for (const to of this.resolveImport(abs, spec, fileSet)) if (to !== abs) out.add(to);
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

  /** Commit times arrive after the map was sent: fold them in (a file's time only moves forward) and resend the map. */
  private async loadGitTimes(root: string, c: Cached) {
    const wanted = new Set([...(c.tracked ?? [])].filter((rel) => !c.gitTimes.has(rel)));
    if (!wanted.size) return;
    const t0 = Date.now();
    const r = await gitLastCommitTimes(root, wanted);
    if (this.cache.get(root) !== c) return; // dropped or rebuilt meanwhile
    if (r.error) this.log.warn(`git log unavailable, keeping file times: ${r.error}`);
    for (const [rel, s] of r.times) c.gitTimes.set(rel, s);
    let changed = 0;
    for (const node of c.map.files) {
      const s = c.gitTimes.get(posix(relative(root, node.path)));
      if (!s) continue;
      const current = node.lastChangedAt ? Date.parse(node.lastChangedAt) : 0;
      if (s * 1000 > current) { node.lastChangedAt = new Date(s * 1000).toISOString(); changed++; }
    }
    this.log.log(`git times for ${root}: ${r.times.size}/${wanted.size} files from ${r.commits} commits in ${Date.now() - t0}ms${r.complete ? "" : " (stopped at the limit; the rest keep their file times)"}, ${changed} updated`);
    if (changed && root === this.activeRoot) this.gateway.broadcast({ type: "map", map: c.map });
  }

  private lastChangedAt(c: Cached, root: string, abs: string, mtimeMs: number): string {
    const gitSec = c.gitTimes.get(posix(relative(root, abs))) ?? 0;
    const ms = Math.max(mtimeMs, gitSec * 1000);
    return new Date(ms || Date.now()).toISOString();
  }

  // ---- live updates ----

  private startWatch(root: string, c: Cached) {
    if (this.live?.root === root) return;
    this.stopWatch();
    const folders = foldersToWatch(root, c.byPath.keys());
    const live: Live = {
      root, folders, pending: new Set(), running: false,
      batch: new Batcher<string>(BATCH_MS, (paths) => { this.enqueue(live, paths); this.bus.emit("files-changed", { root }); }),
      watcher: new ProjectWatcher(root, (p) => live.batch.add(p), (m) => this.log.warn(m)),
    };
    live.watcher.start(folders);
    this.live = live;
    this.log.log(`watching ${root} (${live.watcher.mode === "recursive" ? "one recursive watch" : `${live.watcher.handles} folders`})`);
  }

  private stopWatch() {
    if (!this.live) return;
    this.live.batch.cancel();
    this.live.watcher.close();
    this.live.pending.clear();
    this.live = undefined;
  }

  /** Apply batches one at a time; whatever arrives meanwhile is merged into the next one. */
  private enqueue(live: Live, paths: Set<string>) {
    for (const p of paths) live.pending.add(p);
    if (live.running) return;
    live.running = true;
    void (async () => {
      try {
        while (live.pending.size && this.live === live) {
          const batch = live.pending;
          live.pending = new Set();
          await this.applyBatch(live, batch).catch((e) => this.log.warn(`live map update failed: ${(e as Error).message}`));
        }
      } finally { live.running = false; }
    })();
  }

  /** One batch of changed paths: re-read changed files, add new ones (within the cap), drop deleted ones, then re-resolve imports once. */
  private async applyBatch(live: Live, paths: Set<string>) {
    const root = live.root;
    const c = this.cache.get(root);
    if (!c) return;
    const removed = new Set<string>();
    const files = new Map<string, number>(); // existing source files to (re)read → mtime
    const newFolders: string[] = [];

    await mapLimit([...paths], IO_CONCURRENCY, async (abs) => {
      const rel = relative(root, abs);
      let st;
      try { st = await stat(abs); } catch {
        c.unselected.delete(abs);
        if (c.byPath.has(abs)) removed.add(abs);
        else { // a folder went away (moved or deleted): everything mapped under it goes too
          const prefix = abs + sep;
          for (const p of c.byPath.keys()) if (p.startsWith(prefix)) removed.add(p);
          live.watcher.removeFolder(abs);
          live.folders.delete(abs);
        }
        return;
      }
      if (st.isDirectory()) { if (!live.folders.has(abs) && !isInIgnoredDir(rel)) newFolders.push(abs); }
      else if (st.isFile() && isMappableRel(rel)) files.set(abs, st.mtimeMs);
    });

    // New files, and the files of folders that appeared, while there is room for them.
    let room = maxFiles() + liveHeadroom() - (c.byPath.size - removed.size);
    for (const dir of newFolders) {
      for (const abs of await listFolder(dir, Math.max(0, room))) if (!files.has(abs)) {
        try { files.set(abs, (await stat(abs)).mtimeMs); } catch { /* gone */ }
      }
    }
    // Files an agent edited always join. Other new files join while there's room, except ones the first listing chose
    // to leave out (so a branch switch touching thousands of files doesn't refill a big repo's map at random).
    const agents = [...files.keys()].filter((abs) => !c.byPath.has(abs) && c.agentTouched.has(abs));
    let adds = [...files.keys()].filter((abs) => !c.byPath.has(abs) && !c.agentTouched.has(abs) && !c.unselected.has(abs)).sort();
    if (adds.length && c.tracked) { // a git repo: new files follow .gitignore, like the first listing
      const ignored = await gitIgnored(root, adds.map((abs) => posix(relative(root, abs))));
      if (ignored.size) adds = adds.filter((abs) => !ignored.has(posix(relative(root, abs))));
    }
    const accepted = new Set([...agents, ...adds.slice(0, Math.max(0, room - agents.length))]);
    for (const abs of adds) if (!accepted.has(abs)) c.unselected.add(abs); // no room: counted, not shown
    for (const abs of files.keys()) if (!c.byPath.has(abs) && !accepted.has(abs)) files.delete(abs);

    const reads = await mapLimit([...files], IO_CONCURRENCY, async ([abs, mtimeMs]): Promise<Read | null> => {
      try { return toRead(abs, await readFile(abs), mtimeMs); } catch { if (c.byPath.has(abs)) removed.add(abs); return null; }
    });
    if (this.cache.get(root) !== c || this.live !== live) return; // switched away meanwhile

    // Apply: removals, then updates and additions.
    for (const abs of removed) {
      c.byPath.delete(abs); c.fileSet.delete(abs); c.specs.delete(abs); c.out.delete(abs); c.mtimes.delete(abs);
    }
    if (removed.size) c.map.files = c.map.files.filter((f) => !removed.has(f.path));
    const changed = new Set<string>();
    let added = 0;
    for (const r of reads) {
      if (!r || removed.has(r.abs)) continue;
      const lastChangedAt = this.lastChangedAt(c, root, r.abs, r.mtimeMs);
      let node = c.byPath.get(r.abs);
      if (!node) {
        const moduleId = moduleOf(relative(root, r.abs));
        node = { path: r.abs, module: moduleId, lines: r.lines, lastChangedAt };
        c.byPath.set(r.abs, node); c.fileSet.add(r.abs); c.map.files.push(node); c.unselected.delete(r.abs);
        if (!c.map.modules.some((m) => m.id === moduleId)) c.map.modules.push({ id: moduleId });
        added++;
      } else {
        node.lines = r.lines;
        node.lastChangedAt = lastChangedAt;
      }
      c.mtimes.set(r.abs, r.mtimeMs);
      c.specs.set(r.abs, this.parseImports(r.abs, r.content));
      changed.add(r.abs);
    }

    // Imports: when files came or went, every file's imports may resolve differently; otherwise only the changed files'.
    const setChanged = added > 0 || removed.size > 0;
    if (setChanged) this.indexes.delete(c.fileSet);
    const edgesChanged = new Set<string>();
    for (const abs of setChanged ? c.specs.keys() : changed) {
      const next = this.resolveSpecs(abs, c.specs.get(abs) ?? [], c.fileSet);
      if (!sameSet(c.out.get(abs), next)) { c.out.set(abs, next); edgesChanged.add(abs); }
    }
    if (edgesChanged.size || removed.size) this.flattenEdges(c);
    this.countFiles(c);

    // Keep watching where the map now has files (folder mode).
    if (added) for (const d of foldersToWatch(root, [...changed].filter((p) => !live.folders.has(dirname(p))))) {
      if (!live.folders.has(d)) { live.folders.add(d); live.watcher.addFolder(d); }
    }
    for (const d of newFolders) if (!live.folders.has(d)) { live.folders.add(d); live.watcher.addFolder(d); }

    // Tell the web: one message per file, or the whole map when a lot changed at once.
    const touched = new Set([...changed, ...edgesChanged]);
    if (touched.size + removed.size > MAP_BROADCAST_OVER) {
      this.broadcastMapSoon(root);
    } else {
      for (const abs of removed) this.gateway.broadcast({ type: "file-removed", path: abs });
      for (const abs of touched) {
        const node = c.byPath.get(abs);
        if (node) this.gateway.broadcast({ type: "file", file: node, edges: [...(c.out.get(abs) ?? [])].map((to) => ({ from: abs, to })) });
      }
    }
    // An agent's edit that arrived before its file was on the map: show it now.
    for (const abs of changed) {
      const touch = this.pendingTouches.get(abs);
      if (touch) { this.pendingTouches.delete(abs); this.onFileTouched(root, abs, touch.sessionId, touch.ts); }
    }
  }

  /** Send the active root's whole map now, or once MAP_BROADCAST_GAP_MS has passed since the last one (always the current map). */
  private broadcastMapSoon(root: string) {
    const b = this.mapBroadcast;
    if (b.timer) return;
    const send = () => {
      b.timer = undefined;
      b.last = Date.now();
      const c = this.cache.get(root);
      if (c && root === this.activeRoot) this.gateway.broadcast({ type: "map", map: c.map });
    };
    const wait = b.last + MAP_BROADCAST_GAP_MS - Date.now();
    if (wait <= 0) send(); else b.timer = setTimeout(send, wait);
  }

  private onFileTouched(root: string, path: string, sessionId: string, ts: string) {
    const abs = resolve(root);
    const cached = this.cache.get(abs);
    if (!cached) return;
    const node = cached.byPath.get(path);
    if (!node) {
      // Not on the map (the cap left it out, or it's being created): it joins with the next batch, whatever the cap.
      if (this.live?.root !== abs || !isMappableRel(relative(abs, path))) return;
      cached.agentTouched.add(path);
      if (this.pendingTouches.size > 1000) this.pendingTouches.clear();
      this.pendingTouches.set(path, { sessionId, ts });
      this.live.batch.add(path);
      return;
    }
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
