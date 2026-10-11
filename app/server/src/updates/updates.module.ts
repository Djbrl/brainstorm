import { Module } from "@nestjs/common";
import { UpdatesController } from "./updates.controller";
import { UpdatesService } from "./updates.service";

// Owned by the lead. The update-notification setting (updates.service.ts).
@Module({ providers: [UpdatesService], controllers: [UpdatesController] })
export class UpdatesModule {}
