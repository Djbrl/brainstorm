import { Global, Module } from "@nestjs/common";
import { DbService } from "./db.service";
import { BusService } from "./bus.service";
import { EventsGateway } from "./events.gateway";
import { ConfigService } from "./config.service";

@Global()
@Module({ providers: [DbService, BusService, EventsGateway, ConfigService], exports: [DbService, BusService, EventsGateway, ConfigService] })
export class CoreModule {}
