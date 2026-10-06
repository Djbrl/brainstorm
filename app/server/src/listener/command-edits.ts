// Owner: A. Files an agent changed through a shell command instead of its edit tool (`sed -i`, a Python script writing
// app.vue, `cat > x <<EOF`): they become edits of the thread, like any other, so the map, the Track and the counts see
// them. Claude Code and Codex alike (their commands are `Bash` steps).
// - Which files: what the command says it writes (command-writes.ts reads the command), plus, live, any file that changed
//   on disk while it ran and that it names.
// - The change itself: live, the mapper's copy of the file from before (bus "file-content") against what it is after;
//   in history only the command is known, so the edit has no diff.
// Each edit comes with a result (so attention never sees it waiting) and says it came from a command (input.byCommand).
import { basename, relative, resolve, sep } from "node:path";
import type { Step } from "../types";
import { commandWrites } from "./command-writes";
import { lineHunks } from "./line-diff";
import type { NewStep } from "./source";
import { sanitizeText, TEXT_LIMIT } from "./text";

/** How long changes on disk are kept to be matched with a command (Codex logs a command only once it has finished). */
const KEEP_MS = 3 * 60_000;
/** A change this long before a command's start, or after its result, still counts (clock and watcher delays). */
const SLACK_BEFORE_MS = 1_000;
const SLACK_AFTER_MS = 2_500;
/** Commands remembered while their result hasn't come (history can leave some without one). */
const MAX_CALLS = 2_000;

type Call = { sessionId: string; command: string; cwd: string; start: number; isSubagent: boolean; agentId?: string };
type Change = { path: string; before: string | null; after: string | null; at: number };

export class CommandEdits {
  private calls = new Map<string, Call>();
  /** Each thread's last step time: where a command that's logged when it finishes (Codex) started at the latest. */
  private lastAt = new Map<string, number>();
  /** Files an agent's edit tool changed, per thread and path, when: a command's write of the same file isn't counted twice. */
  private toolEdits = new Map<string, number>();
  private changes: Change[] = [];

  /** `inProject`: whether a path is part of the open project (writes elsewhere, like /tmp, aren't the project's). */
  constructor(private inProject: (path: string) => boolean) {}

  /** A change on disk, from the mapper. */
  fileChanged(c: Change) {
    this.changes.push(c);
    const old = c.at - KEEP_MS;
    if (this.changes.length > 2_000 || this.changes[0].at < old) this.changes = this.changes.filter((x) => x.at >= old).slice(-2_000);
  }

  /** Every stored step goes through here. Returns the command a result finishes, if any: the caller asks `editsFor` then
   * (at once for history; a moment later live, so the mapper has seen the files change). */
  step(s: Step, cwd: string): (Call & { id: string; end: number }) | null {
    const at = Date.parse(s.ts) || Date.now();
    const prev = this.lastAt.get(s.sessionId);
    this.lastAt.set(s.sessionId, at);
    if (s.kind === "edit" && s.filePath && !(s.input as { byCommand?: boolean } | undefined)?.byCommand) {
      this.toolEdits.set(`${s.sessionId}\n${s.filePath}`, at);
      if (this.toolEdits.size > 5_000) this.toolEdits.delete(this.toolEdits.keys().next().value!);
    }
    if (s.kind === "tool_call" && s.tool === "Bash" && s.toolUseId) {
      const input = (s.input ?? {}) as { command?: unknown; workdir?: unknown; cwd?: unknown };
      if (typeof input.command !== "string" || !input.command.trim()) return null;
      const dir = typeof input.workdir === "string" ? input.workdir : typeof input.cwd === "string" ? input.cwd : cwd;
      this.calls.set(s.toolUseId, {
        sessionId: s.sessionId, command: input.command, cwd: dir || cwd, start: Math.min(at, prev ?? at),
        isSubagent: !!s.isSubagent, ...(s.agentId ? { agentId: s.agentId } : {}),
      });
      if (this.calls.size > MAX_CALLS) this.calls.delete(this.calls.keys().next().value!);
      return null;
    }
    if (s.kind === "tool_result" && s.toolUseId) {
      const call = this.calls.get(s.toolUseId);
      if (!call) return null;
      this.calls.delete(s.toolUseId);
      return { ...call, id: s.toolUseId, end: at };
    }
    return null;
  }

  /** The edit steps (each with its result) for the files a finished command changed. `live`: changes on disk are
   * matched, so the edits have their diff. */
  editsFor(call: Call & { id: string; end: number }, ts: string, live: boolean): NewStep[] {
    const writes = new Map<string, { kind: "write" | "delete"; from?: string }>();
    for (const w of commandWrites(call.command, call.cwd)) {
      const p = resolve(w.path);
      if (this.inProject(p) && !insideGit(p)) writes.set(p, { kind: w.kind, ...(w.from ? { from: w.from } : {}) });
    }
    // Live: what changed on disk while it ran, first and last state per file.
    const seen = new Map<string, { before: string | null; after: string | null }>();
    if (live) {
      const from = call.start - SLACK_BEFORE_MS, to = call.end + SLACK_AFTER_MS;
      for (const c of this.changes) {
        if (c.at < from || c.at > to) continue;
        const had = seen.get(c.path);
        seen.set(c.path, { before: had ? had.before : c.before, after: c.after });
      }
      // A file the command names that changed while it ran (a formatter, a codegen script given the file): counted too.
      for (const [path, ch] of seen) {
        if (writes.has(path) || !this.inProject(path) || insideGit(path)) continue;
        if (call.command.includes(basename(path))) writes.set(path, { kind: ch.after === null ? "delete" : "write" });
      }
    }
    const out: NewStep[] = [];
    let k = 0;
    for (const [path, w] of writes) {
      // The agent's edit tool changed it in this thread around then: that edit already says it.
      const tool = this.toolEdits.get(`${call.sessionId}\n${path}`);
      if (tool !== undefined && tool >= call.start - SLACK_BEFORE_MS) continue;
      const ch = seen.get(path);
      if (live && w.kind === "write" && ch && ch.after !== null && ch.before === ch.after) continue; // rewritten, unchanged
      const id = `${call.id}:wrote:${k++}`;
      const created = ch ? ch.before === "" : false;
      const deleted = w.kind === "delete" || (ch !== undefined && ch.after === null);
      const diff = ch && ch.before !== null ? lineHunks(ch.before, ch.after ?? "") : undefined;
      const input = {
        file_path: path, command: sanitizeText(call.command, 4_000), byCommand: true,
        ...(deleted ? { deleted: true } : {}), ...(w.from ? { from: w.from } : {}),
      };
      const who = { isSubagent: call.isSubagent, ...(call.agentId ? { agentId: call.agentId } : {}) };
      out.push({
        id, sessionId: call.sessionId, ts, kind: "edit", tool: created ? "Write" : "Edit", input, filePath: path, toolUseId: id, ...who,
        ...(diff ? { diff: { before: sanitizeText(diff.before, TEXT_LIMIT), after: sanitizeText(diff.after, TEXT_LIMIT) } } : {}),
      });
      out.push({ id: `${id}:result`, sessionId: call.sessionId, ts, kind: "tool_result", text: deleted ? "Deleted by the command" : "Changed by the command", toolUseId: id, ...who });
    }
    return out;
  }
}

const insideGit = (p: string) => p.split(sep).includes(".git");
export const within = (p: string, root: string) => { const r = relative(root, p); return !!r && !r.startsWith("..") && !r.startsWith(sep); };
