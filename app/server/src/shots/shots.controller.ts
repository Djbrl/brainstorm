import { Controller, Get, NotFoundException, Param, Res } from "@nestjs/common";
import type { Response } from "express";
import { SHOT_TYPES, ShotsService } from "./shots.service";

// Owned by the lead. A screenshot a tool returned, for the step panel. The URL keeps its old /tasks prefix, so the web
// app and links stay as they were. Local only: the server listens on 127.0.0.1.
@Controller()
export class ShotsController {
  constructor(private shots: ShotsService) {}

  @Get("tasks/shot/:stepId/:idx") shot(@Param("stepId") stepId: string, @Param("idx") idx: string, @Res() res: Response) {
    const s = this.shots.shot(stepId, Number(idx) || 0);
    if (!s || !SHOT_TYPES.has(s.media)) throw new NotFoundException(); // a row stored before the type check
    res.setHeader("Content-Type", s.media);
    // Only ever an image: never a page or a script, even opened on its own.
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.end(Buffer.from(s.data));
  }
}
