import { Module } from "@nestjs/common";
import { ReplayController } from "./replay.controller";
import { ReplayService } from "./replay.service";
import { ShareController } from "./share.controller";
import { ListenerModule } from "../listener/listener.module";
import { MapperModule } from "../mapper/mapper.module";
import { AskModule } from "../ask/ask.module";
import { FailuresModule } from "../failures/failures.module";
import { WorkspaceModule } from "../workspace/workspace.module";

@Module({ imports: [ListenerModule, MapperModule, AskModule, FailuresModule, WorkspaceModule], controllers: [ReplayController, ShareController], providers: [ReplayService] })
export class ReplayModule {}
