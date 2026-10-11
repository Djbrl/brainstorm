import { Injectable, Logger } from "@nestjs/common";
import type { StatementSync } from "node:sqlite";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { DbService } from "../core/db.service";
import { ConfigService } from "../core/config.service";
import { formerRoots, repoBase, within } from "./moved";
import type { Scope } from "./source";

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

  constructor(private dbs: DbService, private cfg: ConfigService) {}

  /** Open `root`: its repo's threads and the visitors that touched its files. */
  set(root: string) {
    this.activeRoot = resolve(root);
    // Opened from a worktree: the whole repo's threads (its main checkout and every worktree), not just this one's.
    const base = repoBase(this.activeRoot);
    this.roots = [...new Set([this.activeRoot, base, ...formerRoots(this.cfg.claudeProjectsDir, this.activeRoot)])];
    this.findVisitors();
  }

  /** What the sources read: the roots and the visitors (the same Set, so a visitor found later is read too). */
  current(): Scope {
    return { roots: this.roots, guests: { ids: this.visitors, files: this.guestFiles } };
  }

  /** Threads from other projects shown here as visitors (they touched this project's files). */
  isVisitor(id: string) { return this.visitors.has(id); }

  /** The next project opened (from an island on the map) brings this thread along as a visitor. */
  bringGuest(sessionId: string) { this.pendingGuest = sessionId; }

  /** Which threads from elsewhere touched this project's files (stored steps, by the file index), and their transcripts. */
  private findVisitors() {
    this.visitors = new Set(this.pendingGuest ? [this.pendingGuest] : []);
    this.pendingGuest = undefined;
    this.visitorsOf ??= this.dbs.db.prepare(`SELECT DISTINCT st.session_id, s.cwd FROM steps st JOIN sessions s ON s.id = st.session_id WHERE st.file_path >= ? AND st.file_path < ?`);
    for (const r of this.roots) {
      const rows = this.visitorsOf.all(r + "/", r + "0") as { session_id: string; cwd: string }[]; // "0" sorts right after "/"
      for (const row of rows) if (!this.isWithinRoot(row.cwd)) this.visitors.add(row.session_id);
    }
    // Their transcripts, to read live: Claude Code's are named by the thread (Codex's are found by id in its source).
    this.guestFiles = [];
    let dirs: string[] = [];
    if (this.visitors.size) { try { dirs = readdirSync(this.cfg.claudeProjectsDir); } catch { /* no Claude Code */ } }
    for (const id of this.visitors) {
      for (const d of dirs) {
        const f = join(this.cfg.claudeProjectsDir, d, `${id}.jsonl`);
        if (existsSync(f)) { this.guestFiles.push(f); break; }
      }
    }
    if (this.visitors.size) this.log.log(`visitors: ${this.visitors.size} thread(s) from other projects touched ${this.activeRoot}`);
  }

  /** True if `cwd` is in the open project (any of its roots). */
  isWithinRoot(cwd: string): boolean {
    if (!cwd || !this.activeRoot) return false;
    let abs: string;
    try { abs = resolve(cwd); } catch { return false; }
    return this.roots.some((r) => within(abs, r)); // either Unicode form: macOS records the decomposed one
  }
}
