import { Controller, Get, Query } from "@nestjs/common";
import { ListenerService } from "../listener/listener.service";
import { MapperService } from "../mapper/mapper.service";
import { AskService } from "../ask/ask.service";
import { ConfigService } from "../core/config.service";
import type { Replay } from "../types";

// Owned by the lead. Static export for the hosted demo: GET /api/replay?sessionId=a,b&root=
@Controller()
export class ReplayController {
  constructor(private listener: ListenerService, private mapper: MapperService, private askService: AskService, private cfg: ConfigService) {}

  @Get("replay") replay(@Query("sessionId") sessionId?: string, @Query("root") root?: string): Replay {
    const all = this.listener.listSessions();
    const wanted = sessionId ? sessionId.split(",") : [];
    const sessions = wanted.length ? all.filter((s) => wanted.includes(s.id)) : all.slice(0, 1);
    const steps = sessions.flatMap((s) => this.listener.listSteps(s.id));
    const map = this.mapper.getMap(root || this.cfg.defaultRoot);
    const answers = this.askService.listAnswers();
    return { exportedAt: new Date().toISOString(), sessions: sessions.map((s) => ({ ...s, status: "idle" })), steps, map: { ...map, files: map.files.map(({ activeSessionId: _a, ...f }) => f) }, answers };
  }
}
