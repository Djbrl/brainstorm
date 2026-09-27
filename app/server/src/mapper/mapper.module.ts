import { Module } from "@nestjs/common";
import { MapperService } from "./mapper.service";
import { MapController } from "./map.controller";

// Owner: B.
@Module({ providers: [MapperService], controllers: [MapController], exports: [MapperService] })
export class MapperModule {}
