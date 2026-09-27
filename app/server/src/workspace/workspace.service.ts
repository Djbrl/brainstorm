import { Injectable } from "@nestjs/common";
import type { SetupStatus, WorkspaceSuggestion } from "../types";

// Owner: S (workspace setup). Stub from the lead.
@Injectable()
export class WorkspaceService {
  status(): SetupStatus { return { root: null, name: null, ready: false, steps: [] }; }
  suggestions(): WorkspaceSuggestion[] { return []; }
  async select(_root: string): Promise<SetupStatus> { return this.status(); }
}
