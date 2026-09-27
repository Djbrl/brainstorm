import { Controller, Get, Query } from "@nestjs/common";
import { ListenerService } from "../listener/listener.service";
import { MapperService } from "../mapper/mapper.service";
import { AskService } from "../ask/ask.service";
import { ConfigService } from "../core/config.service";
import { FailuresService } from "../failures/failures.service";
import { WorkspaceService } from "../workspace/workspace.service";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Replay, Step } from "../types";
import { redactReplayJson } from "./redact";

type Move = NonNullable<Replay["agentMoves"]>[number];

function actionOf(step: Step): string | undefined {
  const t = step.tool ?? "";
  if (step.kind === "edit") return t === "Write" ? "write" : "edit";
  if (step.kind !== "tool_call") return undefined;
  if (t === "Read") return "read";
  if (t === "Grep" || t === "Glob" || t === "LS") return "search";
  return undefined; // runs, delegations etc. have no file to stand on
}

// Owned by the lead. Static export for the hosted demo: GET /api/replay?sessionId=a,b&root=
@Controller()
export class ReplayController {
  constructor(private listener: ListenerService, private mapper: MapperService, private askService: AskService, private cfg: ConfigService, private failures: FailuresService, private workspace: WorkspaceService) {}

  /** Which subagent wrote each log line: uuid → {agentId, name}, from Claude Code's subagents/agent-<id>.jsonl (+ .meta.json). */
  private subagentIndex(sessionId: string): Map<string, { id: string; name: string }> {
    const index = new Map<string, { id: string; name: string }>();
    let projects: string[] = [];
    try { projects = readdirSync(this.cfg.claudeProjectsDir); } catch { return index; }
    for (const proj of projects) {
      const dir = join(this.cfg.claudeProjectsDir, proj, sessionId, "subagents");
      if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir).filter((x) => x.endsWith(".jsonl"))) {
        const id = f.replace(/^agent-/, "").replace(/\.jsonl$/, "");
        let name = `Subagent ${id.slice(0, 6)}`;
        try { name = (JSON.parse(readFileSync(join(dir, `agent-${id}.meta.json`), "utf8")) as { description?: string }).description || name; } catch { /* no meta */ }
        for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
          const m = /"uuid":"([^"]+)"/.exec(line);
          if (m) index.set(m[1], { id, name });
        }
      }
    }
    return index;
  }

  private agentMoves(sessions: { id: string; title: string }[], steps: Step[], files: Set<string>, from?: string, to?: string): Move[] {
    const moves: Move[] = [];
    for (const s of sessions) {
      const subs = this.subagentIndex(s.id);
      for (const st of steps) {
        if (st.sessionId !== s.id || !st.filePath || !files.has(st.filePath)) continue;
        if ((from && st.ts < from) || (to && st.ts > to)) continue;
        const action = actionOf(st);
        if (!action) continue;
        const sub = st.isSubagent ? subs.get(st.id.split(":")[0]) : undefined;
        moves.push({
          id: sub?.id ?? s.id, name: sub ? `Subagent · ${sub.name}` : s.title, isSubagent: !!sub,
          sessionId: s.id, file: st.filePath, action, ts: st.ts,
        });
      }
    }
    return moves.sort((a, b) => a.ts.localeCompare(b.ts));
  }

  /** Every export goes through the private redaction list before it can be published. */
  @Get("replay") replay(@Query("sessionId") sessionId?: string, @Query("root") root?: string,
    @Query("movesFrom") movesFrom?: string, @Query("movesTo") movesTo?: string, @Query("preview") preview?: string): Replay {
    const raw = this.build(sessionId, root, movesFrom, movesTo, preview);
    return JSON.parse(redactReplayJson(JSON.stringify(raw)).json) as Replay;
  }

  private build(sessionId?: string, root?: string, movesFrom?: string, movesTo?: string, preview?: string): Replay {
    const all = this.listener.listSessions();
    const wanted = sessionId ? sessionId.split(",") : [];
    const sessions = wanted.length ? all.filter((s) => wanted.includes(s.id)) : all.slice(0, 1);
    const steps = sessions.flatMap((s) => this.listener.listSteps(s.id));
    const map = this.mapper.getMap(root || this.cfg.defaultRoot);
    const answers = this.askService.listAnswers();
    const failures = this.failures.list(sessions.map((s) => s.id).join(","));
    const base: Replay = { exportedAt: new Date().toISOString(), sessions: sessions.map((s) => ({ ...s, status: "idle" })), steps, map: { ...map, files: map.files.map(({ activeSessionId: _a, ...f }) => f) }, answers, failures };
    if (!preview) return base;
    // Post-deadline preview extras: recorded agent moves and a recorded setup run (only this workspace, no other projects).
    const status = this.workspace.status();
    const suggestions = this.workspace.suggestions().filter((w) => w.root === status.root || (status.root ?? "").startsWith(w.root + "/"));
    return { ...base, agentMoves: this.agentMoves(sessions, steps, new Set(map.files.map((f) => f.path)), movesFrom, movesTo), setupPreview: { status, suggestions } };
  }
}
