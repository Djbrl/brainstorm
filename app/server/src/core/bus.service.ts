import { Injectable } from "@nestjs/common";
import { EventEmitter } from "node:events";
import type { Session, Step } from "../types";

/** In-process events between modules. Listener emits, reader/mapper react. */
export type BusEvents = {
  "session": [Session];
  "step": [Step];                               // new step stored (listener → reader, mapper)
  "file-touched": [{ path: string; sessionId: string; ts: string }]; // an agent edited a file (listener → mapper)
};

@Injectable()
export class BusService {
  private ee = new EventEmitter().setMaxListeners(50);
  emit<K extends keyof BusEvents>(event: K, ...args: BusEvents[K]) { this.ee.emit(event, ...args); }
  on<K extends keyof BusEvents>(event: K, fn: (...args: BusEvents[K]) => void) { this.ee.on(event, fn as (...a: unknown[]) => void); }
}
