import { Controller, Get, Query } from "@nestjs/common";
import { MapperService } from "./mapper.service";
import { WorkspaceState } from "../core/workspace-state";

// GET /api/map: the open project's map.
@Controller()
export class MapController {
  constructor(private mapper: MapperService, private state: WorkspaceState) {}
  // Only the open project: a link (or another site's no-cors request) can't make the server walk any other folder.
  @Get("map") map(@Query("root") _root?: string) { return this.mapper.getMapAsync(this.state.root); }
}
