import { Module } from "@nestjs/common";
import { AttentionService } from "./attention.service";
import { AttentionController } from "./attention.controller";
import { ListenerModule } from "../listener/listener.module";

// Owner: attention.
@Module({ imports: [ListenerModule], providers: [AttentionService], controllers: [AttentionController], exports: [AttentionService] })
export class AttentionModule {}
