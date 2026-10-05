import { Controller, Get, Param, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { ListenerService } from "./listener.service";

// Owner: A.
@Controller()
export class SessionsController {
  constructor(private listener: ListenerService) {}
  @Get("sessions") sessions() { return this.listener.listSessions(); }
  /** A session's steps in order. `?afterSeq=N`: only the steps after seq N (what a page that has them up to N needs). */
  @Get("sessions/:id/steps") steps(@Param("id") id: string, @Query("afterSeq") afterSeq: string | undefined, @Res() res: Response) {
    const after = typeof afterSeq === "string" && /^-?\d+$/.test(afterSeq) ? Number(afterSeq) : undefined;
    res.type("application/json").send(this.listener.listStepsJson(id, after)); // the JSON text as built, not re-serialized
  }
}
