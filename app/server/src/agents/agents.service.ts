import { Injectable } from "@nestjs/common";
import type { AgentPresence } from "../types";

// Owner: D (live agents). Stub from the lead.
@Injectable()
export class AgentsService {
  list(): AgentPresence[] { return []; }
}
