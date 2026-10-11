import { BadRequestException, Body, Controller, Get, HttpCode, Post, Put } from "@nestjs/common";
import type { UsageStatus } from "../shared/contract";
import { THEMES, UsageService, WEB_KEYS, type UsageKey } from "./usage.service";

// The usage-stats setting and the counts the web app reports (see usage.service.ts). Like every write, only from the app
// itself (main.ts: JSON with a local Origin), so no other site can flip the setting or add counts.

@Controller()
export class UsageController {
  constructor(private usage: UsageService) {}

  @Get("usage") status(): UsageStatus { return this.usage.status(); }

  @Put("usage") set(@Body() body: { enabled?: unknown }): UsageStatus {
    if (typeof body?.enabled !== "boolean") throw new BadRequestException("enabled: true or false");
    return this.usage.setEnabled(body.enabled);
  }

  /** Delete the reports already sent (the site removes every report with this install's id); a new id after. */
  @Post("usage/forget") @HttpCode(200)
  forget() {
    return this.usage.forget();
  }

  /** {name: "op" | "th" | "rp" | "lv", theme?}: one use, from the web app. */
  @Post("usage/event") @HttpCode(204)
  event(@Body() body: { name?: unknown; theme?: unknown }) {
    if (typeof body?.name !== "string" || !WEB_KEYS.has(body.name)) throw new BadRequestException("unknown event");
    this.usage.bump(body.name as UsageKey);
    if (typeof body.theme === "string" && THEMES.has(body.theme)) this.usage.setTheme(body.theme);
  }
}
