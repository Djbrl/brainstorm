import { BadRequestException, Body, Controller, Get, Module, Put } from "@nestjs/common";
import { SettingsService } from "../core/settings.service";

// Whether this install has had the tour (web lib/tour.ts): kept here, not in a browser, so the
// Claude app's pane, Chrome and Safari don't each show it again. `done` once it's finished or skipped.
const KEY = "onboarding.done";

@Controller()
export class OnboardingController {
  constructor(private settings: SettingsService) {}

  @Get("onboarding") status(): { done: boolean } {
    return { done: this.settings.get(KEY) === "1" };
  }

  /** {done: boolean}: only from the app itself (JSON with a local Origin), like the usage setting. */
  @Put("onboarding") set(@Body() body: { done?: unknown }): { done: boolean } {
    if (typeof body?.done !== "boolean") throw new BadRequestException("done: true or false");
    this.settings.set(KEY, body.done ? "1" : "0");
    return { done: body.done };
  }
}

@Module({ controllers: [OnboardingController] })
export class OnboardingModule {}
