import { Injectable, OnModuleInit } from "@nestjs/common";
import type { Session, Step } from "../types";

// Owner: A. Tail ~/.claude/projects/**/*.jsonl, parse into Steps, store, emit on bus, broadcast over ws.
@Injectable()
export class ListenerService implements OnModuleInit {
  onModuleInit() {}
  listSessions(): Session[] { return []; }
  listSteps(_sessionId: string): Step[] { return []; }
  getStep(_id: string): Step | undefined { return undefined; }
}
