import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from "@nestjs/common";
import { existsSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import type { FileNode, ProjectMap } from "../shared/contract";
import { BusService } from "../core/bus.service";
import { EventsGateway } from "../core/events.gateway";
import { WorkspaceState } from "../core/workspace-state";
import { ConfigService } from "../core/config.service";
import { DbService } from "../core/db.service";
import { formerRoots } from "../listener/moved";
import { maxFiles, mappableRel, moduleOf } from "./ignore";
import { type Listing, listProjectFiles } from "./list-files";
import { type Signals, scoreFrom, selectFiles } from "./select";
import { gitLastCommitTimes } from "./git-times";
import { readMapped } from "./read-file";
import { ImportResolver, parseImports } from "./imports";
import { type Cached, type Read, IO_CONCURRENCY, LiveMap, countFiles, fillSnapshots, flattenEdges, mapLimit, posix } from "./live";
import { Presence } from "./presence";

export { jsImports, stripComments } from "./imports";

// The project map: list the project's files (git, else a walk), read them, imports → edges (imports.ts), lastChangedAt
// from mtime then git, then keep the open project's map live (live.ts) and show where agents work (presence.ts).

/** Maps kept in memory, one per project root (the active one is never dropped). */
const MAX_ROOTS = 4;

/** How long one file may take to read before it's left out of the map. */
const READ_MS = 2_000;
/** The promise's value, or null once `ms` passed (the read carries on in the background and is ignored). */
function within<T>(ms: number, p: Promise<T>): Promise<T | null> {
  let t: NodeJS.Timeout;
  return Promise.race([p, new Promise<null>((r) => { t = setTimeout(() => r(null), ms); })]).finally(() => clearTimeout(t));
}

/** The map's ignore rule for a project: a git repo's .gitignore'd folders (plus .git and caches), else the name list. */
const mappable = mappableRel;

// List the project's files (git, else a walk), imports → edges, lastChangedAt from mtime then git, watch for changes.
@Injectable()
export class MapperService implements OnModuleInit, OnModuleDestroy {
  private log = new Logger("Mapper");
  /** Built maps by root, least recently used first (bounded by MAX_ROOTS). */
  private cache = new Map<string, Cached>();
  private inflight = new Map<string, Promise<Cached>>();
  private imports = new ImportResolver();
  private building = new Set<string>();
  /** The workspace's active root: the one we keep a live watch on (owner: S). */
  private activeRoot?: string;
  buildMs = 0;
  /** Where agents work now (marks on files). */
  private presence: Presence;
  /** The active root's map, kept live. */
  private live: LiveMap;

  constructor(private bus: BusService, private gateway: EventsGateway, private cfg: ConfigService, private state: WorkspaceState, @Optional() private dbs?: DbService) {
    const cached = (root: string) => this.cache.get(root);
    const activeRoot = () => this.activeRoot;
    this.presence = new Presence(gateway, { cached, activeRoot, liveRoot: () => this.live.root, addToBatch: (p) => this.live.add(p) });
    this.live = new LiveMap({ cached, activeRoot }, this.imports, this.presence, bus, gateway, this.log);
  }

  onModuleInit() {
    // Build + watch the default root right away (in the background) so live updates and the reader have something to work with.
    const root = resolve(this.state.root);
    this.activeRoot = root;
    // No project chosen yet (the plugin's placeholder doesn't exist): nothing to build or watch until one is.
    if (existsSync(root)) this.ensure(root).then((c) => { if (this.activeRoot === root) this.live.start(root, c); }).catch((e) => this.log.warn(`map build failed for ${root}: ${(e as Error).message}`));
    this.bus.on("file-touched", ({ path, sessionId, ts }) => this.presence.touched(this.state.root, path, sessionId, ts));
    this.bus.on("workspace", ({ root }) => { this.switchRoot(root).catch((e) => this.log.warn(`switching the map to ${root} failed: ${(e as Error).message}`)); });
  }

  onModuleDestroy() {
    this.live.close();
    this.presence.clear();
  }

  /** The map for a root, built in the background if needed (the event loop stays free while files are listed and read). */
  async getMapAsync(root: string): Promise<ProjectMap> {
    return (await this.ensure(resolve(root))).map;
  }

  /** For tests: the built map's internals for a root, if it has been built. Other modules ask stats(). */
  getCached(root: string): Cached | undefined { return this.cache.get(resolve(root)); }

  /** The map's size for a root once it's built (the setup checklist): files shown and in the project, imports, modules. */
  stats(root: string): { files: number; totalFiles: number; edges: number; modules: number } | undefined {
    const m = this.cache.get(resolve(root))?.map;
    return m && { files: m.files.length, totalFiles: m.totalFiles ?? m.files.length, edges: m.edges.length, modules: m.modules.length };
  }

  /** True while the map for `root` is being built for the first time (used by the setup checklist). */
  isBuilding(root: string): boolean { return this.building.has(resolve(root)); }

  /** React to the active workspace changing: watch the new root, build its map, broadcast it. */
  async switchRoot(root: string): Promise<ProjectMap> {
    const abs = resolve(root);
    if (this.live.root !== undefined && this.live.root !== abs) this.live.stop();
    if (this.activeRoot !== abs) this.presence.clear(); // the old project's "working on it" marks would otherwise linger in its cached map
    this.activeRoot = abs;
    const c = await this.ensure(abs); // cache hit if something already built it (e.g. the reader)
    if (this.activeRoot === abs) {
      this.live.start(abs, c);
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
        .then((built) => { this.store(abs, built, t0); return built; })
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
    // A read that takes too long (a file kept only in the cloud, downloading as it's opened) is left out and counted:
    // one slow file doesn't hold the map up.
    let unread = 0;
    const readAll = async (rels: string[]) => (await mapLimit(rels, IO_CONCURRENCY, async (rel): Promise<Read | null> => {
      const abs = join(root, rel);
      const got = await within(READ_MS, readMapped(abs, root).then((r) => ({ r })));
      if (!got) { unread++; return null; }
      return got.r && { abs, ...got.r };
    })).filter((r): r is Read => !!r);
    const done = (c: Cached) => { if (unread) c.map.unread = unread; return c; };
    if (listing.rels.length <= maxFiles()) return done(this.assemble(root, listing, await readAll(listing.rels), listMs));
    const sig = this.firstSignals(root, listing);
    const pool = await readAll(selectFiles(listing.rels, Math.min(listing.rels.length, 2 * maxFiles()), scoreFrom(sig)));
    return done(this.assemble(root, listing, this.chooseFromPool(root, sig, pool), listMs));
  }

  /** Before reading anything: when files changed (git, mtime, an agent's last step on it) and which ones agents touched. */
  private firstSignals(root: string, listing: Listing): Signals {
    const changedAt = new Map(listing.changedAt ?? []);
    const touched = this.agentFiles(root, listing.source === "git" ? listing.ignoredDirs ?? new Set() : undefined);
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
      for (const to of this.imports.resolveSpecs(root, r.abs, parseImports(r.abs, r.content), poolSet)) {
        const k = posix(relative(root, to));
        importedBy.set(k, (importedBy.get(k) ?? 0) + 1);
      }
      return rel;
    });
    const chosen = new Set(selectFiles(rels, maxFiles(), scoreFrom({ ...sig, importedBy, lines })));
    return pool.filter((_, i) => chosen.has(rels[i]));
  }

  /** Files agents touched in this project's threads (newest step time, s), from the steps the listener stored. */
  private agentFiles(root: string, ignoredDirs?: Set<string>): Map<string, number> {
    const out = new Map<string, number>();
    if (!this.dbs) return out;
    try {
      const rows = this.dbs.db.prepare(`SELECT file_path AS p, MAX(ts) AS ts FROM steps WHERE file_path >= ? AND file_path < ? GROUP BY file_path`)
        .all(root + sep, root + sep + "￿") as { p: string; ts: string }[];
      for (const { p, ts } of rows) {
        const rel = posix(relative(root, p));
        if (mappable(rel, ignoredDirs)) out.set(rel, (Date.parse(ts) || 0) / 1000);
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
      specs.set(r.abs, parseImports(r.abs, r.content));
    }
    const out = new Map<string, Set<string>>();
    for (const [abs, s] of specs) out.set(abs, this.imports.resolveSpecs(root, abs, s, fileSet));
    const unselected = new Set(listing.rels.filter((rel) => !chosen.has(rel)).map((rel) => join(root, rel)));
    const map: ProjectMap = { root, files: nodes, edges: [], modules: [...moduleIds.values()], formerRoots: formerRoots(this.cfg.claudeProjectsDir, root), ...(listing.stopped ? { scanStopped: true } : {}) };
    const c: Cached = {
      map, gitTimes, byPath, fileSet, specs, out,
      tracked: listing.tracked && new Set([...chosen].filter((rel) => listing.tracked!.has(rel))),
      ignoredDirs: listing.source === "git" ? listing.ignoredDirs ?? new Set() : undefined,
      listing: { source: listing.source, total: listing.total, ms: listMs },
      unselected, uncounted: Math.max(0, listing.total - listing.rels.length), agentTouched: new Set(), snapshots: new Map(),
    };
    flattenEdges(c);
    countFiles(c);
    fillSnapshots(c, reads);
    return c;
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
    this.bus.emit("map-rules", { root: abs, ignoredDirs: c.ignoredDirs });
    for (const key of this.cache.keys()) {
      if (this.cache.size <= MAX_ROOTS) break;
      if (key === abs || key === this.activeRoot) continue;
      this.cache.delete(key);
      this.imports.forgetRoot(key);
    }
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
}
