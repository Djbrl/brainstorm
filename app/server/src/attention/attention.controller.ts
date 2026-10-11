import { Body, Controller, ForbiddenException, Get, Headers, HttpCode, Post } from "@nestjs/common";
import { maskDeep } from "../privacy/mask";
import type { HookSignal } from "../shared/contract";
import { AttentionService } from "./attention.service";

@Controller()
export class AttentionController {
  constructor(private attention: AttentionService) {}

  @Get("attention") list() { return this.attention.list(); }

  /**
   * The plugin's hooks post here (plugin/scripts/signal.mjs). The custom header can't be sent by another web page without
   * a CORS preflight, which this server never answers, so only local programs can post.
   */
  @Post("hooks") @HttpCode(204)
  hook(@Headers("x-rundown-hook") h: string | undefined, @Body() body: HookSignal) {
    if (h !== "1") throw new ForbiddenException();
    this.attention.signal(maskDeep(body)); // the command or file it asks about is shown and broadcast: secrets masked first
  }
}
