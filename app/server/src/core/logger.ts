// The server's log: the app's own lines, without Nest's start-up list of every module and route (debug lines, shown
// with RUNDOWN_DEBUG=1), and without colour codes when they'd end up as junk: in a file (the plugin's server.log) or
// with NO_COLOR set (https://no-color.org).
import { ConsoleLogger, type LogLevel } from "@nestjs/common";
import { config } from "./config";

/** Nest's own start-up chatter: one line per module, controller and route, and "starting" / "started". */
const NEST_CHATTER = new Set(["NestFactory", "InstanceLoader", "RoutesResolver", "RouterExplorer", "NestApplication", "WebSocketsController"]);

export class ServerLogger extends ConsoleLogger {
  override log(message: unknown, ...rest: unknown[]) {
    const context = rest[rest.length - 1];
    if (typeof context === "string" && NEST_CHATTER.has(context)) return super.debug(message, ...rest);
    return super.log(message, ...rest);
  }
}

export function serverLogger(colors = !!process.stdout.isTTY): ServerLogger {
  const logLevels: LogLevel[] = config.debugLog ? ["log", "warn", "error", "debug"] : ["log", "warn", "error"];
  return new ServerLogger({ colors: colors && !config.noColor, logLevels });
}
