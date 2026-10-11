import { Controller, Get, HttpException, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Replay, Session, Step } from "../shared/contract";
import { ListenerService } from "../listener/listener.service";
import { ReplayService } from "./replay.service";
import { threadMarkdown } from "./markdown";
import { forSharing, slug } from "./privacy";
import { slimMap } from "./slim";
import { UsageService } from "../usage/usage.service";
import { config } from "../core/config";
import { ConfigService } from "../core/config.service";
import { shareMapRoot, within } from "./share-root";

const PLACEHOLDER = "<!--rundown:replay-->";

/** The one-file web app a shared replay is poured into (built by app/web/scripts/build-share.mjs). */
function shareTemplate(): string | null {
  const web = config.webDir;
  const candidates = [
    config.shareTemplate,
    web && join(web, "..", "share.html"),            // plugin: build/web + build/share.html
    resolve(__dirname, "../../../web/dist-share/share.html"), // dev: app/server/dist/replay → app/web/dist-share
  ];
  for (const c of candidates) if (c && existsSync(c)) return readFileSync(c, "utf8");
  return null;
}

/** The shared file's name, from the shared title (secrets, home, names already masked): the name leaves with the file. */
const fileName = (replay: Replay, session: Session) => `rundown-${slug(replay.shared?.title ?? "")}-${session.startedAt.slice(0, 10)}`;

const escHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

// Sharing a thread: GET /api/share (one .html file anyone can open) and GET /api/export.md (a report).
@Controller()
export class ShareController {
  constructor(private listener: ListenerService, private replays: ReplayService, private usage: UsageService, private cfg: ConfigService) {}

  /** The thread to share: the one asked for, or the newest one working in the open project (not one from another
   *  project that only visited it). */
  private pick(sessionId?: string): Session {
    const id = sessionId?.split(",")[0];
    const s = id ? this.listener.getSession(id) : this.listener.listSessions().find((t) => [t.cwd, t.home].some((f) => f && within(f, this.cfg.defaultRoot)));
    if (!s) throw new HttpException(id ? `No thread ${id}` : "No thread in this project to share yet", 404);
    return s;
  }

  /** A replay of one thread for someone else: only this thread (no Ask answers), the part of the map it touched (slim.ts),
   *  secrets masked, no screenshots. */
  async sharedReplay(session: Session): Promise<Replay> {
    const steps = this.listener.listSteps(session.id);
    const raw = await this.replays.build(session.id, undefined, undefined, undefined, undefined, undefined, { mapRoot: shareMapRoot(session, steps, this.cfg.defaultRoot) });
    const answers: Replay["answers"] = []; // a shared file carries no Ask answers: they were asked here, about this machine
    const shared = { title: session.title || "Untitled thread", createdAt: new Date().toISOString(), version: config.version ?? "dev" };
    const map = raw.map && slimMap(raw.map, raw.steps);
    return forSharing({ ...raw, map, answers, shared });
  }

  @Get("share") async share(@Query("sessionId") sessionId: string | undefined, @Query("format") format: string | undefined, @Res() res: Response) {
    const session = this.pick(sessionId);
    const replay = await this.sharedReplay(session);
    this.usage.bump("sh");
    const name = fileName(replay, session);
    if (format === "json") {
      res.setHeader("Content-Disposition", `attachment; filename="${name}.json"`);
      return res.json(replay);
    }
    const template = shareTemplate();
    if (!template) throw new HttpException("The share page isn't built. Run `npm run build:share` in app/web.", 503);
    // JSON inside <script> can't contain "</script>": escaping every "<" keeps it valid JSON and inert HTML.
    const data = `<script id="rundown-replay" type="application/json">${JSON.stringify(replay).replace(/</g, "\\u003c")}</script>`;
    const html = template
      .replace(/<title>[^<]*<\/title>/, () => `<title>${escHtml(replay.shared!.title)} · Rundown replay</title>`)
      .replace(PLACEHOLDER, () => data);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${name}.html"`);
    return res.send(html);
  }

  @Get("export.md") async exportMarkdown(@Query("sessionId") sessionId: string | undefined, @Res() res: Response) {
    const session = this.pick(sessionId);
    const replay = await this.sharedReplay(session);
    this.usage.bump("sh");
    const steps: Step[] = replay.steps;
    const md = threadMarkdown(replay.sessions[0] ?? session, steps, replay.map);
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName(replay, session)}.md"`);
    return res.send(md);
  }
}
