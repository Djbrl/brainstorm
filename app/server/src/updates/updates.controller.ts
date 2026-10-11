import { BadRequestException, Body, Controller, Get, Headers, Put } from "@nestjs/common";
import { local } from "../usage/usage.controller";
import { UpdatesService, type UpdatesStatus } from "./updates.service";

// The "tell me when there's a new version" setting (updates.service.ts). Only from the app itself.
@Controller()
export class UpdatesController {
  constructor(private updates: UpdatesService) {}

  @Get("updates") status(): UpdatesStatus { return this.updates.status(); }

  @Put("updates") set(@Body() body: { enabled?: unknown }, @Headers("origin") origin?: string, @Headers("content-type") type?: string): UpdatesStatus {
    local(origin, type);
    if (typeof body?.enabled !== "boolean") throw new BadRequestException("enabled: true or false");
    return this.updates.setEnabled(body.enabled);
  }
}
