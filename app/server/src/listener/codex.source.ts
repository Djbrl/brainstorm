// Owner: A. Codex's session logs: <codexDir>/sessions/YYYY/MM/DD/rollout-<time>-<uuid>.jsonl, and archived threads
// in <codexDir>/archived_sessions/. One file per thread (a long thread can go on in a new file with the same thread id).
// Every line is { timestamp, ordinal, type, payload }; the first is the session_meta (thread id, folder, version).
//
// What a line means, mapped onto Claude Code's tool names so the web shows Codex threads as it does Claude's
// (codex.map.ts has the formats):
// - Codex logs each finished item once (event_msg item_completed): prompts, replies, reasoning summaries, file changes,
//   MCP calls, web searches, image views, and from version 0.149 every shell command. Those are the steps.
// - The same work also appears as the model's own records (response_item function_call / custom_tool_call and their
//   outputs). Only what no item covers is taken from them: direct exec_command / shell_command calls, update_plan,
//   view_image, questions to the person, and, before 0.149, the commands run inside its `exec` scripts. An apply_patch
//   call is the edit only when no FileChange item answered it.
// - A file from a Codex older than item_completed (none on the machines surveyed) is read from the model's records alone.
// Steps are stored once a call is finished, with their result in the same chunk (Codex logs them that way), so no call
// sits open; a question waits for its answer.
import chokidar, { type FSWatcher } from "chokidar";
import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import type { StepKind } from "../types";
import type { LogFile, LogSource, NewStep, Scope, Sink, WatchEvents } from "./source";
import { sanitizeDeep, sanitizeText, TEXT_LIMIT, TOOL_RESULT_LIMIT } from "./text";
import { codexPrompt, commandString, diffToBeforeAfter, execCalls, isInjected, outputText, parsePatch, questionReply, readsOf, shellResult, todoStatus, type ShellResult } from "./codex.map";

/** The first line of a rollout file, as far as Rundown needs it. */
type Meta = {
  id: string;
  cwd: string;
  /** Other folders the thread could work in (runtime_workspace_roots). */
  roots: string[];
  repoUrl?: string;
  /** cli_version as a number: 0.147.x → 147 (1.2.x → 1002). 0 when unknown. */
  version: number;
  /** Codex's approval reviewer ("guardian"): a subagent judging another thread's commands, not work to show. */
  reviewer: boolean;
};

type Call = { name: string; args: any; ts: string; turnId?: string };

/** What a file has said so far in this run (it resumes anywhere after a restart: everything here can be rebuilt). */
type FileState = {
  file: string;
  meta: Meta;
  sessionId: string;
  /** The file's own uuid (its name), for ids of lines without a unique item id. */
  fileId: string;
  /** Read from its first line in this run (else it resumed mid-file). */
  fromStart: boolean;
  /** Where the thread works now (turn_context), as logged. */
  cwd: string;
  turnId?: string;
  turnStart?: string;
  /** Built from item_completed lines (every Codex since 0.94). */
  items?: boolean;
  /** Tool calls waiting for their output. */
  calls: Map<string, Call>;
  /** apply_patch calls a FileChange item already stored. */
  patched: Set<string>;
  /** The first command Codex logged as an item (versions before 0.149 started doing so mid-thread when resumed in a
   * newer Codex): from that turn on, commands come from the items. */
  ceTurn?: string;
  ceTs?: string;
  ceScanned?: boolean;
  /** The last question asked, for an answer that doesn't say which. */
  lastAsk?: string;
};

const ITEMS_SINCE = 94;
const COMMAND_ITEMS_SINCE = 149;
const UUID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;
/** The first line holds Codex's whole system prompt (50 KB seen): read up to this much to find its end. */
const FIRST_LINE_MAX = 4 * 1024 * 1024;

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const versionOf = (v: unknown) => { const m = /^(\d+)\.(\d+)/.exec(String(v ?? "")); return m ? Number(m[1]) * 1000 + Number(m[2]) : 0; };
const within = (p: string, root: string) => p === root || p.startsWith(root.endsWith(sep) ? root : root + sep);

export class CodexSource implements LogSource {
  readonly harness = "codex" as const;
  private watcher?: FSWatcher;
  private scope: Scope = { roots: [] };
  /** First lines, per file (they never change). Null: unreadable or not a rollout. */
  private metas = new Map<string, Meta | null>();
  private states = new Map<string, FileState>();
  /** Codex worktree checkout → the repo's main checkout, from its .git file. */
  private mains = new Map<string, string | null>();
  private remotes = new Map<string, string[]>();

