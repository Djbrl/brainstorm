import { Controller, Get, Query } from "@nestjs/common";
import type { Replay } from "../shared/contract";
import { redactReplayJson } from "./redact";
import { ReplayService } from "./replay.service";

// Static export for the hosted demo: GET /api/replay?sessionId=a,b&root=. app/scripts/record-demo.mjs adds the demo's
// extras (agent moves, the setup run, a cut-off time) on top of it.
@Controller()
export class ReplayController {
  constructor(private replays: ReplayService) {}

  /** Every export goes through the private redaction list before it can be published. */
  @Get("replay") async replay(@Query("sessionId") sessionId?: string, @Query("root") root?: string): Promise<Replay> {
    const raw = await this.replays.build(sessionId, root);
    return JSON.parse(redactReplayJson(JSON.stringify(raw)).json) as Replay;
  }
}
