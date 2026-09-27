import { Body, Controller, Post } from "@nestjs/common";
import { AskService } from "./ask.service";
import type { AskRequest } from "../types";

// Owner: D.
@Controller()
export class AskController {
  constructor(private askService: AskService) {}
  @Post("ask") ask(@Body() body: AskRequest) { return this.askService.ask(body); }
}
