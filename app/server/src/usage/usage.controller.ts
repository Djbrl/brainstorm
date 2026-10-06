import { BadRequestException, Body, Controller, ForbiddenException, Get, Headers, HttpCode, Post, Put } from "@nestjs/common";
import { isLocalHost } from "../core/local";
import { THEMES, UsageService, WEB_KEYS, type UsageKey, type UsageStatus } from "./usage.service";

// Owned by the lead. The usage-stats setting and the counts the web app reports (see usage.service.ts). Only from the app
// itself: JSON with a local Origin, so no other site can flip the setting or add counts.
function local(origin: string | undefined, type: string | undefined) {
  if (!type?.includes("application/json")) throw new BadRequestException("JSON only");
  if (origin) { let host = ""; try { host = new URL(origin).host; } catch { /* not a URL */ } if (!isLocalHost(host)) throw new ForbiddenException(); }
}

@Controller()
export class UsageController {
  constructor(private usage: UsageService) {}

  @Get("usage") status(): UsageStatus { return this.usage.status(); }

  @Put("usage") set(@Body() body: { enabled?: unknown }, @Headers("origin") origin?: string, @Headers("content-type") type?: string): UsageStatus {
    local(origin, type);
    if (typeof body?.enabled !== "boolean") throw new BadRequestException("enabled: true or false");
    return this.usage.setEnabled(body.enabled);
  }

  /** {name: "op" | "th" | "rp" | "lv", theme?}: one use, from the web app. */
  @Post("usage/event") @HttpCode(204)
  event(@Body() body: { name?: unknown; theme?: unknown }, @Headers("origin") origin?: string, @Headers("content-type") type?: string) {
    local(origin, type);
    if (typeof body?.name !== "string" || !WEB_KEYS.has(body.name)) throw new BadRequestException("unknown event");
    this.usage.bump(body.name as UsageKey);
    if (typeof body.theme === "string" && THEMES.has(body.theme)) this.usage.setTheme(body.theme);
  }
}
