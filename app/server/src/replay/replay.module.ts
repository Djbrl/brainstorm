import { Module } from "@nestjs/common";
import { ReplayController } from "./replay.controller";
import { ListenerModule } from "../listener/listener.module";
import { MapperModule } from "../mapper/mapper.module";
import { AskModule } from "../ask/ask.module";

@Module({ imports: [ListenerModule, MapperModule, AskModule], controllers: [ReplayController] })
export class ReplayModule {}
