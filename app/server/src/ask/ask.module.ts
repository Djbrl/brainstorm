import { Module } from "@nestjs/common";
import { AskService } from "./ask.service";
import { AskController } from "./ask.controller";
import { ListenerModule } from "../listener/listener.module";

// Ask: questions about a step or a file, answered by Claude.
@Module({ imports: [ListenerModule], providers: [AskService], controllers: [AskController], exports: [AskService] })
export class AskModule {}
