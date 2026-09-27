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
  private subLabels = new Map<string, string>(); // agentId -> short label from its first prompt
  private timer?: NodeJS.Timeout;

  constructor(private bus: BusService, private cfg: ConfigService, private gateway: EventsGateway, private listener: ListenerService) {}

  onModuleInit() {
    this.bus.on("step", (s) => { try { this.onStep(s); } catch { /* never break the listener */ } });
    this.bus.on("workspace", () => { this.agents.clear(); });
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
      const title = this.listener.getSession(step.sessionId)?.title;
      return shortLabel(title, 48) ?? `Session ${step.sessionId.slice(0, 6)}`;
    }
    return `Subagent · ${this.subLabels.get(id) || id.slice(0, 7)}`;
  }

  private onStep(step: Step) {
    const id = step.agentId ?? step.sessionId;
    if (!id) return;
    if (step.agentId && !this.subLabels.has(id)) {
      const l = this.metaLabel(step.sessionId, step.agentId) ?? (step.kind === "prompt" ? shortLabel(step.text) : undefined);
      this.subLabels.set(id, l ?? ""); // "" = looked up, nothing found
    }

    const now = step.ts || new Date().toISOString();
    let a = this.agents.get(id);
    const action = actionOf(step);
    const file = this.inWorkspace(step.filePath) ? step.filePath : undefined;
    // Do not create an agent until it touches something in this workspace.
    if (!a && !file) return;
    if (!a) {
      a = { id, sessionId: step.sessionId, name: this.nameFor(step, id), isSubagent: !!step.agentId, ts: now, active: true, trail: [] };
      this.agents.set(id, a);
    }
    const next: AgentPresence = { ...a, name: this.nameFor(step, id), ts: now, active: true };
    if (file && action) {
      const last = next.trail[next.trail.length - 1];
      const move: AgentMove = { file, action, ts: now };
      next.trail = last && last.file === file && last.action === action ? [...next.trail.slice(0, -1), move] : [...next.trail, move].slice(-TRAIL_MAX);
      next.file = file;
      next.action = action;
    } // steps without a file (Bash, text, thinking) only refresh ts/active
    this.agents.set(id, next);
    this.gateway.broadcast({ type: "agent", agent: next });
  }

  private sweep() {
    const now = Date.now();
    for (const [id, a] of this.agents) {
      const age = now - Date.parse(a.ts);
      if (age > DROP_MS) {
        this.agents.delete(id);
        this.subLabels.delete(id);
        continue;
      }
      if (a.active && age > INACTIVE_MS) {
        const next = { ...a, active: false };
        this.agents.set(id, next);
        this.gateway.broadcast({ type: "agent", agent: next });
      }
    }
  }
}
