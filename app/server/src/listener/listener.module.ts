import { Module } from "@nestjs/common";
import { ListenerService } from "./listener.service";
import { SessionsController } from "./sessions.controller";

// Reading the agents' session logs (listener.service.ts) and serving threads.
@Module({ providers: [ListenerService], controllers: [SessionsController], exports: [ListenerService] })
export class ListenerModule {}
