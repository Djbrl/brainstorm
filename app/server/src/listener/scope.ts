import { Injectable, Logger } from "@nestjs/common";
import type { StatementSync } from "node:sqlite";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { DbService } from "../core/db.service";
import { ConfigService } from "../core/config.service";
import { formerRoots, repoBase, within } from "./moved";
import type { Scope } from "./source";

/** The visitor search gives the event loop back this often. */
const SLICE_MS = 15;
/** Steps read per query while looking for visitors. */
const PAGE = 2_000;

// Which threads the open project shows: its root, the repo it is in, the folders it lived in before a move, and the
// visitors (threads from other projects that touched its files). The listener reads their logs; StepsStore lists them.

@Injectable()
export class ProjectScope {
  private log = new Logger("Listener");
  /** The active workspace's root (set on "workspace", owner: S); null until the listener starts. */
  activeRoot: string | null = null;
  /** The active root and the folders the repo lived in before it moved (see moved.ts). */
  roots: string[] = [];
  /** Visitors: threads from other projects whose steps touched this one's files (an orchestrator editing it), shown and
   *  read live like its own. From the stored steps when the project opens, and the thread you came with (an island). */
  visitors = new Set<string>();
  private guestFiles: string[] = [];
  private pendingGuest?: string;
  private visitorsOf?: StatementSync;
  /** Bumped by each set(): a search for an earlier project's visitors stops. */
  private gen = 0;
  /** Resolves when the open project's visitors are known (findVisitors). */
  visitorsFound: Promise<void> = Promise.resolve();

  constructor(private dbs: DbService, private cfg: ConfigService) {}

  /** Open `root`: its repo's threads now, and the visitors that touched its files a moment later (`found` is called
   * with how many there are, once they're known: findVisitors). */
  set(root: string, found?: (n: number) => void) {
    this.activeRoot = resolve(root);
    // Opened from a worktree: the whole repo's threads (its main checkout and every worktree), not just this one's.
    const base = repoBase(this.activeRoot);
    this.roots = [...new Set([this.activeRoot, base, ...formerRoots(this.cfg.claudeProjectsDir, this.activeRoot)])];
    // The same Set and array, emptied: the sources' scope sees the visitors as they're found.
    this.visitors.clear();
    this.guestFiles.length = 0;
    if (this.pendingGuest) this.visitors.add(this.pendingGuest);
    this.pendingGuest = undefined;
    const gen = ++this.gen;
    this.visitorsFound = this.findVisitors(gen).then((n) => { if (gen === this.gen && n) found?.(n); }, (e) => {
      this.log.warn(`visitors: the search failed: ${(e as Error).message}`);
    });
  }

  /** What the sources read: the roots and the visitors (the same Set, so a visitor found later is read too). */
  current(): Scope {
    return { roots: this.roots, guests: { ids: this.visitors, files: this.guestFiles } };
  }

  /** Threads from other projects shown here as visitors (they touched this project's files). */
  isVisitor(id: string) { return this.visitors.has(id); }

  /** The next project opened (from an island on the map) brings this thread along as a visitor. */
  bringGuest(sessionId: string) { this.pendingGuest = sessionId; }

  /** Which threads from elsewhere touched this project's files (stored steps, by the file index), and their
   * transcripts. A big history is hundreds of thousands of steps (0.3-0.8 s in one query): the rows are walked a slice
   * at a time after set() returns, giving the loop back every SLICE_MS. Returns how many were found (0 if stopped). */
  private async findVisitors(gen: number): Promise<number> {
    await new Promise<void>((r) => setImmediate(r));
    if (gen !== this.gen) return 0;
    // A page of steps at a time by the file index (file_path, then rowid), a slice of time between pages.
    this.visitorsOf ??= this.dbs.db.prepare(`SELECT session_id AS id, file_path AS p, rowid AS r FROM steps
      WHERE file_path >= ? AND file_path < ? AND (file_path > ? OR rowid > ?) ORDER BY file_path, rowid LIMIT ${PAGE}`);
    const cwdOf = this.dbs.db.prepare(`SELECT cwd FROM sessions WHERE id = ?`);
    const seen = new Set<string>();
    const found = new Set<string>();
    let since = performance.now();
    for (const r of [...this.roots]) {
      let after: [string, number] = ["", -1];
      for (;;) {
        // From the last page's path (the index range starts there), after its last row; "0" sorts right after "/".
        const rows = this.visitorsOf.all(after[0] || r + "/", r + "0", ...after) as { id: string; p: string; r: number }[];
        for (const { id } of rows) {
          if (seen.has(id)) continue;
          seen.add(id);
          const cwd = (cwdOf.get(id) as { cwd: string } | undefined)?.cwd ?? "";
          if (!this.isWithinRoot(cwd)) found.add(id);
        }
        if (rows.length < PAGE) break;
        after = [rows[rows.length - 1].p, rows[rows.length - 1].r];
        if (performance.now() - since > SLICE_MS) {
          await new Promise<void>((res) => setImmediate(res));
          if (gen !== this.gen) return 0;
          since = performance.now();
        }
      }
    }
    if (gen !== this.gen) return 0;
    for (const id of found) this.visitors.add(id);
    // Their transcripts, to read live: Claude Code's are named by the thread (Codex's are found by id in its source).
    this.guestFiles.length = 0;
    let dirs: string[] = [];
    if (this.visitors.size) { try { dirs = readdirSync(this.cfg.claudeProjectsDir); } catch { /* no Claude Code */ } }
    for (const id of this.visitors) {
      for (const d of dirs) {
        const f = join(this.cfg.claudeProjectsDir, d, `${id}.jsonl`);
        if (existsSync(f)) { this.guestFiles.push(f); break; }
      }
    }
    if (this.visitors.size) this.log.log(`visitors: ${this.visitors.size} thread(s) from other projects touched ${this.activeRoot}`);
    return found.size;
  }

  /** True if `cwd` is in the open project (any of its roots). */
  isWithinRoot(cwd: string): boolean {
    if (!cwd || !this.activeRoot) return false;
    let abs: string;
    try { abs = resolve(cwd); } catch { return false; }
    return this.roots.some((r) => within(abs, r)); // either Unicode form: macOS records the decomposed one
  }
}
