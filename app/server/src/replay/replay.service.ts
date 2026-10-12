import { Injectable } from "@nestjs/common";
import { StepsStore } from "../listener/step-store";
import { MapperService } from "../mapper/mapper.service";
import { AskService } from "../ask/ask.service";
import { WorkspaceState } from "../core/workspace-state";
import { resolve } from "node:path";
import type { Replay, Session } from "../shared/contract";
import { summarizePlaces } from "../cowork/cowork.service";

// Builds replays: the hosted demo's export (GET /api/replay) and shared replays (GET /api/share).
@Injectable()
export class ReplayService {
  constructor(private store: StepsStore, private mapper: MapperService, private askService: AskService, private state: WorkspaceState) {}

  /**
   * The hosted demo's extras (agent moves, the setup run, a cut-off time) are added by app/scripts/record-demo.mjs.
   * `share`: a thread being shared (share.controller.ts), found by id even from another project, with the map of the
   * project the server worked out for it (share-root.ts), never one a link names.
   */
  async build(sessionId?: string, root?: string, share?: { mapRoot: string }): Promise<Replay> {
    const all = this.store.listSessions();
    const wanted = sessionId ? sessionId.split(",") : [];
    const sessions = !wanted.length ? all.slice(0, 1)
      : share ? wanted.map((id) => all.find((s) => s.id === id) ?? this.store.getSession(id)).filter((s): s is Session => !!s)
      : all.filter((s) => wanted.includes(s.id));
    const steps = sessions.flatMap((s) => this.store.listSteps(s.id));
    // The open project only (or the same folder written another way): never a walk of any folder a link names.
    const map = await this.mapper.getMapAsync(share ? share.mapRoot : root && resolve(root) === resolve(this.state.root) ? root : this.state.root);
    const answers = this.askService.listAnswers();
    const cowork = Object.fromEntries(sessions.map((s) => [s.id, summarizePlaces([s.id], (id) => steps.filter((st) => st.sessionId === id))])); // Places, for the hosted demo
    return { exportedAt: new Date().toISOString(), sessions: sessions.map((s) => ({ ...s, status: "idle" })), steps, map: { ...map, files: map.files.map(({ activeSessionId: _a, ...f }) => f) }, answers, cowork };
  }
}
