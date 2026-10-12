import type { Logger } from "@nestjs/common";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { lstat, stat } from "node:fs/promises";
import { basename, dirname, relative, sep } from "node:path";
import type { Edge, FileNode, ProjectMap } from "../shared/contract";
import type { BusService } from "../core/bus.service";
import type { EventsGateway } from "../core/events.gateway";
import { liveHeadroom, maxFiles, mappableRel as mappable, moduleOf, skippedRel as skipped } from "./ignore";
import { type Listing, gitIgnored, listFolder } from "./list-files";
import { readMapped } from "./read-file";
import { Batcher, ProjectWatcher, foldersToWatch } from "./watch";
import { parseImports, type ImportResolver } from "./imports";
import type { Presence } from "./presence";

// The built map as kept in memory, and keeping the open project's map live: its folders watched, changed paths
// applied a batch at a time (files read again, added within the cap, dropped; imports resolved again), the pages told.

export type Read = { abs: string; lines: number; content: string; mtimeMs: number };
export type Cached = {
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
  /** Mapped files git tracks (relative, "/" separators); undefined when not a git repo. */
  tracked?: Set<string>;
  /** A git repo: what to leave out comes from .gitignore. These are the folders it excludes (relative, "/" separators), grown as new ones appear. */
  ignoredDirs?: Set<string>;
  listing: Pick<Listing, "source" | "total"> & { ms: number };
  /** Files the cap left out (absolute). A change to one doesn't put it on the map (a branch switch would flood it); an agent's edit does. */
  unselected: Set<string>;
  /** Mappable files never even listed (a giant repo past the candidate limit), for totalFiles. */
  uncounted: number;
  /** Files an agent edited while this map was live: they join the map whatever the cap. */
  agentTouched: Set<string>;
  /** Each file's content as last read (deflated; files up to MAX_PARSE_BYTES), so a change can say what it was before:
   * how a file a command rewrote gets its diff (listener/command-edits.ts). A few MB for a 3,000-file map. */
  snapshots: Map<string, Buffer>;
};
type Live = { root: string; watcher: ProjectWatcher; batch: Batcher<string>; pending: Set<string>; running: boolean; folders: Set<string> };

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
export const IO_CONCURRENCY = 32;
/** Work on a batch's files gives the loop back after this long (a branch switch changes thousands at once). */
export const SLICE_MS = 15;

/** A clock for slicing a long loop: `await slice.due()` yields to the loop once SLICE_MS has passed since the last time. */
export function slicer(ms = SLICE_MS) {
  let since = performance.now();
  return {
    async due(): Promise<boolean> {
      if (performance.now() - since < ms) return false;
      await new Promise<void>((r) => setImmediate(r));
      since = performance.now();
      return true;
    },
  };
}

export const posix = (rel: string) => (sep === "/" ? rel : rel.split(sep).join("/"));

const sameSet = (a: Set<string> | undefined, b: Set<string>) => !!a && a.size === b.size && [...a].every((x) => b.has(x));

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

/** map.totalFiles: the files shown plus the ones the cap left out. */
export function countFiles(c: Cached) {
  c.map.totalFiles = c.map.files.length + c.unselected.size + c.uncounted;
}

export function flattenEdges(c: Cached) {
  const edges: Edge[] = [];
  for (const [from, tos] of c.out) for (const to of tos) edges.push({ from, to });
  c.map.edges = edges;
}

/** Keep each file's content, a slice at a time after the map is out (compressing 3,000 files takes ~100 ms). */
export function fillSnapshots(c: Cached, reads: Read[]) {
  let i = 0;
  const step = () => {
    for (const end = Math.min(reads.length, i + 300); i < end; i++) {
      const r = reads[i];
      if (r.content && c.byPath.has(r.abs) && !c.snapshots.has(r.abs)) c.snapshots.set(r.abs, deflateRawSync(r.content, { level: 1 }));
    }
    if (i < reads.length) setImmediate(step);
  };
  setImmediate(step);
}

