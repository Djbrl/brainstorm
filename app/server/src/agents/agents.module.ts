import { Module } from "@nestjs/common";
import { AgentsService } from "./agents.service";
import { AgentsController } from "./agents.controller";
import { ListenerModule } from "../listener/listener.module";

// Owner: D.
@Module({ imports: [ListenerModule], providers: [AgentsService], controllers: [AgentsController], exports: [AgentsService] })
export class AgentsModule {}
