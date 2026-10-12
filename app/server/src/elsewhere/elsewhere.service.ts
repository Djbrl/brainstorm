import { Injectable } from "@nestjs/common";
import { closeSync, openSync, readSync, statSync, type Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import type { ElsewhereThread } from "../shared/contract";
import { worktreeRepo } from "../shared/paths";
import { inside, real } from "../core/paths";
import { ConfigService } from "../core/config.service";
import { ListenerService } from "../listener/listener.service";
import { StepsStore } from "../listener/step-store";
import { AttentionService } from "../attention/attention.service";
import { promptTitle } from "../listener/text";
import { maskSecrets } from "../privacy/mask";
import { isIdleTranscript } from "../workspace/threads";
import { decodeProjectDir } from "../workspace/workspace.service";

// Agents at work in the person's other projects, so the app can say so and take you there. Cheap on
// purpose: the logs of other projects aren't read, only their files' last change (a thread is working while its log
// grows), a few KB of a live one (where it runs, its title), and what the plugin's hooks said (they post every
// session's events, whatever the project).

/** A log that changed this recently is a thread at work (the listener's "running"). */
const LIVE_MS = 2 * 60_000;
/** A thread waiting on you stays listed this long without a word from it. */
const WAIT_MS = 2 * 60 * 60_000;
const HEAD_BYTES = 64 * 1024;
/** Files looked at at once. */
const IO_CONCURRENCY = 32;

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (next < items.length) await fn(items[next++]); }));
}

const repoOf = (p: string) => real(worktreeRepo(real(p)));

function readAt(file: string, from: "head" | "tail", bytes = HEAD_BYTES): string {
  let fd: number | undefined;
  try {
    fd = openSync(file, "r");
    const size = statSync(file).size;
    const n = Math.min(bytes, size);
    const buf = Buffer.alloc(n);
    readSync(fd, buf, 0, n, from === "head" ? 0 : size - n);
    return buf.toString("utf8");
  } catch { return ""; } finally { if (fd !== undefined) closeSync(fd); }
}

@Injectable()
export class ElsewhereService {
  private roots = new Map<string, string | null>(); // Claude Code project folder → its repo (decoded once)
  private cwds = new Map<string, string | null>();  // log file → where its thread runs (its first cwd)
  /** Each folder's entries, kept while its mtime stays the same (a log growing doesn't change its folder's). */
  private listings = new Map<string, { mtimeMs: number; entries: Dirent[] }>();
  /** A call in progress: callers at the same moment share it. */
  private pending?: Promise<ElsewhereThread[]>;

  constructor(private cfg: ConfigService, private listener: ListenerService, private attention: AttentionService, private store: StepsStore) {}

