import { Body, Controller, Get, Post, ServiceUnavailableException } from "@nestjs/common";
import { chooseFolder, type Chosen } from "./choose-folder";
import { WorkspaceService } from "./workspace.service";

// Owner: S.
@Controller()
export class WorkspaceController {
  constructor(private ws: WorkspaceService) {}
  @Get("workspace") status() { return this.ws.status(); }
  @Get("workspace/suggestions") suggestions() { return this.ws.suggestions(); }
  /** `guest`: a thread to bring along as a visitor (entering a project from its island on the map). */
  /** The system's folder picker, on this machine (one at a time: a second ask waits for the same dialog). */
  @Post("workspace/choose") async choose(): Promise<Chosen> {
    this.picking ??= chooseFolder().finally(() => { this.picking = null; });
    try { return await this.picking; } catch (e) { throw new ServiceUnavailableException((e as Error).message); }
  }
  private picking: Promise<Chosen> | null = null;
  /** `anyway`: open a big folder that isn't a git project after the person was asked (see WorkspaceService.checkSize). */
  @Post("workspace") select(@Body() body: { root: string; guest?: string; anyway?: boolean }) { return this.ws.select(body.root, body.guest, body.anyway === true); }
}
