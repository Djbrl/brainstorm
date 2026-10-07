import { Body, Controller, Get, Post } from "@nestjs/common";
import { WorkspaceService } from "./workspace.service";

// Owner: S.
@Controller()
export class WorkspaceController {
  constructor(private ws: WorkspaceService) {}
  @Get("workspace") status() { return this.ws.status(); }
  @Get("workspace/suggestions") suggestions() { return this.ws.suggestions(); }
  /** `guest`: a thread to bring along as a visitor (entering a project from its island on the map). */
  @Post("workspace") select(@Body() body: { root: string; guest?: string }) { return this.ws.select(body.root, body.guest); }
}
