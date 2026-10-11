import { Body, Controller, Post } from "@nestjs/common";
import { AskService } from "./ask.service";
import type { AskRequest } from "../shared/contract";

// POST /api/ask: a question about a step or a file.
@Controller()
export class AskController {
  constructor(private askService: AskService) {}
  @Post("ask") ask(@Body() body: AskRequest) { return this.askService.ask(body); }
}
