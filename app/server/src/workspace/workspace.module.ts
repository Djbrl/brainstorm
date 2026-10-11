import { Module } from "@nestjs/common";
import { WorkspaceService } from "./workspace.service";
import { WorkspaceController } from "./workspace.controller";
import { ListenerModule } from "../listener/listener.module";
import { MapperModule } from "../mapper/mapper.module";

// Owner: S.
@Module({ imports: [ListenerModule, MapperModule], providers: [WorkspaceService], controllers: [WorkspaceController], exports: [WorkspaceService] })
export class WorkspaceModule {}