/** What a file was when last read, deflated: "" for one that wasn't there, null when unknown (too big, or not kept yet). */
function snapshotOf(c: Cached, abs: string, known: boolean): Buffer | "" | null {
  return c.snapshots.get(abs) ?? (known ? null : "");
}

const inflated = (z: Buffer | "" | null) => (z === null || z === "" ? z : inflateRawSync(z).toString("utf8"));

/** A "file-content" event: the path and time, with what the file was and is read only when asked (a command that
 * names the file: listener/command-edits.ts), from the deflated snapshots it keeps. `bytes` is what it holds. */
export function fileChange(path: string, at: number, before: Buffer | "" | null, after: Buffer | null) {
  return {
    path, at, bytes: (before ? before.length : 0) + (after ? after.length : 0),
    get before() { return inflated(before); },
    get after() { return inflated(after); },
  };
}

function lastChangedAt(c: Cached, root: string, abs: string, mtimeMs: number): string {
  const gitSec = c.gitTimes.get(posix(relative(root, abs))) ?? 0;
  const ms = Math.max(mtimeMs, gitSec * 1000);
  return new Date(ms || Date.now()).toISOString();
}

/** What the live map needs from the mapper. */
export interface LiveHost {
  /** The built map of a root, if any. */
  cached(root: string): Cached | undefined;
  /** The open project's root (only its map is sent whole). */
  activeRoot(): string | undefined;
}

/** What a batch's paths turned out to be. */
type Sorted = { removed: Set<string>; files: Map<string, number>; newFolders: string[] };

export class LiveMap {
  private live?: Live;
  private mapBroadcast: { last: number; timer?: NodeJS.Timeout } = { last: 0 };

  constructor(
    private host: LiveHost,
    private imports: ImportResolver,
    private presence: Presence,
    private bus: BusService,
    private gateway: EventsGateway,
    private log: Logger,
  ) {}

  /** The root being watched, if any. */
  get root(): string | undefined { return this.live?.root; }

  /** Put a path in the next batch (an agent's edit to a file not on the map yet). */
  add(path: string) { this.live?.batch.add(path); }

  start(root: string, c: Cached) {
    if (this.live?.root === root) return;
    this.stop();
    const folders = foldersToWatch(root, c.byPath.keys());
    const live: Live = {
      root, folders, pending: new Set(), running: false,
      batch: new Batcher<string>(BATCH_MS, (paths) => { this.enqueue(live, paths); this.bus.emit("files-changed", { root }); }),
      watcher: new ProjectWatcher(root, (p) => live.batch.add(p), (m) => this.log.warn(m), undefined, (rel) => skipped(rel, c.ignoredDirs)),
    };
    live.watcher.start(folders);
    this.live = live;
    this.log.log(`watching ${root} (${live.watcher.mode === "recursive" ? "one recursive watch" : `${live.watcher.handles} folders`})`);
  }

  stop() {
    if (!this.live) return;
    this.live.batch.cancel();
    this.live.watcher.close();
    this.live.pending.clear();
    this.live = undefined;
  }

  /** Stops the watch and a "map" message waiting to go out. */
  close() {
    this.stop();
    if (this.mapBroadcast.timer) clearTimeout(this.mapBroadcast.timer);
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
    const c = this.host.cached(root);
    if (!c) return;
    const sorted = await this.sortPaths(live, c, paths);
    await this.admitNewFiles(c, root, sorted);
    const reads = await this.readFiles(c, root, sorted);
    if (this.host.cached(root) !== c || this.live !== live) return; // switched away meanwhile

    // Apply: removals, then updates and additions. Each change goes on the bus with what the file was before. The
    // reads and the imports are worked through in slices (slicer): the map may be switched away between them.
    const at = Date.now();
    const { removed, newFolders } = sorted;
    const gone = () => this.host.cached(root) !== c || this.live !== live;
    this.applyRemovals(c, removed, at);
    const { changed, added } = await this.applyReads(c, root, reads, removed, at);
    if (gone()) return;
    const edgesChanged = await this.resolveAgain(c, root, paths, changed, added, removed);
    if (gone()) return;
    countFiles(c);
    this.watchNewFolders(live, root, added, changed, newFolders);
    this.tellPages(c, root, changed, edgesChanged, removed);
    this.presence.joined(root, changed);
  }