  constructor(private readonly dir: string, private readonly onError: (e: Error) => void = () => {}) {}

  private get sessionsDir() { return join(this.dir, "sessions"); }
  private get archivedDir() { return join(this.dir, "archived_sessions"); }
  private get worktreesDir() { return join(this.dir, "worktrees"); }

  // ---- files ----

  watch(scope: Scope, on: WatchEvents) {
    this.scope = scope;
    if (!existsSync(this.sessionsDir)) { setImmediate(() => on.ready()); return; } // no Codex here
    this.watcher = chokidar.watch(this.sessionsDir, {
      ignoreInitial: false,
      depth: 4, // sessions/YYYY/MM/DD/<file>
      ignored: (path: string, stats?: { isFile(): boolean }) => (stats?.isFile() ? !path.endsWith(".jsonl") : false),
    });
    this.watcher.on("add", (f) => on.add(f));
    this.watcher.on("change", (f) => on.change(f));
    this.watcher.on("error", (e) => this.onError(e as Error));
    this.watcher.on("ready", () => on.ready());
  }

  /** Codex's files aren't split by project folder: the same folders stay watched. */
  rescope(scope: Scope) { this.scope = scope; }
  async close() { await this.watcher?.close(); }
  getWatched() { return this.watcher?.getWatched() ?? {}; }

  list(scope: Scope): LogFile[] {
    this.scope = scope;
    const files: LogFile[] = [];
    for (const d of [this.sessionsDir, this.archivedDir]) collectJsonl(d, files, 0);
    return files.filter((f) => this.inScope(f.path, scope));
  }

  owns(file: string) {
    const rel = relative(this.dir, file);
    return !!rel && !rel.startsWith("..") && !isAbsolute(rel);
  }

  inScope(file: string, scope: Scope) {
    this.scope = scope;
    const meta = this.metaOf(file);
    if (!meta || meta.reviewer) return false;
    const folders = [meta.cwd, ...meta.roots].filter(Boolean);
    if (scope.override) return folders.some((f) => f.includes(scope.override!));
    return folders.some((f) => this.inRoots(this.rewrite(meta, f)));
  }

  private inRoots(p: string) { return this.scope.roots.some((r) => within(p, r)); }

  /** The file's first line, read once (up to its first newline). */
  private metaOf(file: string): Meta | null {
    const hit = this.metas.get(file);
    if (hit !== undefined) return hit;
    let line: string | null = null;
    let fd: number | undefined;
    try {
      fd = openSync(file, "r");
      const parts: Buffer[] = [];
      let pos = 0;
      while (pos < FIRST_LINE_MAX) {
        const buf = Buffer.allocUnsafe(64 * 1024);
        const n = readSync(fd, buf, 0, buf.length, pos);
        if (n <= 0) break;
        const nl = buf.subarray(0, n).indexOf(0x0a);
        if (nl !== -1) { parts.push(buf.subarray(0, nl)); line = Buffer.concat(parts).toString("utf8"); break; }
        parts.push(Buffer.from(buf.subarray(0, n)));
        pos += n;
      }
    } catch { return null; } finally { if (fd !== undefined) closeSync(fd); }
    if (line === null) return null; // still being written: try again on its next change
    let meta: Meta | null = null;
    try {
      const o = JSON.parse(line) as { type?: string; payload?: any };
      const p = o.payload ?? {};
      if (o.type === "session_meta") {
        meta = {
          id: str(p.id) ?? str(p.session_id) ?? UUID.exec(file)?.[1] ?? basename(file, ".jsonl"),
          cwd: str(p.cwd) ?? "",
          roots: Array.isArray(p.runtime_workspace_roots) ? p.runtime_workspace_roots.filter((r: unknown) => typeof r === "string") : [],
          repoUrl: str(p.git?.repository_url),
          version: versionOf(p.cli_version),
          reviewer: p.source?.subagent?.other === "guardian",
        };
      }
    } catch { /* not JSON */ }
    this.metas.set(file, meta);
    return meta;
  }

  // ---- Codex's worktrees: <codexDir>/worktrees/<id>/<repo>/… is the repo's main checkout, for the map ----

