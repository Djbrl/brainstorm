// Owner: A. A log source: one coding agent's session logs on disk (Claude Code's ~/.claude/projects, Codex's
// ~/.codex/sessions). The listener (listener.service.ts) does what's the same for every agent: it tails the files a
// source points it to, a chunk at a time, stores what the source parses from each line and tells the app. A source
// knows where its logs are, which of them belong to the open project, and what a line means.
import type { Harness, Step } from "../types";

/** A step as a source parses it: the listener numbers it (`seq`) as it stores it. */
export type NewStep = Omit<Step, "seq">;

/** What a source can do with a line it parsed. */
export interface Sink {
  /** Store a step. `cwd` is where the thread works now (kept when empty); `promptTitle` the raw text of a prompt,
   * which can title the thread. The thread's row is created on its first step, with the source's harness. */
  step(step: NewStep, opts?: { cwd?: string; promptTitle?: string }): void;
  /** The person named the thread. */
  customTitle(sessionId: string, title: string): void;
  /** The agent finished its turn (Codex logs it; Claude Code's Stop hook says the same through the plugin). Live only:
   * a turn that ended in history isn't news. */
  turnEnded(sessionId: string): void;
}

/** The open project: its root, the repo's main checkout and the folders it lived in before it moved. */
export type Scope = {
  roots: string[];
  /** SESSION_FILTER: a substring of Claude Code's project folder names, instead of the roots (old behaviour). */
  override?: string;
};

export type LogFile = { path: string; mtimeMs: number; size: number };

export interface WatchEvents {
  /** A log file appeared (during the first scan too). */
  add(file: string): void;
  /** A log file grew. */
  change(file: string): void;
  /** The first scan is over. */
  ready(): void;
}

export interface LogSource {
  readonly harness: Harness;
  /** Start watching the logs of `scope`. */
  watch(scope: Scope, on: WatchEvents): void;
  /** The project changed: watch its logs from now on (the listener backfills them right after). */
  rescope(scope: Scope): void;
  close(): Promise<void>;
  /** The project's log files, for reading its history. */
  list(scope: Scope): LogFile[];
  /** True if the file is one of this source's logs (any project). */
  owns(file: string): boolean;
  /** True if the file belongs to the project: checked before every read of it. */
  inScope(file: string, scope: Scope): boolean;
  /** Parse one line of `file` (a JSON value) into the sink. A throw skips the line with a warning; a database
   * error rolls the chunk back. Lines arrive in order, but reading can resume anywhere after a restart: what a source
   * needs from a file's first line (Codex's session id) it must be able to get from the file again. */
  parse(file: string, line: unknown, sink: Sink): void;
  /** The folders it watches, as chokidar's getWatched gives them (tests). */
  getWatched?(): Record<string, string[]>;
  /** Threads to leave out of the list although stored (Claude: deleted in its desktop app). `files`: every log read. */
  hidden?(files: Iterable<string>): (sessionId: string) => boolean;
}
