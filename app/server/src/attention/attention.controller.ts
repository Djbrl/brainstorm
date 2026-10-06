import { Body, Controller, ForbiddenException, Get, Headers, HttpCode, Post } from "@nestjs/common";
import { AttentionService, type HookSignal } from "./attention.service";

@Controller()
export class AttentionController {
  constructor(private attention: AttentionService) {}

  @Get("attention") list() { return this.attention.list(); }

  /**
   * The plugin's hooks post here (plugin/scripts/signal.mjs). The custom header can't be sent by another web page without
   * a CORS preflight, which this server never answers, so only local programs can post.
   */
  @Post("hooks") @HttpCode(204)
  hook(@Headers("x-rundown-hook") h: string | undefined, @Headers("x-brainstorm-hook") old: string | undefined, @Body() body: HookSignal) {
    if (h !== "1" && old !== "1") throw new ForbiddenException(); // x-brainstorm-hook: a 0.4 plugin's hooks, until 0.6
    this.attention.signal(body);
  }
}
