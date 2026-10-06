import "reflect-metadata";
import { join, resolve } from "node:path";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { NestFactory } from "@nestjs/core";
import { WsAdapter } from "@nestjs/platform-ws";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { NextFunction, Request, Response } from "express";
import { AppModule } from "./app.module";
import { dataDir, isLocalHost } from "./core/local";

const envFile = resolve(__dirname, "../../.env");
// Dev only: the plugin passes its settings in the environment, and must not pick up some .env above its install folder.
if (!process.env.BRAINSTORM_DATA_DIR && existsSync(envFile)) process.loadEnvFile(envFile);

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ["log", "warn", "error"] });
  app.useWebSocketAdapter(new WsAdapter(app));
  app.setGlobalPrefix("api");

  // Local only: refuse requests addressed to any other host name (DNS rebinding), and no CORS, so other sites can't read the API.
  app.use((req: Request, res: Response, next: NextFunction) => (isLocalHost(req.headers.host) ? next() : res.status(403).send("Rundown only answers on localhost")));

  // Plugin build: the server also serves the web app, so it's one process on one port.
  const web = process.env.BRAINSTORM_WEB_DIR;
  if (web && existsSync(join(web, "index.html"))) {
    app.useStaticAssets(web);
    app.use((req: Request, res: Response, next: NextFunction) =>
      // Any other page (/thread/<id>/…) is the app: index.html. `root` matters: the plugin lives under ~/.claude, and
      // sendFile refuses a full path through a dot folder.
      req.method === "GET" && !req.path.startsWith("/api") && !req.path.startsWith("/ws") ? res.sendFile("index.html", { root: web }) : next());
  }

  const version = process.env.BRAINSTORM_VERSION ?? "dev";
  const port = Number(process.env.BRAINSTORM_PORT ?? process.env.PORT ?? 4000);
  await app.listen(port, "127.0.0.1");
  if (process.env.BRAINSTORM_DATA_DIR) {
    writeFileSync(join(dataDir(), "server.json"), JSON.stringify({ pid: process.pid, port, version, startedAt: new Date().toISOString() }));
    rmSync(join(dataDir(), "launch.lock"), { force: true }); // up: the launcher that started us is done
  }
  console.log(`Rundown ${version} on http://localhost:${port}  (api /api, ws /ws)`);
}
bootstrap();
