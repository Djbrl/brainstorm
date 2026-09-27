import { Module } from "@nestjs/common";
import { WorkspaceService } from "./workspace.service";
import { WorkspaceController } from "./workspace.controller";
import { ListenerModule } from "../listener/listener.module";
import { MapperModule } from "../mapper/mapper.module";
import { ReaderModule } from "../reader/reader.module";

// Owner: S.
@Module({ imports: [ListenerModule, MapperModule, ReaderModule], providers: [WorkspaceService], controllers: [WorkspaceController], exports: [WorkspaceService] })
export class WorkspaceModule {}
