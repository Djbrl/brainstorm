import { Controller, Get, NotFoundException, Param, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../core/local";
import { TasksService } from "./tasks.service";
import { ShotsService } from "./shots.service";

// Owned by the lead. Tasks API. Local only: the server listens on 127.0.0.1, and files are served only if the task
// made or used them. None of this is part of a replay export.
@Controller()
export class TasksController {
  constructor(private tasks: TasksService, private shots: ShotsService) {}

  @Get("tasks") list() { return this.tasks.list(); }

  @Get("tasks/shot/:stepId/:idx") shot(@Param("stepId") stepId: string, @Param("idx") idx: string, @Res() res: Response) {
    const s = this.shots.get(stepId, Number(idx) || 0);
    if (!s) throw new NotFoundException();
    res.setHeader("Content-Type", s.media);
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.end(Buffer.from(s.data));
  }

  @Get("tasks/:sessionId") detail(@Param("sessionId") sessionId: string) {
    const d = this.tasks.detail(sessionId);
    if (!d) throw new NotFoundException();
    return d;
  }

  /** A file the task made or used. `?frame=1` on a video returns one still (needs ffmpeg), for thumbnails. */
  @Get("tasks/:sessionId/file") async file(@Param("sessionId") sessionId: string, @Query("path") path: string, @Query("frame") frame: string | undefined, @Res() res: Response) {
    const kind = path ? this.tasks.allowedFile(sessionId, path) : undefined;
    if (!kind || !existsSync(path) || !statSync(path).isFile()) throw new NotFoundException();
    res.setHeader("Cache-Control", "no-store");
    if (frame && kind === "video") {
      const still = await videoStill(path);
      if (!still) throw new NotFoundException();
      return res.sendFile(still, { dotfiles: "allow" }); // the data folder can sit under ~/.claude
    }
    res.sendFile(path, { dotfiles: "allow" });
  }
}

/** A frame from one second in (or the first frame), cached by path and modification time. */
function videoStill(path: string): Promise<string | undefined> {
  const dir = join(dataDir(), "previews");
  mkdirSync(dir, { recursive: true });
  const out = join(dir, createHash("sha1").update(`${path}:${statSync(path).mtimeMs}`).digest("hex") + ".jpg");
  if (existsSync(out)) return Promise.resolve(out);
  const run = (ss: string) => new Promise<boolean>((ok) =>
    execFile("ffmpeg", ["-y", "-ss", ss, "-i", path, "-frames:v", "1", "-vf", "scale=640:-2", out], { timeout: 15_000 }, (e) => ok(!e && existsSync(out))));
  return run("1").then((done) => done || run("0")).then((done) => (done ? out : undefined));
}