  /** The worktree checkout a path is in, and the repo it belongs to; null if it isn't in one (or the repo is unknown). */
  private worktreeOf(meta: Meta, p: string): { checkout: string; main: string } | null {
    const rel = relative(this.worktreesDir, p);
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) return null;
    const [id, repo] = rel.split(sep);
    if (!id || !repo) return null;
    const checkout = join(this.worktreesDir, id, repo);
    const main = this.mainOf(checkout, repo, meta);
    return main ? { checkout, main } : null;
  }

  private mainOf(checkout: string, repo: string, meta: Meta): string | null {
    let main = this.mains.get(checkout);
    if (main === undefined) {
      main = null;
      try {
        const gitdir = /^gitdir:\s*(.+)$/m.exec(readFileSync(join(checkout, ".git"), "utf8"))?.[1]?.trim();
        const at = gitdir ? gitdir.replace(/\\/g, "/").lastIndexOf("/.git/worktrees/") : -1;
        if (gitdir && at !== -1) main = resolve(checkout, gitdir.slice(0, at));
      } catch { /* the worktree is gone */ }
      if (main) this.mains.set(checkout, main);
    }
    if (main) return main;
    // Gone (Codex removes them): the open project, if it has the same remote, else the same folder name.
    const url = meta.repoUrl && normalizeRemote(meta.repoUrl);
    if (url) for (const r of this.scope.roots) if (this.remotesOf(r).includes(url)) return r;
    return this.scope.roots.find((r) => basename(r) === repo) ?? null;
  }

  private remotesOf(root: string): string[] {
    let hit = this.remotes.get(root);
    if (!hit) {
      hit = [];
      try {
        for (const m of readFileSync(join(root, ".git", "config"), "utf8").matchAll(/^\s*url\s*=\s*(.+)$/gm)) hit.push(normalizeRemote(m[1].trim()));
      } catch { /* not a repo, or a worktree (.git is a file) */ }
      this.remotes.set(root, hit);
    }
    return hit;
  }

  /** A path as the map knows it: inside a Codex worktree, the same path in the repo's main checkout. */
  private rewrite(meta: Meta, p: string): string {
    const wt = this.worktreeOf(meta, p);
    return wt ? wt.main + p.slice(wt.checkout.length) : p;
  }

  // ---- parsing ----

  private stateOf(file: string, line: { type?: string }): FileState | null {
    let st = this.states.get(file);
    if (st) return st;
    const meta = this.metaOf(file);
    if (!meta) return null;
    const fileId = UUID.exec(file)?.[1] ?? meta.id;
    st = { file, meta, sessionId: meta.id, fileId, fromStart: line.type === "session_meta", cwd: meta.cwd, calls: new Map(), patched: new Set() };
    this.states.set(file, st);
    return st;
  }

  parse(file: string, line: unknown, sink: Sink) {
    const o = line as { timestamp?: string; ordinal?: number; type?: string; payload?: any };
    if (!o || typeof o !== "object" || !o.payload || typeof o.payload !== "object") return;
    const st = this.stateOf(file, o);
    if (!st || st.meta.reviewer) return;
    const p = o.payload;
    const ts = o.timestamp ?? new Date().toISOString();
    const at: At = { st, sink, ts, key: o.ordinal !== undefined ? `o${o.ordinal}` : createHash("sha1").update(JSON.stringify(o)).digest("hex").slice(0, 16) };
    switch (o.type) {
      case "turn_context":
        if (typeof p.cwd === "string" && p.cwd) st.cwd = p.cwd;
        return;
      case "event_msg":
        if (p.type === "task_started") { st.turnId = str(p.turn_id); st.turnStart = ts; }
        else if (p.type === "item_completed" && p.item && typeof p.item === "object") { st.items = true; this.item(at, p.item, str(p.turn_id)); }
        return;
      case "response_item":
        return this.response(at, p);
      // session_meta, world_state, token_usage_record, compacted (the recap Codex keeps; ContextCompaction marks it): nothing.
    }
  }

  /** Built from items: every Codex since 0.94, and older files where one turned up. */
  private itemsMode(st: FileState): boolean {
    if (st.items === undefined) st.items = st.meta.version >= ITEMS_SINCE || fileHas(st.file, '"item_completed"');
    return st.items;
  }

  // ---- item_completed ----

  private item(at: At, it: any, turnId: string | undefined) {
    const { st } = at;
    const id = typeof it.id === "string" && it.id.length >= 20 && it.type !== "Reasoning" ? `${st.sessionId}:${it.id}` : `${st.fileId}:${at.key}`;
    switch (it.type) {
      case "UserMessage": return this.userMessage(at, id, it.content);
      case "AgentMessage": {
        const text = blocksText(it.content, ["Text", "text", "output_text"]);
        if (text.trim()) this.emit(at, { id, kind: "text", text: sanitizeText(text, TEXT_LIMIT) });
        return;
      }
      case "Reasoning": {
        const parts = [...(Array.isArray(it.summary_text) ? it.summary_text : []), ...(Array.isArray(it.raw_content) ? it.raw_content : [])]
          .map((x: unknown) => (typeof x === "string" ? x : str((x as any)?.text) ?? "")).filter((x: string) => x.trim());
        if (parts.length) this.emit(at, { id, kind: "thinking", text: sanitizeText(parts.join("\n\n"), TEXT_LIMIT) });
        return;
      }
      case "CommandExecution": {
        if (st.ceTs === undefined) { st.ceTurn = turnId; st.ceTs = turnId && turnId === st.turnId && st.turnStart ? st.turnStart : at.ts; }
        return this.commandItem(at, id, it);
      }
      case "FileChange": {
        if (typeof it.id === "string" && it.id.startsWith("call_")) st.patched.add(it.id);
        const failed = it.status === "failed" || it.status === "declined";
        const note = str(it.stdout) || (it.status === "declined" ? "The change was declined." : failed ? "The change failed." : "Done.");
        for (const [path, ch] of Object.entries((it.changes ?? {}) as Record<string, any>)) {
          const kind = ch?.type === "add" ? "add" : ch?.type === "delete" ? "delete" : "update";
          const diff = str(ch?.unified_diff) ?? "";
          const ba = kind === "add" ? { before: "", after: str(ch?.content) ?? "" } : kind === "delete" ? { before: str(ch?.content) ?? "", after: "" } : diffToBeforeAfter(diff);
          this.fileEdit(at, `${id}:${path}`, { kind, path, movePath: str(ch?.move_path), ...ba, diff }, { failed, text: note });
        }
        return;
      }
      case "McpToolCall": {
        const tool = `mcp__${it.server ?? "mcp"}__${it.tool ?? "tool"}`;
        const r = it.result ?? {};
        const failed = it.status === "failed" || r.isError === true;
        const text = outputText(r.content ?? (it.error ? String(it.error?.message ?? it.error) : ""));
        this.callAndResult(at, id, tool, it.arguments ?? {}, undefined, { text: text || (failed ? "Failed." : ""), failed });
        return;
      }
      case "WebSearch":
        return this.webSearch(at, id, it.action, str(it.query), undefined);
      case "Extension":
        if (it.kind === "web.search") return this.webSearch(at, id, it.action, str(it.query), it.results);
        {
          // image_gen.generation, clock.sleep…: its fields as input (not the image itself).
          const { type: _t, id: _id, result: _r, ...input } = it;
          const failed = it.status === "failed" || !!it.failure;
          this.callAndResult(at, id, String(it.kind ?? "extension"), input, undefined, { text: str(it.savedPath) ? `Saved to ${it.savedPath}` : failed ? String(it.failure ?? "Failed.") : "Done.", failed });
        }
        return;
      case "ImageView": {
        const path = str(it.path);
        if (path) this.callAndResult(at, id, "Read", { file_path: this.abs(st, path) }, this.abs(st, path), { text: "", failed: false });
        return;
      }
      case "ContextCompaction":
        this.emit(at, { id, kind: "text", text: "Codex summarised the conversation so far to make room." });
        return;
      case "FunctionCallOutput": {
        // A thread another Codex thread started (create_thread): the task it was given is its first prompt.
        const out = str(it.output) ?? "";
        const task = /<codex_delegation>[\s\S]*?<input>([\s\S]*?)(<\/input>|$)/.exec(out)?.[1]?.trim();
        if (it.name === "create_thread" && task) this.emit(at, { id, kind: "prompt", text: sanitizeText(task, TEXT_LIMIT) }, codexPrompt(task).title);
        return;
      }
      // SubAgentActivity (Codex's own subagents: not read yet).
    }
  }

  private userMessage(at: At, id: string, content: unknown) {
    const blocks = Array.isArray(content) ? content : [];
    const texts = blocks.filter((b: any) => (b?.type === "text" || b?.type === "input_text") && typeof b.text === "string").map((b: any) => b.text as string);
    const images = blocks.filter((b: any) => b?.type === "local_image" && typeof b.path === "string").map((b: any) => `[Image: ${basename(b.path)}]`);
    const raw = texts.join("\n\n");
    const reply = questionReply(raw);
    if (reply) {
      const ask = reply.callId ? `${at.st.sessionId}:${reply.callId}` : at.st.lastAsk;
      this.emit(at, { id, kind: "tool_result", text: sanitizeText(reply.text, TOOL_RESULT_LIMIT), ...(ask ? { toolUseId: ask } : {}) });
      return;
    }
    if (isInjected(raw)) return;
    const { text, title } = codexPrompt(raw);
    const full = [text, ...images].filter((x) => x.trim()).join("\n\n");
    if (!full.trim()) return;
    this.emit(at, { id, kind: "prompt", text: sanitizeText(full, TEXT_LIMIT) }, title || images[0]);
  }

  private commandItem(at: At, id: string, it: any) {
    const st = at.st;
    const command = commandString(it.command);
    const cwd = fileUrl(str(it.cwd)) ?? st.cwd;
    const out = str(it.aggregated_output) ?? `${str(it.stdout) ?? ""}${str(it.stderr) ?? ""}`;
    const exit = typeof it.exit_code === "number" ? it.exit_code : undefined;
    const failed = it.status === "failed" || (exit !== undefined && exit !== 0);
    const res = { text: exit ? `Exit code ${exit}\n${out}` : failed ? `Exit code 1\n${out}` : out, failed };
    const parsed: any[] = Array.isArray(it.parsed_cmd) ? it.parsed_cmd : [];
    // Codex already says what a command did: read a file, search, list files. Each lands on the map as Claude's would.
    const known = parsed.length > 0 && parsed.every((c) => (c?.type === "read" && typeof c.path === "string") || c?.type === "search" || c?.type === "list_files");
    if (!known) return this.callAndResult(at, id, "Bash", { command }, undefined, res);
    parsed.forEach((c, k) => {
      const sid = parsed.length > 1 ? `${id}#${k}` : id;
      const path = typeof c.path === "string" && c.path ? this.abs(st, c.path, cwd) : undefined;
      if (c.type === "read") this.callAndResult(at, sid, "Read", { file_path: path, command }, path, res);
      else if (c.type === "search") this.callAndResult(at, sid, "Grep", { pattern: str(c.query) ?? str(c.cmd) ?? command, ...(path ? { path } : {}), command }, path, res);
      else this.callAndResult(at, sid, "Glob", { pattern: str(c.cmd) ?? command, ...(path ? { path } : {}), command }, path, res);
    });
  }

  private webSearch(at: At, id: string, action: any, query: string | undefined, results: unknown) {
    const type = String(action?.type ?? "search").replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`); // openPage → open_page
    const url = str(action?.url);
    let tool = "WebSearch";
    let input: Record<string, unknown>;
    if ((type === "open_page" || type === "find_in_page") && url) {
      tool = "WebFetch";
      input = { url, ...(str(action?.pattern) ? { prompt: `Find “${action.pattern}”` } : {}) };
    } else {
      input = { query: str(action?.query) ?? query ?? "", ...(Array.isArray(action?.queries) && action.queries.length > 1 ? { queries: action.queries } : {}) };
    }
    this.callAndResult(at, id, tool, input, undefined, { text: searchResults(String(input.query ?? url ?? ""), results), failed: false });
  }

  // ---- the model's records (response_item) ----

  private response(at: At, p: any) {
    const { st } = at;
    const items = this.itemsMode(st);
    if (p.type === "function_call" || p.type === "custom_tool_call" || p.type === "local_shell_call") {
      const name = p.type === "local_shell_call" ? "local_shell" : String(p.name ?? "");
      const callId = str(p.call_id) ?? str(p.id);
      if (!callId) return;
      let args: any = p.type === "custom_tool_call" ? p.input : p.type === "local_shell_call" ? p.action : p.arguments;
      if (p.type === "function_call" && typeof args === "string") { try { args = JSON.parse(args); } catch { /* kept as text */ } }
      if (/^request_user_input/.test(name)) return this.ask(at, callId, args);
      if (!items || OWN_CALLS.has(name)) st.calls.set(callId, { name, args, ts: at.ts, turnId: str(p.internal_chat_message_metadata_passthrough?.turn_id) ?? st.turnId });
      return;
    }
    if (p.type === "function_call_output" || p.type === "custom_tool_call_output") {
      const callId = str(p.call_id);
      const call = callId ? st.calls.get(callId) : undefined;
      if (!callId || !call) return; // a call stored by an item, or made before a restart
      st.calls.delete(callId);
      return this.finish(at, callId, call, p.output);
    }
    if (items) return; // the rest is in the items
    if (p.type === "message") {
      const role = p.role;
      if (role === "assistant") {
        const text = blocksText(p.content, ["output_text", "text"]);
        if (text.trim()) this.emit(at, { id: `${st.fileId}:${at.key}`, kind: "text", text: sanitizeText(text, TEXT_LIMIT) });
      } else if (role === "user") {
        const blocks = (Array.isArray(p.content) ? p.content : []).filter((b: any) => b?.type === "input_text" && typeof b.text === "string" && !isInjected(b.text));
        if (blocks.length) this.userMessage(at, `${st.fileId}:${at.key}`, blocks);
      }
      return;
    }
    if (p.type === "reasoning") {
      const text = (Array.isArray(p.summary) ? p.summary : []).map((s: any) => str(s?.text) ?? "").filter((s: string) => s.trim()).join("\n\n");
      if (text) this.emit(at, { id: `${st.fileId}:${at.key}`, kind: "thinking", text: sanitizeText(text, TEXT_LIMIT) });
      return;
    }
    if (p.type === "web_search_call") return this.webSearch(at, `${st.fileId}:${at.key}`, p.action, undefined, undefined);
  }

  /** Codex asked the person something: open until the answer comes (attention shows "Your turn"). */
  private ask(at: At, callId: string, args: any) {
    const qs: any[] = Array.isArray(args?.questions) ? args.questions : [args];
    const questions = qs.map((q) => ({
      question: str(q?.question) ?? str(q?.title) ?? str(q?.prompt) ?? "",
      ...(Array.isArray(q?.options) ? { options: q.options.map((o: any) => (typeof o === "string" ? { label: o } : { label: str(o?.label) ?? str(o?.title) ?? JSON.stringify(o), ...(str(o?.description) ? { description: o.description } : {}) })) } : {}),
    }));
    const id = `${at.st.sessionId}:${callId}`;
    at.st.lastAsk = id;
    at.st.calls.set(callId, { name: "request_user_input", args, ts: at.ts });
    this.emit(at, { id, kind: "tool_call", tool: "AskUserQuestion", input: sanitizeDeep({ questions }), toolUseId: id });
  }

  /** A call Codex finished: its step and result, now. */
  private finish(at: At, callId: string, call: Call, output: unknown) {
    const { st } = at;
    const id = `${st.sessionId}:${callId}`;
    const raw = outputText(output);
    const args = call.args ?? {};
    switch (call.name) {
      case "exec_command": case "shell_command": case "shell": case "local_shell": case "container.exec": {
        const command = str(args.cmd) ?? (typeof args.command === "string" ? args.command : commandString(args.command));
        return this.command(at, id, command, str(args.workdir), shellResult(raw));
      }
      case "exec": { // a script calling Codex's tools
        const code = typeof args === "string" ? args : str(args.code) ?? str(args.input) ?? "";
        for (const [k, plan] of execCalls(code, "update_plan").entries()) this.plan(at, `${id}#plan${k}`, plan);
        if (this.commandsFromItems(st, call)) return;
        let cmds = execCalls(code, "exec_command").filter((c) => typeof c.cmd === "string");
        // Commands built in the script (a variable, a loop): the script itself is the command.
        if (!cmds.length && /tools\.exec_command\s*\(/.test(code)) cmds = [{ cmd: code }];
        const res = shellResult(raw);
        cmds.forEach((c, k) => {
          const last = k === cmds.length - 1;
          this.command(at, cmds.length > 1 ? `${id}#${k}` : id, String(c.cmd), str(c.workdir), last ? res : { text: "Its output is with the script's last command.", failed: false });
        });
        return;
      }
      case "apply_patch": {
        if (st.patched.has(callId)) return; // the FileChange item stored it
        const res = shellResult(raw);
        const patch = typeof args === "string" ? args : str(args.input) ?? str(args.patch) ?? "";
        for (const f of parsePatch(patch)) {
          const path = this.absRaw(st, f.path);
          this.fileEdit(at, `${id}:${path}`, { ...f, path, movePath: f.movePath ? this.absRaw(st, f.movePath) : undefined }, { text: res.text || "Done.", failed: res.failed });
        }
        return;
      }
      case "update_plan": return this.plan(at, id, args, raw);
      case "view_image": {
        const path = str(args.path);
        if (path) this.callAndResult(at, id, "Read", { file_path: this.abs(st, path) }, this.abs(st, path), { text: "", failed: false });
        return;
      }
      case "request_user_input": {
        if (/^\s*\{"accepted":/.test(raw)) return; // asked, the answer comes later (as a user turn)
        this.emit(at, { id: `${id}:result`, kind: "tool_result", text: sanitizeText(raw, TOOL_RESULT_LIMIT), toolUseId: id });
        return;
      }
      default: // a file without items: any other tool, as it is
        return this.callAndResult(at, id, call.name, typeof args === "object" && args ? args : { input: args }, undefined, { text: raw, failed: false });
    }
  }

  /** A command Codex logged without saying what it did: a plain read of files lands on the map as Read, else Bash. */
  private command(at: At, id: string, command: string, workdir: string | undefined, res: { text: string; failed: boolean }) {
    const reads = readsOf(command);
    if (!reads) return this.callAndResult(at, id, "Bash", { command }, undefined, res);
    reads.forEach((f, k) => {
      const path = this.abs(at.st, f, workdir);
      this.callAndResult(at, reads.length > 1 ? `${id}#r${k}` : id, "Read", { file_path: path, command }, path, res);
    });
  }

  private plan(at: At, id: string, args: any, result = "Plan updated") {
    const items: any[] = Array.isArray(args?.plan) ? args.plan : [];
    const todos = items.map((x) => ({ content: str(x?.step) ?? str(x?.content) ?? "", status: todoStatus(x?.status) }));
    this.callAndResult(at, id, "TodoWrite", { todos, ...(str(args?.explanation) ? { explanation: args.explanation } : {}) }, undefined, { text: result, failed: false });
  }

  /** Before 0.149, Codex logged no item for a command its `exec` script ran: take it from the script, unless a newer
   * Codex (that resumed the thread) already logged it. */
  private commandsFromItems(st: FileState, call: Call): boolean {
    if (st.meta.version >= COMMAND_ITEMS_SINCE) return true;
    if (st.ceTs === undefined && !st.fromStart && !st.ceScanned) {
      st.ceScanned = true;
      const first = firstCommandItem(st.file);
      if (first) { st.ceTurn = first.turnId; st.ceTs = first.turnStart ?? first.ts; }
    }
    if (st.ceTs === undefined) return false;
    return (!!call.turnId && call.turnId === st.ceTurn) || call.ts >= st.ceTs;
  }

  // ---- steps ----

  private fileEdit(at: At, id: string, f: { kind: string; path: string; movePath?: string; before: string; after: string; diff: string }, res: { text: string; failed: boolean }) {
    const st = at.st;
    const from = this.abs(st, f.path);
    const path = f.movePath ? this.abs(st, f.movePath) : from;
    const tool = f.kind === "add" ? "Write" : "Edit";
    const input = f.kind === "add" ? { file_path: path, content: f.after } : { file_path: path, ...(f.diff ? { unified_diff: f.diff } : {}), ...(f.movePath ? { move_path: path, from } : {}), ...(f.kind === "delete" ? { deleted: true } : {}) };
    this.emit(at, {
      id, kind: "edit", tool, input: sanitizeDeep(input), filePath: path, toolUseId: id,
      diff: { before: sanitizeText(f.before, TEXT_LIMIT), after: sanitizeText(f.after, TEXT_LIMIT) },
    });
    this.result(at, id, res);
  }

  private callAndResult(at: At, id: string, tool: string, input: Record<string, unknown>, filePath: string | undefined, res: { text: string; failed: boolean } | ShellResult) {
    this.emit(at, { id, kind: "tool_call", tool, input: sanitizeDeep(input), ...(filePath ? { filePath } : {}), toolUseId: id });
    this.result(at, id, res);
  }

  private result(at: At, callId: string, res: { text: string; failed: boolean }) {
    this.emit(at, {
      id: `${callId}:result`, kind: "tool_result", text: sanitizeText(res.text, TOOL_RESULT_LIMIT), toolUseId: callId,
      ...(res.failed ? { input: { isError: true, toolUseId: callId } } : {}), // read by the failures module
    });
  }

  private emit(at: At, s: { id: string; kind: StepKind } & Partial<NewStep>, title?: string) {
    const st = at.st;
    const step = { ...s, sessionId: st.sessionId, ts: at.ts, isSubagent: false } as NewStep;
    at.sink.step(step, { cwd: this.threadCwd(st), ...(s.kind === "prompt" && title ? { promptTitle: title } : {}) });
  }

  /** Where the thread works, for its row: the folder of this turn (in the repo's main checkout), else the first of the
   * thread's folders in the open project. */
  private threadCwd(st: FileState): string {
    const cwd = this.rewrite(st.meta, st.cwd || st.meta.cwd);
    if (this.scope.override || this.inRoots(cwd)) return cwd;
    for (const f of [st.meta.cwd, ...st.meta.roots]) { const r = this.rewrite(st.meta, f); if (this.inRoots(r)) return r; }
    return cwd;
  }

  /** An absolute path, as the map knows it. */
  private abs(st: FileState, p: string, base?: string): string { return this.rewrite(st.meta, this.absRaw(st, p, base)); }
  private absRaw(st: FileState, p: string, base?: string): string {
    const u = fileUrl(p) ?? p;
    return isAbsolute(u) ? u : resolve(base ?? (st.cwd || st.meta.cwd || "/"), u);
  }
}

