import { Module } from "@nestjs/common";
import { ListenerService } from "./listener.service";
import { SessionsController } from "./sessions.controller";
import { ProjectScope } from "./scope";
import { StepsStore } from "./step-store";

// Reading the agents' session logs (listener.service.ts) and serving threads. Other modules read threads and steps
// from StepsStore, and ask the listener only about its sources (Codex's projects, the open project's roots).
@Module({ providers: [ListenerService, ProjectScope, StepsStore], controllers: [SessionsController], exports: [ListenerService, StepsStore] })
export class ListenerModule {}
