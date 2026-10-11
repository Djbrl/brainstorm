import { Controller, Get, Query } from "@nestjs/common";
import type { LiveToken } from "../shared/contract";
import { config } from "./config";
import { keyTag, LIVE_TOKEN, proof } from "./secrets";

/** The launcher and the page use this to tell which Rundown is running (and whether it has the current key). */
@Controller()
export class HealthController {
  /** `?challenge=` (from the launcher or a hook): the answer carries a proof only the real server can make. */
  @Get("health") health(@Query("challenge") challenge?: string) {
    const c = typeof challenge === "string" && /^[A-Za-z0-9_-]{16,128}$/.test(challenge) ? challenge : null;
    return { ok: true, version: config.version ?? "dev", pid: process.pid, anthropicKey: keyTag(config.anthropicKey || undefined), ...(c ? { proof: proof(c) } : {}) };
  }

  /** The live feed's token, for Rundown's own page. Other origins can't read this answer (no CORS). */
  @Get("live-token") liveToken(): LiveToken { return { token: LIVE_TOKEN }; }
}