  /** What each changed path is now: gone (with what was mapped under it), a mappable file (its mtime), a new folder
   * (one .gitignore excludes is remembered and left alone). */
  private async sortPaths(live: Live, c: Cached, paths: Set<string>): Promise<Sorted> {
    const root = live.root;
    const removed = new Set<string>();
    const files = new Map<string, number>(); // existing source files to (re)read → mtime
    let newFolders: string[] = [];
    await mapLimit([...paths], IO_CONCURRENCY, async (abs) => {
      const rel = relative(root, abs);
      let st;
      try {
        st = await lstat(abs);
        // A link to a folder isn't a new folder to map (it can lead out of the project; git and the walk don't follow
        // folder links either). A link to a file is read only if it stays inside (read-file.ts).
        if (st.isSymbolicLink()) { st = await stat(abs); if (st.isDirectory()) return; }
      } catch {
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
      if (st.isDirectory()) { if (!live.folders.has(abs) && !skipped(rel, c.ignoredDirs)) newFolders.push(abs); }
      else if (st.isFile() && mappable(rel, c.ignoredDirs)) files.set(abs, st.mtimeMs);
    });
    if (newFolders.length && c.ignoredDirs) { // a git repo: a new folder .gitignore excludes (a fresh build/) is remembered and left alone
      const ignored = await gitIgnored(root, newFolders.map((abs) => posix(relative(root, abs))));
      for (const rel of ignored) c.ignoredDirs.add(rel.replace(/\/$/, ""));
      if (ignored.size) newFolders = newFolders.filter((abs) => !ignored.has(posix(relative(root, abs))));
    }
    return { removed, files, newFolders };
  }

  /** New files, and the files of folders that appeared, while there is room for them: `files` keeps the ones that join
   * (and the mapped ones that changed). */
  private async admitNewFiles(c: Cached, root: string, { removed, files, newFolders }: Sorted) {
    const room = maxFiles() + liveHeadroom() - (c.byPath.size - removed.size);
    for (const dir of newFolders) {
      for (const abs of await listFolder(dir, Math.max(0, room), !!c.ignoredDirs)) if (!files.has(abs)) {
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
  }

  /** Read the files that changed or join; one that can't be read any more is removed. */
  private readFiles(c: Cached, root: string, { removed, files }: Sorted): Promise<(Read | null)[]> {
    return mapLimit([...files.keys()], IO_CONCURRENCY, async (abs): Promise<Read | null> => {
      const r = await readMapped(abs, root);
      if (!r) { if (c.byPath.has(abs)) removed.add(abs); return null; }
      return { abs, ...r };
    });
  }

  private applyRemovals(c: Cached, removed: Set<string>, at: number) {
    this.presence.clear(removed);
    for (const abs of removed) {
      this.bus.emit("file-content", fileChange(abs, at, snapshotOf(c, abs, true), null));
      c.snapshots.delete(abs);
      c.byPath.delete(abs); c.fileSet.delete(abs); c.specs.delete(abs); c.out.delete(abs);
    }
    if (removed.size) c.map.files = c.map.files.filter((f) => !removed.has(f.path));
  }

  /** Files read: updated in place, or added to the map (and its modules); their imports read again. */
  private async applyReads(c: Cached, root: string, reads: (Read | null)[], removed: Set<string>, at: number): Promise<{ changed: Set<string>; added: number }> {
    const changed = new Set<string>();
    let added = 0;
    const slice = slicer();
    for (const r of reads) {
      await slice.due();
      if (!r || removed.has(r.abs)) continue;
      if (r.content) {
        const before = snapshotOf(c, r.abs, c.byPath.has(r.abs) || c.unselected.has(r.abs));
        const after = deflateRawSync(r.content, { level: 1 }); // deflate is deterministic: same bytes, same content
        if (!(before instanceof Buffer && before.equals(after))) this.bus.emit("file-content", fileChange(r.abs, at, before, after));
        c.snapshots.set(r.abs, after);
      }
      const changedAt = lastChangedAt(c, root, r.abs, r.mtimeMs);
      let node = c.byPath.get(r.abs);
      if (!node) {
        const moduleId = moduleOf(relative(root, r.abs));
        node = { path: r.abs, module: moduleId, lines: r.lines, lastChangedAt: changedAt };
        c.byPath.set(r.abs, node); c.fileSet.add(r.abs); c.map.files.push(node); c.unselected.delete(r.abs);
        if (!c.map.modules.some((m) => m.id === moduleId)) c.map.modules.push({ id: moduleId });
        added++;
      } else {
        node.lines = r.lines;
        node.lastChangedAt = changedAt;
      }
      c.specs.set(r.abs, parseImports(r.abs, r.content));
      changed.add(r.abs);
    }
    return { changed, added };
  }

  /** Imports: when files came or went, every file's imports may resolve differently; otherwise only the changed files'.
   * A tsconfig changed: its aliases are read again and every import is resolved again. Returns the files whose
   * imports changed. */
  private async resolveAgain(c: Cached, root: string, paths: Set<string>, changed: Set<string>, added: number, removed: Set<string>): Promise<Set<string>> {
    const configChanged = [...paths].some((p) => /^[tj]sconfig.*\.json$/.test(basename(p)));
    if (configChanged) this.imports.configsChanged();
    const setChanged = added > 0 || removed.size > 0 || configChanged;
    if (setChanged) this.imports.filesChanged(c.fileSet);
    const edgesChanged = new Set<string>();
    const slice = slicer();
    for (const abs of [...(setChanged ? c.specs.keys() : changed)]) {
      if (await slice.due() && !c.specs.has(abs)) continue; // removed meanwhile
      const next = this.imports.resolveSpecs(root, abs, c.specs.get(abs) ?? [], c.fileSet);
      if (!sameSet(c.out.get(abs), next)) { c.out.set(abs, next); edgesChanged.add(abs); }
    }
    if (edgesChanged.size || removed.size) flattenEdges(c);
    return edgesChanged;
  }

  /** Keep watching where the map now has files (folder mode): when files joined, the folders of the files read; and
   * new folders. */
  private watchNewFolders(live: Live, root: string, added: number, changed: Set<string>, newFolders: string[]) {
    if (added) for (const d of foldersToWatch(root, [...changed].filter((p) => !live.folders.has(dirname(p))))) {
      if (!live.folders.has(d)) { live.folders.add(d); live.watcher.addFolder(d); }
    }
    for (const d of newFolders) if (!live.folders.has(d)) { live.folders.add(d); live.watcher.addFolder(d); }
  }

  /** Tell the web: one message per file, or the whole map when a lot changed at once. */
  private tellPages(c: Cached, root: string, changed: Set<string>, edgesChanged: Set<string>, removed: Set<string>) {
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
  }

  /** Send the active root's whole map now, or once MAP_BROADCAST_GAP_MS has passed since the last one (always the current map). */
  private broadcastMapSoon(root: string) {
    const b = this.mapBroadcast;
    if (b.timer) return;
    const send = () => {
      b.timer = undefined;
      b.last = Date.now();
      const c = this.host.cached(root);
      if (c && root === this.host.activeRoot()) this.gateway.broadcast({ type: "map", map: c.map });
    };
    const wait = b.last + MAP_BROADCAST_GAP_MS - Date.now();
    if (wait <= 0) send(); else b.timer = setTimeout(send, wait);
  }
}
