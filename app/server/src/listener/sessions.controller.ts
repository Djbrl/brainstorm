import { Controller, Get, Param, Query } from "@nestjs/common";
import { ListenerService } from "./listener.service";
import type { Replay } from "../types";

// Owner: A.
@Controller()
export class SessionsController {
  constructor(private listener: ListenerService) {}
  @Get("sessions") sessions() { return this.listener.listSessions(); }
  @Get("sessions/:id/steps") steps(@Param("id") id: string) { return this.listener.listSteps(id); }
  @Get("replay") replay(@Query("sessionId") sessionId?: string): Replay {
    const sessions = this.listener.listSessions(); // sorted by lastEventAt desc
    const session = (sessionId ? sessions.find((s) => s.id === sessionId) : undefined) ?? sessions[0];
    const steps = session ? this.listener.listSteps(session.id) : [];
    return { exportedAt: new Date().toISOString(), sessions: session ? [session] : [], steps, map: null, answers: [] };
  }
}
