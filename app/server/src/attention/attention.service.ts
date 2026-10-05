import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { StatementSync } from "node:sqlite";
import type { Attention, AttentionState, Step } from "../types";
import { BusService } from "../core/bus.service";
import { DbService } from "../core/db.service";
import { EventsGateway } from "../core/events.gateway";
import { ListenerService } from "../listener/listener.service";
import { isErrorResult } from "../failures/failures.service";

// Owner: attention. Does a thread need you? Worked out from the log (calls with no result, failures in a row, a finished
// turn) and made certain by the plugin's hooks (PermissionRequest, Notification, Stop) when they're installed.

/** A call with no result and no activity this long, for a tool that's normally instant, is probably a permission prompt. */
const QUIET_MS = 8_000;
/** Tools that return at once unless something (you) holds them up. Bash, subagents and browsers can legitimately take long. */
const INSTANT = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit", "Read", "Glob", "Grep", "LS", "WebSearch", "WebFetch", "TodoWrite"]);
const ASKS = new Set(["AskUserQuestion"]);
const PLANS = new Set(["ExitPlanMode"]);
const STUCK_AFTER = 3;
/** After this long without activity, a finished or stuck thread stops asking for you. */
const FORGET_MS = 2 * 60 * 60_000;
const WORKING_MS = 2 * 60_000;
/** How much of a thread's stored log a new tracker reads to catch up. */
const CATCH_UP = 600;
/** Which threads belong to the open workspace is re-checked this often (the listener's list is costly to build). */
const SCOPE_MS = 60_000;

/** What the plugin's hooks send (see plugin/scripts/signal.mjs). */
export type HookSignal = {
  event: "PermissionRequest" | "Notification" | "Stop" | "UserPromptSubmit";
  session_id: string;
  notification_type?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_use_id?: string;
  message?: string;
};

type Tracker = {
  lastTs: number;
  lastMain?: Step;                 // last main-thread step that isn't a tool result
  pending: Map<string, Step>;      // calls waiting for a result, by tool_use id (or step id for old steps)
  streak: { tool: string; n: number; error: string; stepId: string } | null;
  hook?: HookSignal & { at: number };
};

type TailRow = { id: string; session_id: string; seq: number; ts: string; kind: Step["kind"]; text: string | null; tool: string | null; input: string | null; is_subagent: number; agent_id: string | null; tool_use_id: string | null };
/** Only what tracking reads (no diffs, labels or file paths). */
const tailStep = (r: TailRow): Step => ({
  id: r.id, sessionId: r.session_id, seq: r.seq, ts: r.ts, kind: r.kind,
  text: r.text ?? undefined, tool: r.tool ?? undefined, input: r.input ? JSON.parse(r.input) : undefined,
  isSubagent: !!r.is_subagent, ...(r.agent_id ? { agentId: r.agent_id } : {}), ...(r.tool_use_id ? { toolUseId: r.tool_use_id } : {}),
});

