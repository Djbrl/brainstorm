import { Injectable, Logger } from "@nestjs/common";
import type { Session, Step } from "../shared/contract";

/** In-process events between modules. Listener emits, reader/mapper react. */
export type BusEvents = {
  "session": [Session];
  "step": [Step];                               // new step stored (listener → reader, mapper)
  "file-touched": [{ path: string; sessionId: string; ts: string }]; // an agent edited a file (listener → mapper)
  "workspace": [{ root: string }];               // the active workspace changed (workspace → listener, mapper, reader)
  "files-changed": [{ root: string }];          // the mapper saw files change in the project
  "turn-ended": [{ sessionId: string }];        // an agent finished its turn, from its log (listener → attention)
  // a mapped file changed on disk: what it was (null: unknown, "": it didn't exist) and is (null: deleted) (mapper → listener)
  // a map was built: the folders its .gitignore excludes (undefined: not a git repo), kept up to date in place (mapper → listener)
  "map-rules": [{ root: string; ignoredDirs: Set<string> | undefined }];
  // before/after are read on demand (getters over deflated copies, mapper/live.ts fileChange); bytes: what it holds
  "file-content": [{ path: string; before: string | null; after: string | null; at: number; bytes?: number }];
};

type Fn = (...args: any[]) => unknown;

/** Listeners run one after another, each on its own: one that throws (or rejects) is logged and the rest still get
 * the event, and the error never reaches the emitter (the listener's per-line loop would skip the line's other blocks). */
@Injectable()
export class BusService {
  private log = new Logger("Bus");
  private listeners = new Map<keyof BusEvents, Fn[]>();

  emit<K extends keyof BusEvents>(event: K, ...args: BusEvents[K]) {
    const fns = this.listeners.get(event);
    if (!fns) return;
    for (const fn of [...fns]) { // a copy: a listener may add another
      try {
        const r = fn(...args);
        if (r instanceof Promise) r.catch((e) => this.fail(event, e));
      } catch (e) { this.fail(event, e); }
    }
  }

  on<K extends keyof BusEvents>(event: K, fn: (...args: BusEvents[K]) => unknown) {
    const fns = this.listeners.get(event) ?? this.listeners.set(event, []).get(event)!;
    fns.push(fn as Fn);
  }

  private fail(event: string, e: unknown) {
    this.log.warn(`a "${event}" listener failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}
