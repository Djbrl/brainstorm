import { Controller, Get, Query } from "@nestjs/common";
import { MapperService } from "./mapper.service";
import { ConfigService } from "../core/config.service";

// Owner: B.
@Controller()
export class MapController {
  constructor(private mapper: MapperService, private cfg: ConfigService) {}
  @Get("map") map(@Query("root") root?: string) { return this.mapper.getMap(root || this.cfg.defaultRoot); }
  @Get("history") history(@Query("root") root?: string) { return this.mapper.getHistory(root || this.cfg.defaultRoot); }
}
