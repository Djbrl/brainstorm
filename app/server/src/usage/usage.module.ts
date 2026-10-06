import { Global, Module } from "@nestjs/common";
import { UsageController } from "./usage.controller";
import { UsageService } from "./usage.service";

// Owned by the lead. Anonymous usage stats (usage.service.ts). Global: any module can count a use.
@Global()
@Module({ providers: [UsageService], controllers: [UsageController], exports: [UsageService] })
export class UsageModule {}
