import { Module } from "@nestjs/common";
import { AskService } from "./ask.service";
import { AskController } from "./ask.controller";
import { ListenerModule } from "../listener/listener.module";
import { ReaderModule } from "../reader/reader.module";

// Owner: D.
@Module({ imports: [ListenerModule, ReaderModule], providers: [AskService], controllers: [AskController], exports: [AskService] })
export class AskModule {}
