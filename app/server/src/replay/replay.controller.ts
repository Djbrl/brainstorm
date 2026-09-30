import { Controller, Get, Query } from "@nestjs/common";
import type { Replay } from "../types";
import { redactReplayJson } from "./redact";
import { ReplayService } from "./replay.service";

// Owned by the lead. Static export for the hosted demo: GET /api/replay?sessionId=a,b&root=
@Controller()
export class ReplayController {
  constructor(private replays: ReplayService) {}

  /** Every export goes through the private redaction list before it can be published. */
  @Get("replay") replay(@Query("sessionId") sessionId?: string, @Query("root") root?: string,
    @Query("movesFrom") movesFrom?: string, @Query("movesTo") movesTo?: string, @Query("preview") preview?: string,
    @Query("until") until?: string): Replay {
    const raw = this.replays.build(sessionId, root, movesFrom, movesTo, preview, until);
    return JSON.parse(redactReplayJson(JSON.stringify(raw)).json) as Replay;
  }
}