const one = (s: string | undefined, max = 140) => {
  const t = (s ?? "").replace(/<\/?tool_use_error>/g, "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t || undefined;
};

/** One line about a call: the command, the file, the URL, the question. */
function describe(tool: string | undefined, input: unknown): string | undefined {
  const i = (input && typeof input === "object" ? input : {}) as Record<string, any>;
  if (tool === "AskUserQuestion") return one(i.questions?.[0]?.question);
  if (tool === "ExitPlanMode") return one(i.plan, 200);
  return one(i.command ?? i.file_path ?? i.notebook_path ?? i.url ?? i.pattern ?? i.query ?? i.description ?? (tool?.startsWith("mcp__") ? tool.replace(/^mcp__.+?__/, "").replace(/_/g, " ") : undefined));
}

@Injectable()
export class AttentionService implements OnModuleInit, OnModuleDestroy {
  private trackers = new Map<string, Tracker>();
  private last = new Map<string, Attention>();
  private timer?: NodeJS.Timeout;
  /** Threads of the open workspace (from the listener), and every id already looked up, so a new one triggers a re-check. */
  private scope?: { at: number; visible: Set<string>; checked: Set<string> };
  private rechecked = new Set<string>(); // hidden threads that already forced a re-check by starting to work
  private stmts?: { recent: StatementSync; tail: StatementSync };

  constructor(private bus: BusService, private gateway: EventsGateway, private listener: ListenerService, private dbs: DbService) {}

  /** Prepared on first use: the listener creates the tables in its own init. */
  private get q() {
    return this.stmts ??= {
      recent: this.dbs.db.prepare(`SELECT id FROM sessions WHERE last_event_at > ?`),
      tail: this.dbs.db.prepare(`SELECT id, session_id, seq, ts, kind, text, tool, input, is_subagent, agent_id, tool_use_id FROM steps WHERE session_id = ? ORDER BY seq DESC LIMIT ?`),
    };
  }

  onModuleInit() {
    this.bus.on("step", (s) => { try { this.onStep(s); } catch { /* never break the listener */ } });
    this.bus.on("workspace", () => { this.trackers.clear(); this.last.clear(); this.scope = undefined; this.rechecked.clear(); });
    this.timer = setInterval(() => this.sweep(), 2_000);
    this.timer.unref?.();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  /** Threads that need you or just finished, newest first. */
  list(): Attention[] {
    this.sweep(false);
    return [...this.last.values()].filter((a) => a.state !== "working" && a.state !== "idle").sort((a, b) => b.since.localeCompare(a.since));
  }

  /** From the plugin's hooks. */
  signal(sig: HookSignal) {
    if (!sig?.session_id || !sig.event) return;
    const t = this.tracker(sig.session_id);
    if (sig.event === "UserPromptSubmit") { t.hook = undefined; t.streak = null; }
    else t.hook = { ...sig, at: Date.now() };
    this.publish(sig.session_id);
  }

  // ---- tracking ----

  private tracker(sid: string): Tracker {
    let t = this.trackers.get(sid);
    if (t) return t;
    t = { lastTs: 0, pending: new Map(), streak: null };
    this.trackers.set(sid, t);
    // Catch up from the stored log (the bus only carries live steps): the recent tail is enough, oldest first.
    const rows = this.q.tail.all(sid, CATCH_UP) as TailRow[];
    for (let i = rows.length - 1; i >= 0; i--) this.apply(t, tailStep(rows[i]));
    return t;
  }

  private onStep(s: Step) {
    const fresh = !this.trackers.has(s.sessionId);
    const t = this.tracker(s.sessionId); // a new tracker already read this step from the store
    if (!fresh) this.apply(t, s);
    // A thread hidden as "nothing done yet" (a slash command) shows once it works: re-check the workspace's threads.
    if ((s.kind === "tool_call" || s.kind === "edit") && this.scope && !this.scope.visible.has(s.sessionId) && !this.rechecked.has(s.sessionId)) {
      this.rechecked.add(s.sessionId);
      this.scope.at = 0;
    }
    this.publish(s.sessionId);
  }

  private apply(t: Tracker, s: Step) {
    t.lastTs = Math.max(t.lastTs, Date.parse(s.ts) || 0);
    const key = s.toolUseId ?? s.id;
    if (s.kind === "tool_call" || s.kind === "edit") t.pending.set(key, s);
    if (s.kind === "tool_result") {
      const call = s.toolUseId ? t.pending.get(s.toolUseId) : undefined;
      if (s.toolUseId) t.pending.delete(s.toolUseId);
      else { const first = [...t.pending.entries()].find(([, c]) => !!c.isSubagent === !!s.isSubagent); if (first) t.pending.delete(first[0]); }
      if (t.hook?.event === "PermissionRequest" && t.hook.tool_use_id && t.hook.tool_use_id === s.toolUseId) t.hook = undefined;
      if (!s.isSubagent) {
        const tool = call?.tool ?? "a tool";
        if (isErrorResult(s)) {
          const error = one((s.text ?? "").replace(/^\s*Exit code \d+\s*/i, "")) ?? "error";
          t.streak = t.streak && t.streak.tool === tool ? { tool, n: t.streak.n + 1, error, stepId: call?.id ?? s.id } : { tool, n: 1, error, stepId: call?.id ?? s.id };
        } else t.streak = null;
      }
      return;
    }
    if (s.kind === "prompt" && !s.isSubagent) {
      t.pending.clear(); // a new request (or an interrupt) ends whatever was open
      t.streak = null;
      t.hook = undefined;
    }
    if (!s.isSubagent) t.lastMain = s;
    // Any new activity after a turn-end or idle notice means the agent is going again. For a permission prompt, only the
    // main thread moving on counts (a subagent can keep working while another call waits); 1 s of slack for clock skew.
    const after = (Date.parse(s.ts) || 0) > (t.hook?.at ?? Infinity) + (t.hook?.event === "PermissionRequest" ? 1000 : 0);
    if (t.hook && after && (t.hook.event !== "PermissionRequest" || !s.isSubagent)) t.hook = undefined;
  }

  // ---- deciding ----

  private compute(sid: string, now = Date.now()): Attention {
    const t = this.tracker(sid);
    const since = (ms: number) => new Date(ms || now).toISOString();
    const base = { sessionId: sid };
    const quiet = now - t.lastTs;
    const pending = [...t.pending.values()].sort((a, b) => a.ts.localeCompare(b.ts));
    const about = (c: Step | undefined): Partial<Attention> => c ? { tool: c.tool ?? (c.kind === "edit" ? "Edit" : undefined), detail: describe(c.tool, c.input), stepId: c.id, ...(c.agentId ? { agentId: c.agentId } : {}) } : {};
    const make = (state: AttentionState, sure: boolean, at: number, extra: Partial<Attention> = {}): Attention => ({ ...base, state, sure, since: since(at), ...extra });

    // 1. The hooks know for certain.
    const h = t.hook;
    if (h) {
      const call = h.tool_use_id ? t.pending.get(h.tool_use_id) : pending[0];
      if (h.event === "PermissionRequest") return make("permission", true, h.at, { ...about(call), tool: h.tool_name ?? call?.tool, detail: describe(h.tool_name, h.tool_input) ?? about(call).detail });
      if (h.event === "Notification") {
        if (h.notification_type === "permission_prompt") return make("permission", true, h.at, about(call));
        if (/^elicitation/.test(h.notification_type ?? "")) return make("question", true, h.at, { detail: one(h.message) });
        if (h.notification_type === "idle_prompt" && !pending.length) return make("done", true, h.at);
      }
      if (h.event === "Stop" && !pending.length) return make("done", true, h.at);
    }

    // 2. A question or a plan in the log is unambiguous.
    const ask = pending.find((c) => ASKS.has(c.tool ?? ""));
    if (ask) return make("question", true, Date.parse(ask.ts), about(ask));
    const plan = pending.find((c) => PLANS.has(c.tool ?? ""));
    if (plan) return make("plan", true, Date.parse(plan.ts), about(plan));

    if (quiet > FORGET_MS) return make("idle", true, t.lastTs);

    // 3. An instant tool that hasn't come back, with nothing else moving: most likely a permission prompt.
    const held = pending.find((c) => INSTANT.has(c.tool ?? (c.kind === "edit" ? "Edit" : "")));
    if (held && quiet > QUIET_MS) return make("permission", false, Date.parse(held.ts), about(held));

    // 4. The same tool failing over and over.
    if (t.streak && t.streak.n >= STUCK_AFTER && !pending.length) {
      return make("stuck", true, t.lastTs, { tool: t.streak.tool, detail: t.streak.error, stepId: t.streak.stepId });
    }

    // 5. Nothing open and the agent's last word was a message: its turn is over.
    const lm = t.lastMain;
    if (!pending.length && lm && (lm.kind === "text" || (lm.kind === "prompt" && /^\s*\[Request interrupted/.test(lm.text ?? ""))) && quiet > 4_000) {
      return make("done", false, t.lastTs);
    }
    return make(quiet < WORKING_MS || pending.length ? "working" : "idle", true, t.lastTs, pending.length ? about(pending[pending.length - 1]) : {});
  }

  private publish(sid: string) {
    const a = this.compute(sid);
    const prev = this.last.get(sid);
    if (prev && prev.state === a.state && prev.detail === a.detail && prev.sure === a.sure && prev.stepId === a.stepId) return;
    this.last.set(sid, a);
    // Pages show nothing for a thread that's simply going: which call it's on doesn't need a message per step.
    if (prev && prev.state === a.state && (a.state === "working" || a.state === "idle")) return;
    this.gateway.broadcast({ type: "attention", attention: a });
  }

  /** The open workspace's threads among `ids`. The listener's list is rebuilt once a minute, or when an id is new to us. */
  private inScope(ids: Set<string>, now: number): Set<string> {
    let sc = this.scope;
    if (!sc || now - sc.at > SCOPE_MS || [...ids].some((id) => !sc!.checked.has(id))) {
      const visible = new Set(this.listener.listSessions().map((s) => s.id));
      sc = this.scope = { at: now, visible, checked: new Set([...visible, ...ids]) };
    }
    return sc.visible;
  }

  /**
   * Time moves states on (quiet calls turn into permission prompts, turns end), so re-check the workspace's recent threads
   * and the ones already showing a state. Threads quiet for longer than FORGET_MS are dropped (a question or a plan still
   * waiting for an answer stays).
   */
  private sweep(broadcast = true) {
    const now = Date.now();
    const recent = new Set((this.q.recent.all(new Date(now - FORGET_MS).toISOString()) as { id: string }[]).map((r) => r.id));
    const candidates = new Set([...recent, ...this.last.keys()]);
    const visible = this.inScope(candidates, now);
    for (const id of candidates) {
      if (!visible.has(id)) continue;
      if (broadcast) this.publish(id);
      else if (!this.last.has(id)) this.last.set(id, this.compute(id, now));
    }
    if (broadcast) this.prune(now, recent);
  }

  private prune(now: number, recent: Set<string>) {
    for (const [sid, t] of this.trackers) {
      if (recent.has(sid) || now - Math.max(t.lastTs, t.hook?.at ?? 0) <= FORGET_MS) continue;
      if ([...t.pending.values()].some((c) => ASKS.has(c.tool ?? "") || PLANS.has(c.tool ?? ""))) continue;
      const a = this.last.get(sid);
      if (a && a.state !== "idle") this.gateway.broadcast({ type: "attention", attention: { sessionId: sid, state: "idle", sure: true, since: new Date(t.lastTs || now).toISOString() } });
      this.trackers.delete(sid);
      this.last.delete(sid);
    }
  }
}
