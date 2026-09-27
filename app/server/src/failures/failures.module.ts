import { Module } from "@nestjs/common";
import { FailuresService } from "./failures.service";
import { FailuresController } from "./failures.controller";
import { ListenerModule } from "../listener/listener.module";

@Module({ imports: [ListenerModule], providers: [FailuresService], controllers: [FailuresController], exports: [FailuresService] })
export class FailuresModule {}
