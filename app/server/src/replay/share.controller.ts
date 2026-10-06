import { Controller, Get, HttpException, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Replay, Session, Step } from "../types";
import { ListenerService } from "../listener/listener.service";
import { ReplayService } from "./replay.service";
import { threadMarkdown } from "./markdown";
import { forSharing, slug } from "./privacy";
import { UsageService } from "../usage/usage.service";

const PLACEHOLDER = "<!--brainstorm:replay-->";

/** The one-file web app a shared replay is poured into (built by app/web/scripts/build-share.mjs). */
function shareTemplate(): string | null {
  const web = process.env.BRAINSTORM_WEB_DIR;
  const candidates = [
    process.env.BRAINSTORM_SHARE_TEMPLATE,
    web && join(web, "..", "share.html"),            // plugin: build/web + build/share.html
    resolve(__dirname, "../../../web/dist-share/share.html"), // dev: app/server/dist/replay → app/web/dist-share
  ];
  for (const c of candidates) if (c && existsSync(c)) return readFileSync(c, "utf8");
  return null;
}

const escHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

// Owned by the lead. Sharing a thread: GET /api/share (one .html file anyone can open) and GET /api/export.md (a report).
@Controller()
export class ShareController {
  constructor(private listener: ListenerService, private replays: ReplayService, private usage: UsageService) {}

  /** The thread to share: the one asked for, or the newest one in the workspace. */
  private pick(sessionId?: string): Session {
    const id = sessionId?.split(",")[0];
    const s = id ? this.listener.getSession(id) : this.listener.listSessions()[0];
    if (!s) throw new HttpException(id ? `No thread ${id}` : "No thread to share yet", 404);
    return s;
  }

  /** A replay of one thread for someone else: only this thread, its answers, secrets masked, no screenshots. */
  sharedReplay(session: Session): Replay {
    const raw = this.replays.build(session.id);
    const stepIds = new Set(raw.steps.map((s) => s.id));
    const touched = new Set(raw.steps.map((s) => s.filePath).filter(Boolean) as string[]);
    const answers = raw.answers.filter((a) => (a.request.stepId ? stepIds.has(a.request.stepId) : !!a.request.filePath && touched.has(a.request.filePath)));
    const shared = { title: session.title || "Untitled thread", createdAt: new Date().toISOString(), version: process.env.BRAINSTORM_VERSION ?? "dev" };
    return forSharing({ ...raw, answers, shared });
  }

  @Get("share") share(@Query("sessionId") sessionId: string | undefined, @Query("format") format: string | undefined, @Res() res: Response) {
    const session = this.pick(sessionId);
    const replay = this.sharedReplay(session);
    this.usage.bump("sh");
    const name = `brainstorm-${slug(session.title)}-${session.startedAt.slice(0, 10)}`;
    if (format === "json") {
      res.setHeader("Content-Disposition", `attachment; filename="${name}.json"`);
      return res.json(replay);
    }
    const template = shareTemplate();
    if (!template) throw new HttpException("The share page isn't built. Run `npm run build:share` in app/web.", 503);
    // JSON inside <script> can't contain "</script>": escaping every "<" keeps it valid JSON and inert HTML.
    const data = `<script id="brainstorm-replay" type="application/json">${JSON.stringify(replay).replace(/</g, "\\u003c")}</script>`;
    const html = template
      .replace(/<title>[^<]*<\/title>/, `<title>${escHtml(replay.shared!.title)} · Rundown replay</title>`)
      .replace(PLACEHOLDER, () => data);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${name}.html"`);
    return res.send(html);
  }

  @Get("export.md") exportMarkdown(@Query("sessionId") sessionId: string | undefined, @Res() res: Response) {
    const session = this.pick(sessionId);
    const replay = this.sharedReplay(session);
    this.usage.bump("sh");
    const steps: Step[] = replay.steps;
    const md = threadMarkdown(replay.sessions[0] ?? session, steps, replay.map, replay.failures ?? []);
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="brainstorm-${slug(session.title)}-${session.startedAt.slice(0, 10)}.md"`);
    return res.send(md);
  }
}