/** Where a parse is: the file, the sink, the line's time and a key unique to the line in its file. */
type At = { st: FileState; sink: Sink; ts: string; key: string };

/** Calls taken from the model's records even when the file has items (no item covers them). */
const OWN_CALLS = new Set(["exec_command", "shell_command", "shell", "local_shell", "container.exec", "exec", "apply_patch", "update_plan", "view_image"]);

const fileUrl = (p: string | undefined) => { if (!p) return undefined; if (!p.startsWith("file:")) return p; try { return fileURLToPath(p); } catch { return undefined; } };

function blocksText(content: unknown, types: string[]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((b: any) => types.includes(b?.type) && typeof b.text === "string").map((b: any) => b.text).join("\n\n");
}

/** Web search results as Claude Code's WebSearch returns them ("Links: [...]" then the text), for the web's view. */
function searchResults(query: string, results: unknown): string {
  const rs = Array.isArray(results) ? results : [];
  if (!rs.length) return "Codex didn't keep the results.";
  const links = rs.filter((r: any) => typeof r?.url === "string").map((r: any) => ({ title: str(r.title) ?? r.url, url: r.url }));
  const text = rs.map((r: any) => [str(r?.title), str(r?.snippet) ?? str(r?.text)].filter(Boolean).join("\n")).filter(Boolean).join("\n\n");
  return `Web search results for query: "${query}"\n\n${links.length ? `Links: ${JSON.stringify(links)}\n\n` : ""}${text}`;
}

