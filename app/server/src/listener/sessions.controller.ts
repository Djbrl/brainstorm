import { Controller, Get, Param, Query } from "@nestjs/common";
import { ListenerService } from "./listener.service";
import type { Replay } from "../types";

// Owner: A.
@Controller()
export class SessionsController {
  constructor(private listener: ListenerService) {}
  @Get("sessions") sessions() { return this.listener.listSessions(); }
  @Get("sessions/:id/steps") steps(@Param("id") id: string) { return this.listener.listSteps(id); }
  @Get("replay") replay(@Query("sessionId") _sessionId?: string): Replay {
    return { exportedAt: new Date().toISOString(), sessions: [], steps: [], map: null, answers: [] };
  }
}
