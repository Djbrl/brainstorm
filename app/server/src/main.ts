import "reflect-metadata";
import { protectGit } from "./core/git-safety";
protectGit(); // before anything runs git
import { join } from "node:path";
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { NestFactory } from "@nestjs/core";
import { WsAdapter } from "@nestjs/platform-ws";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { NextFunction, Request, Response } from "express";
import { AppModule } from "./app.module";
import { dataDir, isLocalHost, isLocalWrite, pageCsp } from "./core/local";
import { config, loadDevEnv } from "./core/config";
import { shareSecret } from "./core/secrets";
import { buildCommit } from "./core/build-info";
import { serverLogger } from "./core/logger";

// An error nothing caught: written to the log (stderr, server.log under the plugin) before the server stops, so a crash
// says why. Timers and listeners catch their own; this is the last resort, not a way to keep running half broken.
const fatal = (what: string) => (e: unknown) => {
  try { writeSync(2, `${new Date().toISOString()} Rundown stopped on an ${what}: ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`); } catch { /* no stderr */ }
  process.exit(1);
};
process.on("uncaughtException", fatal("uncaught exception"));
process.on("unhandledRejection", fatal("unhandled rejection"));

loadDevEnv();

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: serverLogger(), bodyParser: false, rawBody: true });
  app.useWebSocketAdapter(new WsAdapter(app));
  app.setGlobalPrefix("api");

  // Local only: refuse requests addressed to any other host name (DNS rebinding), and no CORS, so other sites can't read the API.
  app.use((req: Request, res: Response, next: NextFunction) => (isLocalHost(req.headers.host) ? next() : res.status(403).send("Rundown only answers on localhost")));
  // Writes come from this app only (CSRF). Another site can send a form or a no-cors fetch here without asking, but
  // not a JSON body (that needs a CORS preflight, which this server never answers), and its page's Origin isn't local.
  app.use((req: Request, res: Response, next: NextFunction) =>
    isLocalWrite(req.method, req.headers["content-type"], req.headers.origin) ? next() : res.status(403).send("Rundown only takes changes from its own page"));
  app.useBodyParser("json"); // JSON only: no form parser, so a form posted from another site has nothing to say. The raw
  // bytes are kept too (rawBody above): a hook signs the exact body it sends.
  // What the page may load: only this server. Another site can't frame it (clickjacking), and if text from a log ever
  // got into the page as code, it couldn't load or send anything elsewhere.
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Content-Security-Policy", pageCsp(req.headers.host ?? ""));
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });

  // Plugin build: the server also serves the web app, so it's one process on one port.
  const web = config.webDir;
  if (web && existsSync(join(web, "index.html"))) {
    app.useStaticAssets(web);
    // A chunk this build doesn't have (a page loaded before an update asking for its old one): a plain 404, so the page
    // sees the failure and reloads, instead of index.html served as JavaScript.
    app.use("/assets", (_req: Request, res: Response) => res.status(404).type("text/plain").send("Not found"));
    app.use((req: Request, res: Response, next: NextFunction) =>
      // Any other page (/thread/<id>/…) is the app: index.html. `root` matters: the plugin lives under ~/.claude, and
      // sendFile refuses a full path through a dot folder.
      req.method === "GET" && !req.path.startsWith("/api") && !req.path.startsWith("/ws") ? res.sendFile("index.html", { root: web }) : next());
  }

  const version = config.version ?? "dev";
  // For the log: the version and the commit it was built from ("1.2.3 (abc1234)"). server.json keeps the bare version.
  const commit = buildCommit();
  const named = `${version}${commit ? ` (${commit})` : ""}`;
  const first = config.port;
  // The plugin's server picks its own port: the one asked for if it's free, else the next ones (the launcher can't
  // reserve one for us: anything could take it before we bind). Dev keeps its fixed port.
  const tries = config.pluginDataDir ? 50 : 1;
  let port = first;
  for (let i = 0; ; i++) {
    try { await app.listen(port, "127.0.0.1"); break; } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EADDRINUSE" || i + 1 >= tries) throw e;
      port = first + i + 1;
    }
  }
  const state = join(dataDir(), "server.json");
  // On a stop (the launcher's SIGTERM, Ctrl-C, logout): close the app (and with it the database), and remove
  // server.json if it's still ours, so nobody finds a dead server there.
  const shutdown = (signal: string) => {
    console.log(`Rundown ${named} (pid ${process.pid}) stopping on ${signal}`);
    setTimeout(() => process.exit(0), 3000).unref();
    try { if (config.pluginDataDir && JSON.parse(readFileSync(state, "utf8")).pid === process.pid) rmSync(state, { force: true }); } catch { /* not there */ }
    void app.close().catch(() => {}).finally(() => process.exit(0));
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
  if (config.pluginDataDir) {
    // 0600: the secret lets the launcher and the hooks check they talk to this server, not something else on the port.
    const mine = { pid: process.pid, port, version, startedAt: new Date().toISOString(), secret: shareSecret() };
    writeFileSync(state, JSON.stringify(mine), { mode: 0o600 });
    chmodSync(state, 0o600); // the mode above only applies to a new file
    // Up: the launcher that started us is done. Only its own lock (a token it gave us), never another launcher's.
    const lock = join(dataDir(), "launch.lock"), token = config.lockToken;
    try { if (token && readFileSync(lock, "utf8") === token) rmSync(lock, { force: true }); } catch { /* gone */ }
    // One server per data folder. If server.json names another one that's alive, a launcher started it beside us
    // (we were too busy to answer it): it's the one everyone finds now, so we go, instead of running on untracked
    // on the same database. If it names a dead one, we're the server again.
    const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; } };
    setInterval(() => {
      let st: { pid?: number } | null = null;
      try { st = JSON.parse(readFileSync(state, "utf8")); } catch { return; }   // gone: /rundown:stop is stopping us anyway
      if (!st?.pid || st.pid === process.pid) return;
      if (alive(st.pid)) {
        console.log(`Another Rundown (pid ${st.pid}) took over ${dataDir()}: stopping this one (pid ${process.pid}).`);
        setTimeout(() => process.exit(0), 3000).unref();
        void app.close().finally(() => process.exit(0));
        return;
      }
      try { writeFileSync(state, JSON.stringify(mine), { mode: 0o600 }); } catch { /* next minute */ }
    }, 60_000).unref();
  }
  // The address last on its line, so it reads (and a terminal links it) at a glance.
  console.log(`Rundown ${named}, pid ${process.pid}: http://127.0.0.1:${port}`);
}
bootstrap();
