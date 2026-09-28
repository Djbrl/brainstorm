import { Controller, Get, Query } from "@nestjs/common";
import { CoworkService } from "./cowork.service";

@Controller()
export class CoworkController {
  constructor(private cowork: CoworkService) {}
  @Get("cowork") summary(@Query("sessionId") sessionId?: string) { return this.cowork.summary(sessionId || undefined); }
}
