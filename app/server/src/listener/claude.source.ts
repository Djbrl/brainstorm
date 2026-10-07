// Owner: A. Claude Code's session logs: ~/.claude/projects/<project>/<sessionId>.jsonl, and subagents' at
// <project>/<sessionId>/subagents/agent-*.jsonl. A project folder is named after where the thread ran
// ("/Users/me/repo" → "-Users-me-repo"), so the open project's logs are the folders starting with its roots' names.
import chokidar, { type FSWatcher } from "chokidar";
import { readdirSync, statSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { homedir } from "node:os";
import type { StepKind } from "../types";
import { encodeRoot, underPrefix } from "./moved";
import type { LogFile, LogSource, NewStep, Scope, Sink, WatchEvents } from "./source";
import { sanitizeDeep, sanitizeText, TEXT_LIMIT, TOOL_RESULT_LIMIT } from "./text";

type RawLine = {
  type?: string;
  uuid?: string;
  sessionId?: string;
  cwd?: string;
  timestamp?: string;
  isSidechain?: boolean;
  /** Claude Code's recap of a conversation it compacted: the agent's context, not something the person wrote. */
  isCompactSummary?: boolean;
  customTitle?: string;
  agentId?: string;
  message?: { role?: string; content?: unknown };
};

/** Threads deleted in Claude's desktop app: it leaves a `deleted_<sessionId>` file per thread. Re-read at most once a minute. */
let deletedCache: { at: number; ids: Set<string> } | null = null;
function deletedThreads(): Set<string> {
  if (deletedCache && Date.now() - deletedCache.at < 60_000) return deletedCache.ids;
  const ids = new Set<string>();
  const root = join(homedir(), "Library", "Application Support", "Claude", "claude-code-sessions"); // macOS; elsewhere nothing is found
  const list = (dir: string) => { try { return readdirSync(dir); } catch { return []; } }; // no desktop app, or a file
  for (const a of list(root)) for (const b of list(join(root, a))) for (const f of list(join(root, a, b))) {
    if (f.startsWith("deleted_")) ids.add(f.slice("deleted_".length));
  }
  deletedCache = { at: Date.now(), ids };
  return ids;
}

export class ClaudeSource implements LogSource {
  readonly harness = "claude" as const;
  private watcher?: FSWatcher;
  private ready = false;
  private prefixes: string[] = [];
  private override?: string;
  /** Top-level project folders chokidar watches (only the open project's are descended into). */
  private watchedTop = new Set<string>();
  /** Thread id → its transcript files, from the files read; rebuilt when a new one is read. */
  private transcripts: { count: number; map: Map<string, string[]> } | null = null;

  constructor(private readonly dir: string, private readonly onError: (e: Error) => void = () => {}) {}

  /** Visitors' transcripts (another project's threads that touched this one), and the project folders they're in. */
  private guestFiles: readonly string[] = [];
  private guestTops = new Set<string>();

  private setScope(scope: Scope) {
    this.override = scope.override;
    this.prefixes = scope.override ? [] : scope.roots.map(encodeRoot);
    this.guestFiles = scope.guests?.files ?? [];
    this.guestTops = new Set(this.guestFiles.map((f) => relative(this.dir, f).split(sep)[0]).filter(Boolean));
  }

  /** A visitor's transcript, or one of its subagents' (in <thread>/subagents/). */
  private isGuest(file: string) {
    return this.guestFiles.some((g) => file === g || file.startsWith(g.replace(/\.jsonl$/, "") + sep));
  }

  /** True if `projectDir` (a top-level folder name under the projects folder) belongs to the open project. */
  private matches(projectDir: string): boolean {
    if (this.override) return projectDir.includes(this.override);
    return this.prefixes.some((p) => underPrefix(projectDir, p));
  }
  /** A folder to watch: the open project's, or one a visitor's transcript is in (only that transcript is read there). */
  private watches(projectDir: string): boolean {
    return this.matches(projectDir) || this.guestTops.has(projectDir);
  }

  watch(scope: Scope, on: WatchEvents) {
    this.setScope(scope);
    const projects = this.dir;
    this.watcher = chokidar.watch(projects, {
      ignoreInitial: false,
      depth: 4,
      // Only the open project's folders are descended into (a project change adds its own, see rescope): other
      // projects' gigabytes of logs aren't stat'ed or watched.
      ignored: (path: string, stats?: { isFile(): boolean }) => {
        const rel = relative(projects, path);
        if (rel && !rel.startsWith("..") && !this.watches(rel.split(sep)[0])) return true;
        return stats?.isFile() ? !path.endsWith(".jsonl") : false;
      },
    });
    this.watcher.on("addDir", (d) => {
      const rel = relative(projects, d);
      if (rel && !rel.startsWith("..") && !rel.includes(sep)) this.watchedTop.add(rel);
    });
    this.watcher.on("add", (f) => on.add(f));
    this.watcher.on("change", (f) => on.change(f));
    this.watcher.on("error", (e) => this.onError(e as Error));
    this.watcher.on("ready", () => { this.ready = true; on.ready(); });
  }

  /** Watch the matching project folders chokidar skipped (they didn't match before), stop watching the others. */
  rescope(scope: Scope) {
    this.setScope(scope);
    if (!this.watcher || !this.ready) return;
    const matching = this.matchingDirs();
    for (const d of matching) if (!this.watchedTop.has(d)) { this.watchedTop.add(d); this.watcher.add(join(this.dir, d)); }
    for (const d of [...this.watchedTop]) if (!this.watches(d)) { this.watchedTop.delete(d); this.watcher.unwatch(join(this.dir, d)); }
  }

  async close() { await this.watcher?.close(); }
  getWatched() { return this.watcher?.getWatched() ?? {}; }

  private matchingDirs(): string[] {
    let dirs: string[];
    try { dirs = readdirSync(this.dir); } catch (e) {
      this.onError(new Error(`cannot read ${this.dir}: ${(e as Error).message}`));
      return [];
    }
    return dirs.filter((d) => this.watches(d));
  }

  list(scope: Scope): LogFile[] {
    this.setScope(scope);
    const files: LogFile[] = [];
    for (const d of this.matchingDirs()) {
      if (this.matches(d)) { collectJsonl(join(this.dir, d), files); continue; }
      const theirs: LogFile[] = [];   // a visitor's folder: only its transcripts
      collectJsonl(join(this.dir, d), theirs);
      files.push(...theirs.filter((f) => this.isGuest(f.path)));
    }
    return files;
  }

  owns(file: string) {
    const rel = relative(this.dir, file);
    return !!rel && !rel.startsWith("..") && !rel.startsWith(sep);
  }

  inScope(file: string, scope: Scope) {
    this.setScope(scope);
    return this.matches(relative(this.dir, file).split(sep)[0] ?? "") || this.isGuest(file);
  }

  hidden(files: Iterable<string>) {
    // A thread you deleted (in Claude's desktop app) isn't one any more: its transcript is gone and the app left a
    // marker. One that Claude Code cleaned up on its own (after ~30 days) stays: Rundown keeps that history.
    const deleted = deletedThreads();
    if (!deleted.size) return () => false;
    const transcripts = this.transcriptIndex(files);
    return (id: string) => {
      const list = transcripts.get(id);
      return deleted.has(id) && !!list && !list.some((f) => { try { statSync(f); return true; } catch { return false; } });
    };
  }

  private transcriptIndex(files: Iterable<string>): Map<string, string[]> {
    const all = [...files];
    if (this.transcripts?.count === all.length) return this.transcripts.map;
    const map = new Map<string, string[]>();
    for (const file of all) {
      const parts = relative(this.dir, file).split(sep);
      if (parts.length !== 2 || !file.endsWith(".jsonl")) continue; // <project>/<sessionId>.jsonl, not a subagent's
      const id = basename(file, ".jsonl");
      map.set(id, [...(map.get(id) ?? []), file]);
    }
    this.transcripts = { count: all.length, map };
    return map;
  }

  // ---- parsing ----

  parse(_file: string, line: unknown, sink: Sink) {
    const o = line as RawLine;
    if (!o || typeof o !== "object") return;
    if (o.type === "custom-title") {
      if (o.sessionId && o.customTitle) sink.customTitle(o.sessionId, o.customTitle);
      return;
    }
    if (o.type === "user") return this.user(o, sink);
    if (o.type === "assistant") return this.assistant(o, sink);
    // Ignore attachment, system, queue-operation, agent-name, last-prompt, atis-latch, file-history-snapshot, etc.
  }

  private user(o: RawLine, sink: Sink) {
    const sessionId = o.sessionId;
    if (!sessionId) return;
    const content = o.message?.content;
    const ts = o.timestamp ?? new Date().toISOString();

    if (o.isCompactSummary) { // the recap Claude Code writes when it compacts a long conversation
      const text = typeof content === "string" ? content : Array.isArray(content) ? content.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("\n\n") : "";
      if (text.trim()) sink.step(textStep(o, sessionId, 0, ts, "text", text), { cwd: o.cwd });
      return;
    }

    if (typeof content === "string") {
      sink.step(textStep(o, sessionId, 0, ts, "prompt", content), { cwd: o.cwd, promptTitle: content });
      return;
    }
    if (!Array.isArray(content)) return;

    const textBlocks: { i: number; text: string }[] = [];
    content.forEach((b: any, i: number) => {
      if (b && b.type === "text" && typeof b.text === "string" && b.text.trim()) textBlocks.push({ i, text: b.text });
    });
    if (textBlocks.length) {
      const joined = textBlocks.map((b) => b.text).join("\n\n");
      if (/^\s*\[Request interrupted by user/.test(joined)) return; // harness notice, not a human prompt
      sink.step(textStep(o, sessionId, textBlocks[0].i, ts, "prompt", joined), { cwd: o.cwd, promptTitle: joined });
    }

    content.forEach((block: any, i: number) => {
      if (!block || block.type !== "tool_result") return;
      let text: string;
      if (typeof block.content === "string") text = block.content;
      else if (Array.isArray(block.content)) text = block.content.filter((c: any) => c?.type === "text").map((c: any) => c.text).join("\n\n");
      else text = JSON.stringify(block.content ?? "");
      const step = textStep(o, sessionId, i, ts, "tool_result", text);
      if (typeof block.tool_use_id === "string") step.toolUseId = block.tool_use_id;
      if (block.is_error) step.input = { isError: true, toolUseId: block.tool_use_id }; // read by the failures module
      sink.step(step, { cwd: o.cwd });
    });
  }

  private assistant(o: RawLine, sink: Sink) {
    const sessionId = o.sessionId;
    if (!sessionId) return;
    const content = o.message?.content;
    if (!Array.isArray(content)) return;
    const ts = o.timestamp ?? new Date().toISOString();

    content.forEach((block: any, i: number) => {
      if (!block || typeof block !== "object") return;
      if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
        sink.step(textStep(o, sessionId, i, ts, "text", block.text), { cwd: o.cwd });
      } else if (block.type === "thinking" && typeof block.thinking === "string" && block.thinking.trim()) {
        sink.step(textStep(o, sessionId, i, ts, "thinking", block.thinking), { cwd: o.cwd });
      } else if (block.type === "tool_use") {
        sink.step(toolStep(o, sessionId, i, ts, block.name, block.input, typeof block.id === "string" ? block.id : undefined), { cwd: o.cwd });
      }
    });
  }
}

const subagentOf = (o: RawLine) => (o.isSidechain === true ? { isSubagent: true, ...(o.agentId ? { agentId: o.agentId } : {}) } : { isSubagent: false });

function textStep(o: RawLine, sessionId: string, blockIndex: number, ts: string, kind: StepKind, text: string): NewStep {
  return {
    id: `${o.uuid ?? ""}:${blockIndex}`, sessionId, ts, kind,
    text: sanitizeText(text, kind === "tool_result" ? TOOL_RESULT_LIMIT : TEXT_LIMIT),
    ...subagentOf(o),
  };
}

function toolStep(o: RawLine, sessionId: string, i: number, ts: string, name: string, input: any, toolUseId?: string): NewStep {
  const isEdit = name === "Edit" || name === "MultiEdit" || name === "Write";
  const filePath: string | undefined = typeof input?.file_path === "string" ? input.file_path : typeof input?.path === "string" ? input.path : undefined;
  const base = {
    id: `${o.uuid ?? ""}:${i}`, sessionId, ts, tool: name, input: sanitizeDeep(input) as unknown, filePath,
    ...subagentOf(o), ...(toolUseId ? { toolUseId } : {}),
  };
  if (!isEdit) return { ...base, kind: "tool_call" };
  let before = "";
  let after = "";
  if (name === "Edit") {
    before = typeof input?.old_string === "string" ? input.old_string : "";
    after = typeof input?.new_string === "string" ? input.new_string : "";
  } else if (name === "Write") {
    after = typeof input?.content === "string" ? input.content : "";
  } else if (name === "MultiEdit" && Array.isArray(input?.edits)) {
    before = input.edits.map((e: any) => (typeof e?.old_string === "string" ? e.old_string : "")).join("\n---\n");
    after = input.edits.map((e: any) => (typeof e?.new_string === "string" ? e.new_string : "")).join("\n---\n");
  }
  return { ...base, kind: "edit", diff: { before: sanitizeText(before, TEXT_LIMIT), after: sanitizeText(after, TEXT_LIMIT) } };
}

function collectJsonl(dir: string, out: LogFile[]) {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return; }
  for (const name of entries) {
    const p = join(dir, name);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) { collectJsonl(p, out); continue; } // e.g. <session>/subagents/
    if (name.endsWith(".jsonl")) out.push({ path: p, mtimeMs: st.mtimeMs, size: st.size });
  }
}
