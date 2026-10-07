import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { AgentMove, AgentPresence, Step } from "../types";
import { BusService } from "../core/bus.service";
import { ConfigService } from "../core/config.service";
import { EventsGateway } from "../core/events.gateway";
import { ListenerService } from "../listener/listener.service";

// Owner: D. Live presence of agents (main session threads and subagents): which file each one is on, and its recent route.
const INACTIVE_MS = 2 * 60_000;
const DROP_MS = 30 * 60_000;
const TRAIL_MAX = 12;
/** An agent whose only news is "still going" (a newer ts, for the map's pulse) is re-sent at most this often. */
const PULSE_MS = 1_000;
/** First-prompt labels kept for subagents that haven't touched the workspace yet. */
const PROMPTS_MAX = 500;

const FAILED = /^\s*(<tool_use_error>|error\b|exit code [1-9])|file has not been read yet|string to replace not found|permission (denied|to use)|was blocked|denied by|not allowed/i;
/** Same rule as Follow and the Failures view: a result flagged as an error, or one that reads like one. */
function isFailed(step: Step): boolean {
  return !!(step.input as { isError?: boolean } | undefined)?.isError || FAILED.test((step.text ?? "").slice(0, 300));
}

function actionOf(step: Step): string | undefined {
  const t = step.tool ?? "";
  if (step.kind === "edit") return t === "Write" ? "write" : "edit";
  if (step.kind !== "tool_call") return undefined;
  if (t === "Read" || t === "NotebookRead") return "read";
  if (t === "Grep" || t === "Glob" || t === "LS" || t === "WebSearch") return "search";
  if (t === "Bash" || t === "BashOutput") return "run";
  if (t === "Write") return "write";
  if (t === "Edit" || t === "MultiEdit" || t === "NotebookEdit") return "edit";
  if (t === "Task" || t === "Agent") return "delegate";
  return t ? t.toLowerCase() : undefined;
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
function shortLabel(text: string | undefined, max = 32): string | undefined {
  if (!text) return undefined;
  const t = clean(text.replace(/<[^>]+>/g, " ")).replace(/^(you are|your task is|please)\s+/i, "");
  if (!t) return undefined;
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}

@Injectable()
export class AgentsService implements OnModuleInit, OnModuleDestroy {
  private agents = new Map<string, AgentPresence>();
  private subLabels = new Map<string, string>(); // agentId -> short label (meta file or first prompt), once the agent shows
  private firstPrompts = new Map<string, string>(); // agentId -> short label of its first prompt, until the agent shows
  private sessionNames = new Map<string, string>(); // sessionId -> main-thread name (dropped when the session changes)
  private sentAt = new Map<string, number>(); // agent id -> when it was last broadcast
  private timer?: NodeJS.Timeout;

  constructor(private bus: BusService, private cfg: ConfigService, private gateway: EventsGateway, private listener: ListenerService) {}

  onModuleInit() {
    this.bus.on("step", (s) => { try { this.onStep(s); } catch { /* never break the listener */ } });
    this.bus.on("session", (s) => { this.sessionNames.delete(s.id); });
    this.bus.on("workspace", () => { this.agents.clear(); this.sentAt.clear(); this.sessionNames.clear(); });
    this.timer = setInterval(() => this.sweep(), 15_000);
    this.timer.unref?.();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  list(): AgentPresence[] {
    return [...this.agents.values()].sort((a, b) => b.ts.localeCompare(a.ts));
  }

  private inWorkspace(p: string | undefined): p is string {
    if (!p || !isAbsolute(p)) return false;
    const root = this.cfg.defaultRoot.replace(/\/+$/, "");
    return p === root || p.startsWith(root + "/");
  }

  /** A file the map can put an agent on: the open project's, or one outside it that the map shows as an island (in
   *  someone's own folders, not a hidden one like ~/.claude where plans live, nor ~/Library). Same rule as lib/islands.ts. */
  private onMap(p: string | undefined): p is string {
    if (this.inWorkspace(p)) return true;
    const home = p ? /^\/(?:Users|home)\/[^/]+\/(.+)$/.exec(p)?.[1] : undefined;
    return !!home && !home.startsWith(".") && !home.startsWith("Library/");
  }

  /** Subagent description from Claude Code's agent-<id>.meta.json (cached; cheap: one readdir per new agent). */
  private metaLabel(sessionId: string, agentId: string): string | undefined {
    try {
      for (const proj of readdirSync(this.cfg.claudeProjectsDir)) {
        const f = join(this.cfg.claudeProjectsDir, proj, sessionId, "subagents", `agent-${agentId}.meta.json`);
        if (!existsSync(f)) continue;
        const d = JSON.parse(readFileSync(f, "utf8")) as { description?: string; agentType?: string };
        return shortLabel(d.description) ?? d.agentType;
      }
    } catch { /* ignore */ }
    return undefined;
  }

  private nameFor(step: Step, id: string): string {
    if (!step.agentId) {
      let name = this.sessionNames.get(step.sessionId);
      if (name === undefined) {
        const title = this.listener.getSession(step.sessionId)?.title;
        name = shortLabel(title, 48) ?? `Session ${step.sessionId.slice(0, 6)}`;
        this.sessionNames.set(step.sessionId, name);
      }
      return name;
    }
    return `Subagent · ${this.subLabels.get(id) || id.slice(0, 7)}`;
  }

  private onStep(step: Step) {
    const id = step.agentId ?? step.sessionId;
    if (!id) return;
    let a = this.agents.get(id);
    // A subagent's first prompt names it if its meta file doesn't; remember it (cheaply) until the agent shows.
    if (step.agentId && !a && step.kind === "prompt" && !this.firstPrompts.has(id)) {
      const l = shortLabel(step.text);
      if (l) {
        this.firstPrompts.set(id, l);
        if (this.firstPrompts.size > PROMPTS_MAX) this.firstPrompts.delete(this.firstPrompts.keys().next().value!);
      }
    }

    const now = step.ts || new Date().toISOString();
    const action = actionOf(step);
    // Inside the project or out on an island: an orchestrator (or its subagents) working elsewhere shows there too.
    const file = this.onMap(step.filePath) ? step.filePath : undefined;
    // Do not create an agent until it touches something the map shows.
    if (!a && !file) return;
    if (!a) {
      if (step.agentId && !this.subLabels.has(id)) {
        this.subLabels.set(id, this.metaLabel(step.sessionId, step.agentId) ?? this.firstPrompts.get(id) ?? ""); // "" = looked up, nothing found
        this.firstPrompts.delete(id);
      }
      a = { id, sessionId: step.sessionId, name: this.nameFor(step, id), isSubagent: !!step.agentId, ts: now, active: true, trail: [] };
    }
    const prev = this.agents.get(id);
    const next: AgentPresence = { ...a, name: this.nameFor(step, id), ts: now, active: true };
    if (step.kind === "tool_result" && isFailed(step)) {
      next.errorAt = now;
      next.error = (step.text ?? "").replace(/<\/?tool_use_error>/g, "").trim().split("\n")[0].slice(0, 160);
    }
    if (file && action) {
      const last = next.trail[next.trail.length - 1];
      const move: AgentMove = { file, action, ts: now };
      next.trail = last && last.file === file && last.action === action ? [...next.trail.slice(0, -1), move] : [...next.trail, move].slice(-TRAIL_MAX);
      next.file = file;
      next.action = action;
    } // steps without a file (Bash, text, thinking) only refresh ts/active
    this.agents.set(id, next);
    // Something the map shows changed: send now. Only the time moved (the pulse): at most once a second.
    const changed = !prev || prev.file !== next.file || prev.action !== next.action || prev.error !== next.error || prev.errorAt !== next.errorAt
      || prev.active !== next.active || prev.name !== next.name;
    const t = Date.now();
    if (!changed && t - (this.sentAt.get(id) ?? 0) < PULSE_MS) return;
    this.sentAt.set(id, t);
    this.gateway.broadcast({ type: "agent", agent: next });
  }

  private sweep() {
    const now = Date.now();
    for (const [id, a] of this.agents) {
      const age = now - Date.parse(a.ts);
      if (age > DROP_MS) {
        this.agents.delete(id);
        this.subLabels.delete(id);
        this.sentAt.delete(id);
        if (!a.isSubagent) this.sessionNames.delete(a.sessionId);
        continue;
      }
      if (a.active && age > INACTIVE_MS) {
        const next = { ...a, active: false };
        this.agents.set(id, next);
        this.sentAt.set(id, now);
        this.gateway.broadcast({ type: "agent", agent: next });
      }
    }
  }
}
