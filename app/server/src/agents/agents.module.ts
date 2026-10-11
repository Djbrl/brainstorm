import { Module } from "@nestjs/common";
import { AgentsService } from "./agents.service";
import { AgentsController } from "./agents.controller";
import { ListenerModule } from "../listener/listener.module";

// Where each agent is (agents.service.ts).
@Module({ imports: [ListenerModule], providers: [AgentsService], controllers: [AgentsController], exports: [AgentsService] })
export class AgentsModule {}
