import { Module } from "@nestjs/common";
import { ListenerService } from "./listener.service";
import { SessionsController } from "./sessions.controller";

// Owner: A.
@Module({ providers: [ListenerService], controllers: [SessionsController], exports: [ListenerService] })
export class ListenerModule {}
