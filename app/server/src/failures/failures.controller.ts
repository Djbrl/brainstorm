import { Controller, Get, Query } from "@nestjs/common";
import { FailuresService } from "./failures.service";

@Controller()
export class FailuresController {
  constructor(private failures: FailuresService) {}
  @Get("failures") list(@Query("sessionId") sessionId?: string) { return this.failures.list(sessionId || undefined); }
}
