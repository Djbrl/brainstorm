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
  "node_modules", ".git", "dist", "out", "data", ".claude", ".vercel",
  "__pycache__", ".venv", "venv", ".next", ".turbo", "coverage", ".cache",
]);
const LOCKFILES = new Set(["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "Cargo.lock", "poetry.lock", "composer.lock"]);
const SOURCE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".py", ".md", ".json", ".css", ".html"]);
const MAX_FILES = 800;

type Cached = { map: ProjectMap; gitTimes: Map<string, number>; byPath: Map<string, FileNode> };

// Owner: B. Walk the project, imports → edges, lastChangedAt from git + mtime, watch for changes.
@Injectable()
export class MapperService implements OnModuleInit {
  private log = new Logger("Mapper");
  private cache = new Map<string, Cached>();
  private watchers = new Map<string, FSWatcher>();
  private activeClearTimers = new Map<string, NodeJS.Timeout>();
  buildMs = 0;

  constructor(private bus: BusService, private gateway: EventsGateway, private cfg: ConfigService) {}

  onModuleInit() {
    // Build + watch the default root eagerly so live updates and the reader have something to work with.
    this.getMap(this.cfg.defaultRoot);
    this.watch(this.cfg.defaultRoot);
    this.bus.on("file-touched", ({ path, sessionId, ts }) => this.onFileTouched(this.cfg.defaultRoot, path, sessionId, ts));
  }

  getMap(root: string): ProjectMap {
    const abs = resolve(root);
    const existing = this.cache.get(abs);
    if (existing) return existing.map;
    const t0 = Date.now();
    const built = this.buildMap(abs);
    this.buildMs = Date.now() - t0;
    this.cache.set(abs, built);
    this.log.log(`built map for ${abs}: ${built.map.files.length} files, ${built.map.edges.length} edges, ${built.map.modules.length} modules in ${this.buildMs}ms`);
    return built.map;
  }

  getHistory(_root: string): Snapshot[] { return []; } // history/snapshots cut for the demo

  /** Internal: cached ProjectMap for a root, if it has been built. Used by the reader to attach summaries. */
  getCached(root: string): Cached | undefined { return this.cache.get(resolve(root)); }

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

      for (const spec of this.parseImports(abs, content)) {
        const to = this.resolveImport(abs, spec, fileSet);
        if (to) edges.push({ from: abs, to });
      }
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
    if ([".ts", ".tsx", ".js", ".jsx"].includes(ext)) {
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

  private resolveImport(fromFile: string, spec: string, fileSet: Set<string>): string | undefined {
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

    // Recompute this file's outgoing edges.
    cached.map.edges = cached.map.edges.filter((e) => e.from !== abs);
    const fileSet = new Set(cached.map.files.map((f) => f.path));
    for (const spec of this.parseImports(abs, content)) {
      const to = this.resolveImport(abs, spec, fileSet);
      if (to) cached.map.edges.push({ from: abs, to });
    }

    this.gateway.broadcast({ type: "file", file: node });
  }

  private remove(root: string, abs: string) {
    const cached = this.cache.get(root);
    if (!cached) return;
    cached.byPath.delete(abs);
    cached.map.files = cached.map.files.filter((f) => f.path !== abs);
    cached.map.edges = cached.map.edges.filter((e) => e.from !== abs && e.to !== abs);
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
