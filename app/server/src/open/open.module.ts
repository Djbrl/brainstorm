import { Module } from "@nestjs/common";
import { OpenController } from "./open.controller";
import { ListenerModule } from "../listener/listener.module";
import { WorkspaceModule } from "../workspace/workspace.module";

// Owner: viewers. Opening a file in the person's own app (see open.controller.ts).
@Module({ imports: [ListenerModule, WorkspaceModule], controllers: [OpenController] })
export class OpenModule {}
