import { Module } from "@nestjs/common";
import { MapperService } from "./mapper.service";
import { MapController } from "./map.controller";

// The project map (mapper.service.ts) and GET /api/map.
@Module({ providers: [MapperService], controllers: [MapController], exports: [MapperService] })
export class MapperModule {}
