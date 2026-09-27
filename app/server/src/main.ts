import "reflect-metadata";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { NestFactory } from "@nestjs/core";
import { WsAdapter } from "@nestjs/platform-ws";
import { AppModule } from "./app.module";

const envFile = resolve(__dirname, "../../.env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ["log", "warn", "error"] });
  app.useWebSocketAdapter(new WsAdapter(app));
  app.setGlobalPrefix("api");
  app.enableCors();
  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  console.log(`Brainstorm server on http://localhost:${port}/api  ws://localhost:${port}/ws`);
}
bootstrap();