  /** A folder's entries (from the cache while the folder's mtime hasn't changed), or undefined if it can't be read. */
  private async entries(dir: string): Promise<Dirent[] | undefined> {
    let mtimeMs: number;
    try { mtimeMs = (await stat(dir)).mtimeMs; } catch { this.listings.delete(dir); return undefined; }
    const hit = this.listings.get(dir);
    if (hit && hit.mtimeMs === mtimeMs) return hit.entries;
    let entries: Dirent[];
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return undefined; }
    this.listings.set(dir, { mtimeMs, entries });
    if (this.listings.size > 20_000) this.listings.delete(this.listings.keys().next().value!);
    return entries;
  }

  list(): Promise<ElsewhereThread[]> {
    return (this.pending ??= this.listNow().finally(() => { this.pending = undefined; }));
  }

  private async listNow(): Promise<ElsewhereThread[]> {
    const now = Date.now();
    const here = this.listener.scopeRoots().map(real);
    const isHere = (p: string) => here.some((r) => inside(real(p), r) || inside(repoOf(p), r));
    const out: ElsewhereThread[] = [];

    // Claude Code: one folder per project, one log per thread (its subagents' logs in <thread>/subagents/). Folders
    // are listed again only when they change; the logs are stat'ed, a few at a time, off the event loop.
    const logs: { dir: string; d: string; name: string; sub: boolean }[] = [];
    const isDir = (e: Dirent) => e.isDirectory() || e.isSymbolicLink();
    const dirs = (await this.entries(this.cfg.claudeProjectsDir))?.filter(isDir).map((e) => e.name) ?? [];
    await mapLimit(dirs, IO_CONCURRENCY, async (d) => {
      const dir = join(this.cfg.claudeProjectsDir, d);
      const entries = await this.entries(dir);
      if (!entries) return;
      const folders = new Set(entries.filter(isDir).map((e) => e.name));
      for (const e of entries) if (e.name.endsWith(".jsonl") && !e.isDirectory()) logs.push({ dir, d, name: e.name, sub: folders.has(basename(e.name, ".jsonl")) });
    });
    const live: { file: string; d: string; sid: string; size: number; last: number; state: ElsewhereThread["state"] }[] = [];
    await mapLimit(logs, IO_CONCURRENCY, async ({ dir, d, name, sub }) => {
      const file = join(dir, name);
      const sid = basename(name, ".jsonl");
      let st;
      try { st = await stat(file); } catch { return; }
      const last = Math.max(st.mtimeMs, sub ? await this.subagentsChanged(join(dir, sid)) : 0);
      const state = this.stateOf(sid, last, now);
      if (state) live.push({ file, d, sid, size: st.size, last, state });
    });
    for (const { file, d, sid, size, last, state } of live) {
      const cwd = this.cwdOf(file);
      const root = cwd ? repoOf(cwd) : this.rootOf(d);
      if (!root || isHere(cwd ?? root) || /\/Library\/Application Support\//.test(root)) continue;
      if (isIdleTranscript(file, size)) continue; // only slash commands so far: not a thread yet
      out.push({ sessionId: sid, harness: "claude", title: this.claudeTitle(file, sid), root, project: basename(root), lastEventAt: new Date(last).toISOString(), state });
    }

    // Codex: its live threads (their repo already worked out by the Codex reader).
    const seen = new Set<string>();
    for (const t of this.listener.codexRecent(now - LIVE_MS).sort((a, b) => b.mtimeMs - a.mtimeMs)) {
      if (seen.has(t.id)) continue; // a subagent's file counts for its parent
      seen.add(t.id);
      if (isHere(t.root)) continue;
      const state = this.stateOf(t.id, t.mtimeMs, now);
      if (!state) continue;
      const root = repoOf(t.root);
      out.push({ sessionId: t.id, harness: "codex", title: t.title ?? this.store.getSession(t.id)?.title, root, project: basename(root), lastEventAt: new Date(t.mtimeMs).toISOString(), state });
    }

    // Titles come from other projects' raw logs (a custom title, the latest prompt) or from rows stored before titles
    // were masked: masked here, on the way to the page.
    for (const t of out) if (t.title) t.title = maskSecrets(t.title);
    const rank = { "needs-you": 0, "working": 1, "your-turn": 2 } as const;
    return out.sort((a, b) => rank[a.state] - rank[b.state] || b.lastEventAt.localeCompare(a.lastEventAt));
  }

  /** Working, waiting on you, or just done; undefined for a thread at rest. */
  private stateOf(sid: string, last: number, now: number): ElsewhereThread["state"] | undefined {
    const h = this.attention.hookOf(sid);
    const after = h && h.at >= last - 1000; // nothing written since the hook spoke
    if (h && after && now - h.at < WAIT_MS) {
      if (h.event === "PermissionRequest") return "needs-you";
      if (h.event === "Notification" && (h.notification_type === "permission_prompt" || /^elicitation/.test(h.notification_type ?? ""))) return "needs-you";
    }
    if (now - last > LIVE_MS) return undefined;
    if (h && after && (h.event === "Stop" || (h.event === "Notification" && h.notification_type === "idle_prompt"))) return "your-turn";
    return "working";
  }

  /** The newest change among a thread's subagents' logs (0 when it has none). */
  private async subagentsChanged(threadDir: string): Promise<number> {
    const entries = await this.entries(join(threadDir, "subagents"));
    if (!entries) return 0;
    let max = 0;
    for (const e of entries) if (e.name.endsWith(".jsonl")) { try { max = Math.max(max, (await stat(join(threadDir, "subagents", e.name))).mtimeMs); } catch { /* gone */ } }
    return max;
  }

  private cwdOf(file: string): string | null {
    const hit = this.cwds.get(file);
    if (hit !== undefined) return hit;
    let cwd: string | null = null;
    for (const line of readAt(file, "head").split("\n")) {
      const m = /"cwd":"((?:[^"\\]|\\.)*)"/.exec(line);
      if (m) { try { cwd = resolve(JSON.parse(`"${m[1]}"`)); } catch { /* skip */ } break; }
    }
    if (cwd) this.cwds.set(file, cwd); // not written yet: look again next time
    return cwd;
  }

  private rootOf(dirName: string): string | null {
    if (!this.roots.has(dirName)) { const d = decodeProjectDir(dirName); this.roots.set(dirName, d ? repoOf(d) : null); }
    return this.roots.get(dirName) ?? null;
  }

  /** The name the person gave the thread, else Claude Code's own, else its latest request; else what we stored. */
  private claudeTitle(file: string, sid: string): string | undefined {
    let custom: string | undefined, prompt: string | undefined;
    for (const line of readAt(file, "tail").split("\n")) {
      if (line.startsWith('{"type":"custom-title"')) { try { custom = JSON.parse(line).customTitle || custom; } catch { /* cut */ } }
      else if (line.startsWith('{"type":"last-prompt"')) { try { prompt = JSON.parse(line).lastPrompt || prompt; } catch { /* cut */ } }
    }
    return custom ?? this.store.getSession(sid)?.title ?? (prompt ? promptTitle(maskSecrets(prompt)) : undefined);
  }
}
