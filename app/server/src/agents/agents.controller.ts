import { Controller, Get } from "@nestjs/common";
import { AgentsService } from "./agents.service";

// GET /api/agents: where each agent is.
@Controller()
export class AgentsController {
  constructor(private agents: AgentsService) {}
  @Get("agents") list() { return this.agents.list(); }
}
