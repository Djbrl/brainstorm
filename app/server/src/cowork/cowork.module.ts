import { Module } from "@nestjs/common";
import { CoworkService } from "./cowork.service";
import { CoworkController } from "./cowork.controller";
import { ListenerModule } from "../listener/listener.module";

@Module({ imports: [ListenerModule], providers: [CoworkService], controllers: [CoworkController] })
export class CoworkModule {}
