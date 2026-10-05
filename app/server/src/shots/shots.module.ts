import { Module } from "@nestjs/common";
import { ListenerModule } from "../listener/listener.module";
import { ShotsService } from "./shots.service";
import { ShotsController } from "./shots.controller";

@Module({ imports: [ListenerModule], providers: [ShotsService], controllers: [ShotsController] })
export class ShotsModule {}
