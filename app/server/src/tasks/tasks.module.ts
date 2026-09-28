import { Module } from "@nestjs/common";
import { ListenerModule } from "../listener/listener.module";
import { ShotsService } from "./shots.service";
import { TasksService } from "./tasks.service";
import { TasksController } from "./tasks.controller";

@Module({ imports: [ListenerModule], providers: [ShotsService, TasksService], controllers: [TasksController] })
export class TasksModule {}
