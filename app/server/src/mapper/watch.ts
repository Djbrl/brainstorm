// Watching the project for live map updates, cheaply.
//
// macOS and Windows: one recursive fs.watch on the root (FSEvents / ReadDirectoryChangesW: a single handle for the
// whole tree). Elsewhere (Linux), a recursive watch means one inotify watch per folder of the whole tree, node_modules
// included, so instead we watch only the folders that hold mapped files, plus the folders above them (so a new
// subfolder is noticed and added). Every event goes through the map's ignore rule before anything else happens, and
// paths are handed over in batches.
import { watch, type FSWatcher } from "node:fs";
import { join, relative, sep } from "node:path";
import { isInIgnoredDir } from "./ignore";

/** Collects items and hands them over together, at most `delayMs` after the first one arrived. */
export class Batcher<T> {
  private items = new Set<T>();
  private timer?: NodeJS.Timeout;
  constructor(private delayMs: number, private onFlush: (items: Set<T>) => void) {}
  add(item: T) {
    this.items.add(item);
    this.timer ??= setTimeout(() => this.flush(), this.delayMs);
  }
  get size() { return this.items.size; }
  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.items.size) return;
    const items = this.items;
    this.items = new Set();
    this.onFlush(items);
  }
  cancel() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.items.clear();
  }
}

export type WatchMode = "recursive" | "folders";

/** The platform's cheap mode. BRAINSTORM_MAP_WATCH=folders|recursive overrides it (for testing). */
export function defaultWatchMode(): WatchMode {
  const forced = process.env.BRAINSTORM_MAP_WATCH;
  if (forced === "folders" || forced === "recursive") return forced;
  return process.platform === "darwin" || process.platform === "win32" ? "recursive" : "folders";
}

/** Every folder from each file's folder up to the root (the root included). */
export function foldersToWatch(root: string, files: Iterable<string>): Set<string> {
  const out = new Set<string>([root]);
  for (const f of files) {
    let d = f.slice(0, f.lastIndexOf(sep));
    while (d.length > root.length && !out.has(d)) { out.add(d); d = d.slice(0, d.lastIndexOf(sep)); }
  }
  return out;
}

export class ProjectWatcher {
  private recursive?: FSWatcher;
  private folders = new Map<string, FSWatcher>();
  private closed = false;
  private warned = false;
  mode: WatchMode;

  /** `onPath` gets absolute paths that may belong on the map (ignored folders already filtered out). */
  constructor(private root: string, private onPath: (abs: string) => void, private log: (msg: string) => void, mode = defaultWatchMode()) {
    this.mode = mode;
  }

  /** Start watching. `dirs` are the folders to watch in "folders" mode (see foldersToWatch); ignored in "recursive" mode. */
  start(dirs: Iterable<string>) {
    if (this.mode === "recursive") {
      try {
        this.recursive = watch(this.root, { recursive: true, persistent: true }, (_e, name) => {
          if (!name) return;
          const rel = name.toString();
          if (!isInIgnoredDir(rel)) this.onPath(join(this.root, rel)); // node_modules churn etc. stops here: a string check
        });
        this.recursive.on("error", (e) => { this.log(`recursive watch failed (${e.message}), watching folders instead`); this.recursive?.close(); this.recursive = undefined; this.mode = "folders"; this.start(dirs); });
        return;
      } catch (e) {
        this.log(`recursive watch unavailable (${(e as Error).message}), watching folders instead`);
        this.mode = "folders";
      }
    }
    for (const d of dirs) this.addFolder(d);
  }

  /** "folders" mode: also watch this folder (a new one, or one that now holds a mapped file). No-op in recursive mode. */
  addFolder(dir: string) {
    if (this.closed || this.mode !== "folders" || this.folders.has(dir)) return;
    const rel = relative(this.root, dir);
    if (rel && isInIgnoredDir(rel)) return;
    try {
      const w = watch(dir, { persistent: true }, (_e, name) => { if (name) this.onFolderEvent(dir, name.toString()); });
      w.on("error", () => { w.close(); this.folders.delete(dir); }); // the folder went away
      this.folders.set(dir, w);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") return;
      if (!this.warned) { this.warned = true; this.log(`can't watch more folders (${code ?? (e as Error).message}); some live updates may be missed`); }
    }
  }

  /** "folders" mode: stop watching a folder (and everything under it), e.g. after it was deleted. */
  removeFolder(dir: string) {
    for (const [d, w] of this.folders) if (d === dir || d.startsWith(dir + sep)) { w.close(); this.folders.delete(d); }
  }

  private onFolderEvent(dir: string, name: string) {
    const abs = join(dir, name);
    const rel = relative(this.root, abs);
    if (!isInIgnoredDir(rel)) this.onPath(abs);
  }

  /** How many OS watch handles this uses. */
  get handles() { return this.recursive ? 1 : this.folders.size; }

  close() {
    this.closed = true;
    this.recursive?.close();
    this.recursive = undefined;
    for (const w of this.folders.values()) w.close();
    this.folders.clear();
  }
}
