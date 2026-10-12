// Builds a ListenerService on a scratch database and a scratch Claude Code folder, without Nest or an HTTP server.
import "reflect-metadata";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WsMessage } from "../shared/contract";
import type { LogSource, Scope } from "../listener/source";
import type { CodexSource } from "../listener/codex.source";
import { BusService } from "../core/bus.service";
import { ConfigService } from "../core/config.service";
import { DbService } from "../core/db.service";
import { WorkspaceState } from "../core/workspace-state";
import { ListenerService } from "../listener/listener.service";

/** The listener's private parts some tests look at (one cast, here, instead of one per test). */
export interface ListenerInternals {
  ready: boolean;
  isListening: boolean;
  sources: LogSource[];
  codex?: CodexSource;
  log: { log(m: string): void; warn(m: string): void };
  scope(): Scope;
  project: { visitorsFound: Promise<void> };
  setRoot(root: string): void;
  rereadChangedSources(): void;
  backfillForNewFilter(): void;
}
export const internals = (l: ListenerService) => l as unknown as ListenerInternals;

export type TestListener = Awaited<ReturnType<typeof makeListener>>;

/**
 * A fresh service on its own database. Logs for workspace `root` go in `projectDir`. With `watch: false` (default) the
 * file watcher is closed right away and tests read files themselves (`readNow`), as live activity once `live()` is on.
 */
export async function makeListener({ root = "/work/demo-repo", watch = false } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), "bs-listener-"));
  process.env.RUNDOWN_DATA_DIR = join(tmp, "data");
  process.env.RUNDOWN_CLAUDE_DIR = join(tmp, "claude");
  process.env.RUNDOWN_CODEX_DIR = join(tmp, "codex"); // never the person's real ~/.codex
  process.env.MAP_ROOT = root;
  const projectDir = join(process.env.RUNDOWN_CLAUDE_DIR, root.replace(/[^A-Za-z0-9-]/g, "-"));
  mkdirSync(projectDir, { recursive: true });
  const sent: WsMessage[] = [];
  const gateway = { broadcast: (m: WsMessage) => { sent.push(JSON.parse(JSON.stringify(m))); } };
  const dbs = new DbService();
  const bus = new BusService();
  const cfg = new ConfigService();
  const state = new WorkspaceState();
  const listener = new ListenerService(dbs, bus, gateway, cfg, state);
  listener.onModuleInit();
  if (!watch) await listener.watcher.close();
  return {
    listener, dbs, bus, cfg, state, sent, tmp, projectDir, root,
    /** The listener's private parts. */
    inner: internals(listener),
    /** Steps go out as live activity from now on. */
    live() { listener.forTests.goLive(); },
    /** Read what `file` gained; `history` reads it quietly. */
    readNow(file: string, history = false) { return listener.forTests.readNow(file, history); },
    async close() { await listener.onModuleDestroy(); dbs.db.close(); rmSync(tmp, { recursive: true, force: true }); },
  };
}

let n = 0;
export const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
export const ts = (i: number) => new Date(Date.UTC(2026, 9, 1, 12, 0, i)).toISOString();

type LineKind = "prompt" | "text" | "tool" | "edit" | "result";
type LineOpts = { sessionId?: string; cwd?: string; i?: number; text?: string; tool?: string; input?: unknown; id?: string };
/** A Claude Code log line, loosely typed: tests add fields freely. */
export type LogLine = Record<string, any>;

/** Claude Code log lines for a small thread. */
export function line(kind: LineKind, { sessionId = "s1", cwd = "/work/demo-repo", i = 0, text, tool, input, id }: LineOpts = {}): LogLine {
  const base = { uuid: id ?? uuid(), sessionId, cwd, timestamp: ts(i) };
  if (kind === "prompt") return { ...base, type: "user", message: { role: "user", content: text ?? "do the thing" } };
  if (kind === "text") return { ...base, type: "assistant", message: { role: "assistant", content: [{ type: "text", text: text ?? "ok" }] } };
  if (kind === "tool") return { ...base, type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: `tu_${base.uuid}`, name: tool ?? "Bash", input: input ?? { command: "ls" } }] } };
  if (kind === "edit") return { ...base, type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: `tu_${base.uuid}`, name: "Edit", input: input ?? { file_path: "/work/demo-repo/a.ts", old_string: "a", new_string: "b" } }] } };
  return { ...base, type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: input ?? "tu_x", content: text ?? "done" }] } };
}
export const jsonl = (lines: unknown[]) => lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
