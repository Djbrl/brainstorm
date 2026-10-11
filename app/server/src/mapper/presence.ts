import { relative, resolve } from "node:path";
import type { FileNode } from "../shared/contract";
import type { EventsGateway } from "../core/events.gateway";
import { mappableRel as mappable } from "./ignore";
import type { Cached } from "./live";

// Which files agents are working on now: an agent's edit marks its file on the map for a minute. An edit to a file not
// on the map yet waits for the file to join (with the next live batch, whatever the cap).

/** What presence needs from the mapper. */
export interface PresenceHost {
  /** The built map of a root, if any. */
  cached(root: string): Cached | undefined;
  /** The open project's root (the map the pages show). */
  activeRoot(): string | undefined;
  /** The root being watched live, if any. */
  liveRoot(): string | undefined;
  /** Put a path in the next live batch. */
  addToBatch(path: string): void;
}

/** How long a file stays marked after an agent's edit. */
const ACTIVE_MS = 60_000;

export class Presence {
  /** Files shown as being worked on, by path: the timer that clears it after 60 s, and the node it was set on. */
  private activeClearTimers = new Map<string, { timer: NodeJS.Timeout; node: FileNode }>();
  /** An agent's edit to a file not on the map yet: the activity to show once the file joins. */
  private pendingTouches = new Map<string, { sessionId: string; ts: string }>();

  constructor(private gateway: EventsGateway, private host: PresenceHost) {}

  /** Stop showing agents on files: every file, or the given ones (deleted). */
  clear(paths?: Iterable<string>) {
    for (const key of paths ?? [...this.activeClearTimers.keys()]) {
      const p = this.activeClearTimers.get(key);
      if (!p) continue;
      clearTimeout(p.timer);
      p.node.activeSessionId = undefined;
      this.activeClearTimers.delete(key);
    }
  }

  /** Files that just joined `root`'s map (or changed on it): an agent's edit that arrived before them shows now. */
  joined(root: string, paths: Iterable<string>) {
    for (const abs of paths) {
      const touch = this.pendingTouches.get(abs);
      if (touch) { this.pendingTouches.delete(abs); this.touched(root, abs, touch.sessionId, touch.ts); }
    }
  }

  /** An agent edited `path`: mark it on the map for a minute. */
  touched(root: string, path: string, sessionId: string, ts: string) {
    const abs = resolve(root);
    const cached = this.host.cached(abs);
    if (!cached) return;
    const node = cached.byPath.get(path);
    if (!node) {
      // Not on the map (the cap left it out, or it's being created): it joins with the next batch, whatever the cap.
      if (this.host.liveRoot() !== abs || !mappable(relative(abs, path), cached.ignoredDirs)) return;
      cached.agentTouched.add(path);
      if (this.pendingTouches.size > 1000) this.pendingTouches.clear();
      this.pendingTouches.set(path, { sessionId, ts });
      this.host.addToBatch(path);
      return;
    }
    node.activeSessionId = sessionId;
    node.lastChangedAt = ts;
    this.gateway.broadcast({ type: "file", file: node });

    const key = path;
    const existing = this.activeClearTimers.get(key);
    if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(() => {
      node.activeSessionId = undefined;
      this.activeClearTimers.delete(key);
      // Only if the file is still on the active map: a deleted file or another project's file must not come back.
      if (abs === this.host.activeRoot() && this.host.cached(abs)?.byPath.get(path) === node) this.gateway.broadcast({ type: "file", file: node });
    }, ACTIVE_MS);
    this.activeClearTimers.set(key, { timer, node });
  }
}
