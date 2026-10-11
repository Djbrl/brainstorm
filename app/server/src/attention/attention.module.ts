import { Module } from "@nestjs/common";
import { AttentionService } from "./attention.service";
import { AttentionController } from "./attention.controller";
import { ListenerModule } from "../listener/listener.module";

// Whether a thread needs you: the tracker, GET /api/attention and the plugin hooks' POST /api/hooks.
@Module({ imports: [ListenerModule], providers: [AttentionService], controllers: [AttentionController], exports: [AttentionService] })
export class AttentionModule {}
