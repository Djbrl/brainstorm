import "reflect-metadata";
import { protectGit } from "./core/git-safety";
protectGit(); // before anything runs git
import { join, resolve } from "node:path";
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { NestFactory } from "@nestjs/core";
import { WsAdapter } from "@nestjs/platform-ws";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { NextFunction, Request, Response } from "express";
import { AppModule } from "./app.module";
import { dataDir, isLocalHost, isLocalWrite, pageCsp, env } from "./core/local";
import { SECRET } from "./core/secrets";

const envFile = resolve(__dirname, "../../.env");
// Dev only: the plugin passes its settings in the environment, and must not pick up some .env above its install folder.
if (!env("DATA_DIR") && existsSync(envFile)) process.loadEnvFile(envFile);

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ["log", "warn", "error"], bodyParser: false });
  app.useWebSocketAdapter(new WsAdapter(app));
  app.setGlobalPrefix("api");

  // Local only: refuse requests addressed to any other host name (DNS rebinding), and no CORS, so other sites can't read the API.
  app.use((req: Request, res: Response, next: NextFunction) => (isLocalHost(req.headers.host) ? next() : res.status(403).send("Rundown only answers on localhost")));
  // Writes come from this app only (CSRF). Another site can send a form or a no-cors fetch here without asking, but
  // not a JSON body (that needs a CORS preflight, which this server never answers), and its page's Origin isn't local.
  app.use((req: Request, res: Response, next: NextFunction) =>
    isLocalWrite(req.method, req.headers["content-type"], req.headers.origin) ? next() : res.status(403).send("Rundown only takes changes from its own page"));
  app.useBodyParser("json"); // JSON only: no form parser, so a form posted from another site has nothing to say
  // What the page may load: only this server. Another site can't frame it (clickjacking), and if text from a log ever
  // got into the page as code, it couldn't load or send anything elsewhere.
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Content-Security-Policy", pageCsp(req.headers.host ?? ""));
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });

  // Plugin build: the server also serves the web app, so it's one process on one port.
  const web = env("WEB_DIR");
  if (web && existsSync(join(web, "index.html"))) {
    app.useStaticAssets(web);
    app.use((req: Request, res: Response, next: NextFunction) =>
      // Any other page (/thread/<id>/…) is the app: index.html. `root` matters: the plugin lives under ~/.claude, and
      // sendFile refuses a full path through a dot folder.
      req.method === "GET" && !req.path.startsWith("/api") && !req.path.startsWith("/ws") ? res.sendFile("index.html", { root: web }) : next());
  }

  const version = env("VERSION") ?? "dev";
  const port = Number(env("PORT") ?? process.env.PORT ?? 4000);
  await app.listen(port, "127.0.0.1");
  if (env("DATA_DIR")) {
    // 0600: the secret lets the launcher and the hooks check they talk to this server, not something else on the port.
    const state = join(dataDir(), "server.json");
    const mine = { pid: process.pid, port, version, startedAt: new Date().toISOString(), secret: SECRET };
    writeFileSync(state, JSON.stringify(mine), { mode: 0o600 });
    chmodSync(state, 0o600); // the mode above only applies to a new file
    rmSync(join(dataDir(), "launch.lock"), { force: true }); // up: the launcher that started us is done
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
  console.log(`Rundown ${version} on http://localhost:${port}  (api /api, ws /ws)`);
}
bootstrap();
