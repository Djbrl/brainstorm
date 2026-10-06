import { BadRequestException, Body, Controller, ForbiddenException, Headers, HttpCode, Post } from "@nestjs/common";
import { execFile } from "node:child_process";
import { statSync } from "node:fs";
import { extname, isAbsolute, normalize, sep } from "node:path";
import { isLocalHost } from "../core/local";
import { ListenerService } from "../listener/listener.service";
import { WorkspaceService } from "../workspace/workspace.service";

// Owner: viewers. "Open in your default app" for a file shown in the step panel: the computer opens it with whatever
// app it uses for that kind of file. Only a text or code file (by extension: never a program, a script a double-click would run, or an app),
// only one that exists, and only inside the project or a folder a thread worked in. Only from the app itself: a JSON
// request with a local Origin (no CORS, so no other site can send one).

const OPENABLE = new Set(("ts tsx js jsx mjs cjs mts cts json jsonc md mdx txt css scss sass less xml yml yaml toml ini cfg conf env "
  + "go rs java kt kts swift c h cc cpp hpp cs sql graphql gql vue svelte astro csv log lock gitignore dockerfile").split(" "));
// Left out on purpose: shell scripts (a Terminal may be their app), Python (python.org's Launcher runs a .py), Ruby,
// PHP, Lua, HTML (a browser runs its scripts); and on Windows JavaScript, which Windows Script Host runs.
const RUN_ON_WINDOWS = new Set("js jsx mjs cjs".split(" "));

@Controller()
export class OpenController {
  constructor(private ws: WorkspaceService, private listener: ListenerService) {}

  @Post("open") @HttpCode(204)
  open(@Body() body: { path?: unknown }, @Headers("origin") origin?: string, @Headers("content-type") type?: string) {
    if (!type?.includes("application/json")) throw new BadRequestException("JSON only");
    if (origin) { let host = ""; try { host = new URL(origin).host; } catch { /* not a URL */ } if (!isLocalHost(host)) throw new ForbiddenException(); }
    const path = typeof body?.path === "string" ? normalize(body.path) : "";
    if (!isAbsolute(path)) throw new BadRequestException("A full path is needed");
    const ext = extname(path).slice(1).toLowerCase() || path.split(sep).pop()!.toLowerCase();
    if (!OPENABLE.has(ext) || (process.platform === "win32" && RUN_ON_WINDOWS.has(ext))) throw new ForbiddenException("Only text and code files open from here");
    let st; try { st = statSync(path); } catch { throw new BadRequestException("No such file"); }
    if (!st.isFile()) throw new BadRequestException("Not a file");
    const roots = [this.ws.status().root, ...this.listener.listSessions().map((s) => s.cwd)].filter((r): r is string => !!r).map((r) => normalize(r).replace(/\/+$/, "") + sep);
    if (!roots.some((r) => path.startsWith(r))) throw new ForbiddenException("Outside the project and the threads' folders");
    const [cmd, args] = process.platform === "darwin" ? ["open", [path]] : process.platform === "win32" ? ["explorer.exe", [path]] : ["xdg-open", [path]];
    execFile(cmd, args, () => { /* the app opens on its own; nothing to report */ });
  }
}
