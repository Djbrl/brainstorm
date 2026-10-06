// Owner: A. Codex's session logs (~/.codex/sessions). Placeholder until the Codex reader lands: watches nothing.
import type { LogFile, LogSource, Scope, Sink, WatchEvents } from "./source";

export class CodexSource implements LogSource {
  readonly harness = "codex" as const;
  constructor(private readonly dir: string, private readonly onError: (e: Error) => void = () => {}) {}
  watch(_scope: Scope, on: WatchEvents) { setImmediate(() => on.ready()); }
  rescope(_scope: Scope) {}
  async close() {}
  list(_scope: Scope): LogFile[] { return []; }
  owns(_file: string) { return false; }
  inScope(_file: string, _scope: Scope) { return false; }
  parse(_file: string, _line: unknown, _sink: Sink) {}
}
