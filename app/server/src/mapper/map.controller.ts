import { Controller, Get, Query } from "@nestjs/common";
import { MapperService } from "./mapper.service";
import { ConfigService } from "../core/config.service";

// Owner: B.
@Controller()
export class MapController {
  constructor(private mapper: MapperService, private cfg: ConfigService) {}
  // Only the open project: a link (or another site's no-cors request) can't make the server walk any other folder.
  @Get("map") map(@Query("root") _root?: string) { return this.mapper.getMapAsync(this.cfg.defaultRoot); }
  @Get("history") history(@Query("root") _root?: string) { return this.mapper.getHistory(this.cfg.defaultRoot); }
}
