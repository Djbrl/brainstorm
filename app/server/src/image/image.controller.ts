import { Controller, Get, Headers, NotFoundException, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { realpathSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, resolve } from "node:path";
import { isLocalHost } from "../core/local";
import { ListenerService } from "../listener/listener.service";

// Owner: viewers. "Show the picture" in the step panel: an image an agent read, loaded from the person's disk when they
// ask (Codex's log keeps only the path; Claude Code's keeps the picture, served by shots/). It reads files from the
// disk, so it is guarded tightly, and every refusal is the same plain 404 (it never says which rule failed):
//  - only a picture by extension (png, jpg, jpeg, gif, webp, bmp), before and after symlinks are followed;
//  - only a path some thread's step referenced (an agent read it), never an arbitrary file;
//  - only an absolute path, a regular file, under 25 MB;
//  - only from this app's own pages (Sec-Fetch-Site same-origin or none), so no other website can embed your pictures.
// The server listens on 127.0.0.1 only.

const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp" };
const MAX_BYTES = 25 * 1024 * 1024;
const typeOf = (path: string) => TYPES[extname(path).slice(1).toLowerCase()];

@Controller()
export class ImageController {
  constructor(private listener: ListenerService) {}

  @Get("image")
  async image(
    @Query("path") raw: unknown,
    @Res() res: Response,
    @Headers("sec-fetch-site") site?: string,
    @Headers("origin") origin?: string,
    @Headers("host") host?: string,
  ) {
    // This app's own page, or a direct visit. No header at all (curl, old browsers) only when no Origin came either.
    if (site ? site !== "same-origin" && site !== "none" : !!origin) throw new NotFoundException();
    if (host && !isLocalHost(host)) throw new NotFoundException();   // DNS rebinding
    if (typeof raw !== "string" || !raw || raw.includes("\0") || !isAbsolute(raw)) throw new NotFoundException();
    const path = resolve(raw);
    if (!typeOf(path) || !this.listener.stepTouches(path)) throw new NotFoundException();
    let data: Buffer, type: string | undefined;
    try {
      const real = realpathSync(path);
      type = typeOf(real);
      const st = statSync(real);
      if (!type || !st.isFile() || st.size > MAX_BYTES) throw new Error("refused");
      data = await readFile(real);
    } catch { throw new NotFoundException(); }
    res.setHeader("Content-Type", type!);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, max-age=300");
    res.end(data);
  }
}
