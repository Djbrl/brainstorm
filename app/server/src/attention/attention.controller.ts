import { Body, Controller, ForbiddenException, Get, Headers, HttpCode, Logger, Post, Req, type RawBodyRequest } from "@nestjs/common";
import type { Request } from "express";
import { hookCheck } from "../core/secrets";
import { maskDeep } from "../privacy/mask";
import type { HookSignal } from "../shared/contract";
import { AttentionService } from "./attention.service";

@Controller()
export class AttentionController {
  constructor(private attention: AttentionService) {}
  private log = new Logger("Hooks");
  private saidNoSecret = false;

  @Get("attention") list() { return this.attention.list(); }

  /**
   * The plugin's hooks post here (plugin/scripts/signal.mjs). The custom header can't be sent by another web page without
   * a CORS preflight, which this server never answers, so only local programs can post; and each message is signed with
   * the secret in server.json (HMAC of its time and body), so only a program that can read that file can: another local
   * program can't make a thread look like it waits on you. Unsigned, wrongly signed or older than 2 minutes: 403.
   */
  @Post("hooks") @HttpCode(204)
  hook(@Req() req: RawBodyRequest<Request>, @Headers("x-rundown-hook") h: string | undefined, @Headers("x-rundown-ts") ts: string | undefined,
    @Headers("x-rundown-sig") sig: string | undefined, @Body() body: HookSignal) {
    if (h !== "1") throw new ForbiddenException();
    const check = hookCheck(ts, sig, req.rawBody);
    if (check === "no-secret" && !this.saidNoSecret) {
      this.saidNoSecret = true;
      this.log.warn("Hooks refused: this server has no server.json with a secret for them to sign with (started outside the plugin).");
    }
    if (check !== "ok") throw new ForbiddenException();
    this.attention.signal(maskDeep(body)); // the command or file it asks about is shown and broadcast: secrets masked first
  }
}
