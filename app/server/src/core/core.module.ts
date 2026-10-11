import { Global, Module } from "@nestjs/common";
import { DbService } from "./db.service";
import { BusService } from "./bus.service";
import { EventsGateway } from "./events.gateway";
import { ConfigService } from "./config.service";
import { SettingsService } from "./settings.service";
import { WorkspaceState } from "./workspace-state";

@Global()
@Module({ providers: [DbService, BusService, EventsGateway, ConfigService, SettingsService, WorkspaceState], exports: [DbService, BusService, EventsGateway, ConfigService, SettingsService, WorkspaceState] })
export class CoreModule {}
