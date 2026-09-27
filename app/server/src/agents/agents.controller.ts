import { Controller, Get } from "@nestjs/common";
import { AgentsService } from "./agents.service";

// Owner: D.
@Controller()
export class AgentsController {
  constructor(private agents: AgentsService) {}
  @Get("agents") list() { return this.agents.list(); }
}
