import { Body, Controller, Get, Post } from "@nestjs/common";
import { WorkspaceService } from "./workspace.service";

// Owner: S.
@Controller()
export class WorkspaceController {
  constructor(private ws: WorkspaceService) {}
  @Get("workspace") status() { return this.ws.status(); }
  @Get("workspace/suggestions") suggestions() { return this.ws.suggestions(); }
  @Post("workspace") select(@Body() body: { root: string }) { return this.ws.select(body.root); }
}
