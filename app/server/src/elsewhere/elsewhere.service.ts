import { Injectable } from "@nestjs/common";
import { closeSync, openSync, readdirSync, readSync, realpathSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { ElsewhereThread } from "../types";
import { ConfigService } from "../core/config.service";
import { ListenerService } from "../listener/listener.service";
import { AttentionService } from "../attention/attention.service";
import { promptTitle } from "../listener/text";
import { isIdleTranscript } from "../workspace/threads";
import { decodeProjectDir } from "../workspace/workspace.service";

// Owner: switcher. Agents at work in the person's other projects, so the app can say so and take you there. Cheap on
// purpose: the logs of other projects aren't read, only their files' last change (a thread is working while its log
// grows), a few KB of a live one (where it runs, its title), and what the plugin's hooks said (they post every
// session's events, whatever the project).

/** A log that changed this recently is a thread at work (the listener's "running"). */
const LIVE_MS = 2 * 60_000;
/** A thread waiting on you stays listed this long without a word from it. */
const WAIT_MS = 2 * 60 * 60_000;
const HEAD_BYTES = 64 * 1024;

const real = (p: string) => { try { return realpathSync(p); } catch { return p; } };
const repoOf = (p: string) => real(real(p).replace(/\/\.claude\/worktrees\/[^/]+(?:\/.*)?$/, ""));
const inside = (p: string, root: string) => p === root || p.startsWith(root + "/");

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

  constructor(private cfg: ConfigService, private listener: ListenerService, private attention: AttentionService) {}

  list(): ElsewhereThread[] {
    const now = Date.now();
    const here = this.listener.scopeRoots().map(real);
    const isHere = (p: string) => here.some((r) => inside(real(p), r) || inside(repoOf(p), r));
    const out: ElsewhereThread[] = [];

    // Claude Code: one folder per project, one log per thread (its subagents' logs in <thread>/subagents/).
    let dirs: string[] = [];
    try { dirs = readdirSync(this.cfg.claudeProjectsDir); } catch { /* no Claude Code here */ }
    for (const d of dirs) {
      const dir = join(this.cfg.claudeProjectsDir, d);
      let names: string[];
      try { names = readdirSync(dir); } catch { continue; }
      for (const name of names) {
        if (!name.endsWith(".jsonl")) continue;
        const file = join(dir, name);
        const sid = basename(name, ".jsonl");
        let st;
        try { st = statSync(file); } catch { continue; }
        const last = Math.max(st.mtimeMs, this.subagentsChanged(join(dir, sid)));
        const state = this.stateOf(sid, last, now);
        if (!state) continue;
        const cwd = this.cwdOf(file);
        const root = cwd ? repoOf(cwd) : this.rootOf(d);
        if (!root || isHere(cwd ?? root) || /\/Library\/Application Support\//.test(root)) continue;
        if (isIdleTranscript(file, st.size)) continue; // only slash commands so far: not a thread yet
        out.push({ sessionId: sid, harness: "claude", title: this.claudeTitle(file, sid), root, project: basename(root), lastEventAt: new Date(last).toISOString(), state });
      }
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
      out.push({ sessionId: t.id, harness: "codex", title: t.title ?? this.listener.getSession(t.id)?.title, root, project: basename(root), lastEventAt: new Date(t.mtimeMs).toISOString(), state });
    }

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
  private subagentsChanged(threadDir: string): number {
    const sub = join(threadDir, "subagents");
    let names: string[];
    try { names = readdirSync(sub); } catch { return 0; }
    let max = 0;
    for (const n of names) if (n.endsWith(".jsonl")) { try { max = Math.max(max, statSync(join(sub, n)).mtimeMs); } catch { /* gone */ } }
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
    return custom ?? this.listener.getSession(sid)?.title ?? (prompt ? promptTitle(prompt) : undefined);
  }
}