const normalizeRemote = (url: string) => url.trim().replace(/^[a-z+]+:\/\//i, "").replace(/^[^@/]+@/, "").replace(/:(?!\d)/, "/").replace(/\.git$/, "").replace(/\/+$/, "").toLowerCase();

/** True if the file contains `needle` (read a few MB at a time). */
function fileHas(file: string, needle: string): boolean {
  let fd: number | undefined;
  try {
    fd = openSync(file, "r");
    const n = Buffer.from(needle);
    const buf = Buffer.allocUnsafe(4 * 1024 * 1024);
    let pos = 0;
    for (;;) {
      const got = readSync(fd, buf, 0, buf.length, pos);
      if (got <= 0) return false;
      if (buf.subarray(0, got).indexOf(n) !== -1) return true;
      if (got < buf.length) return false;
      pos += got - n.length; // a match across the cut
    }
  } catch { return false; } finally { if (fd !== undefined) closeSync(fd); }
}

/** The first command item in a file, and the start of its turn (for a file read from the middle after a restart). */
function firstCommandItem(file: string): { ts: string; turnId?: string; turnStart?: string } | null {
  let fd: number | undefined;
  try {
    fd = openSync(file, "r");
    const buf = Buffer.allocUnsafe(4 * 1024 * 1024);
    let pos = 0;
    let rest = "";
    let turnStart: { id?: string; ts?: string } = {};
    for (;;) {
      const got = readSync(fd, buf, 0, buf.length, pos);
      if (got <= 0) return null;
      pos += got;
      const text = rest + buf.toString("utf8", 0, got); // a multibyte character cut at the end only affects that line's text
      const lines = text.split("\n");
      rest = lines.pop() ?? "";
      for (const l of lines) {
        if (l.includes('"type":"task_started"')) {
          try { const o = JSON.parse(l); turnStart = { id: o.payload?.turn_id, ts: o.timestamp }; } catch { /* skip */ }
        } else if (l.includes('"type":"CommandExecution"') && l.includes('"item_completed"')) {
          try {
            const o = JSON.parse(l);
            if (o.payload?.item?.type !== "CommandExecution") continue;
            const turnId = o.payload?.turn_id;
            return { ts: o.timestamp, turnId, turnStart: turnId && turnId === turnStart.id ? turnStart.ts : undefined };
          } catch { /* skip */ }
        }
      }
      if (rest.length > 64 * 1024 * 1024) rest = ""; // a giant line: no item in it
    }
  } catch { return null; } finally { if (fd !== undefined) closeSync(fd); }
}

function collectJsonl(dir: string, out: LogFile[], depth: number) {
  if (depth > 4) return;
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return; }
  for (const name of entries) {
    const p = join(dir, name);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) collectJsonl(p, out, depth + 1);
    else if (name.endsWith(".jsonl")) out.push({ path: p, mtimeMs: st.mtimeMs, size: st.size });
  }
}
