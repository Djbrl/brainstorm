import { Controller, Get } from "@nestjs/common";
import { createHash } from "node:crypto";

const keyHash = (k?: string) => (k ? createHash("sha256").update(k).digest("hex").slice(0, 12) : null);

/** The launcher and the page use this to tell which Rundown is running (and whether it has the current key). */
@Controller()
export class HealthController {
  @Get("health") health() {
    return { ok: true, version: process.env.BRAINSTORM_VERSION ?? "dev", pid: process.pid, anthropicKey: keyHash(process.env.ANTHROPIC_API_KEY) };
  }
}
