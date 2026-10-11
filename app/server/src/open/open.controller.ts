import { BadRequestException, Body, Controller, ForbiddenException, HttpCode, Post } from "@nestjs/common";
import { execFile } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, normalize } from "node:path";
import { ListenerService } from "../listener/listener.service";
import { tooBroad, WorkspaceService } from "../workspace/workspace.service";
import { insideAny } from "../core/paths";

// "Open in your default app" for a file shown in the step panel: the computer opens it with whatever
// app it uses for that kind of file. Only a text or code file (by extension: never a program, a script a double-click would run, or an app),
// only one that exists, and only inside the project or a folder a thread worked in. Only from the app itself: a JSON
// request with a local Origin (no CORS, so no other site can send one).

const OPENABLE = new Set(("ts tsx js jsx mjs cjs mts cts json jsonc md mdx txt css scss sass less xml yml yaml toml ini cfg conf env "
  + "go rs java kt kts swift c h cc cpp hpp cs sql graphql gql vue svelte astro csv log lock gitignore dockerfile").split(" "));
// Left out on purpose: shell scripts (a Terminal may be their app), Python (python.org's Launcher runs a .py), Ruby,
// PHP, Lua, HTML (a browser runs its scripts); and on Windows JavaScript, which Windows Script Host runs.
const RUN_ON_WINDOWS = new Set("js jsx mjs cjs".split(" "));
/** Dotfiles by their name (.env, .env.local, .gitignore) and text files that have no extension. */
const DOTFILES = new Set("env gitignore gitattributes dockerignore editorconfig prettierrc eslintrc nvmrc npmrc".split(" "));
const PLAIN_NAMES = new Set("readme license licence makefile dockerfile changelog contributing authors notice copying procfile".split(" "));

/** Whether a file opens from here, by its name: a text or code extension, a known dotfile, or a known plain name. An
 *  extensionless file must also not be executable (the computer would run it in a terminal). */
export function openable(path: string, mode = 0): boolean {
  const name = basename(path).toLowerCase();
  if (name.startsWith(".")) return DOTFILES.has(name.slice(1).split(".")[0]);
  const ext = extname(name).slice(1);
  if (!ext) return PLAIN_NAMES.has(name) && (mode & 0o111) === 0;
  return OPENABLE.has(ext) && !(process.platform === "win32" && RUN_ON_WINDOWS.has(ext));
}

@Controller()
export class OpenController {
  constructor(private ws: WorkspaceService, private listener: ListenerService) {}

  @Post("open") @HttpCode(204)
  open(@Body() body: { path?: unknown }) {
    const path = typeof body?.path === "string" ? normalize(body.path) : "";
    if (!isAbsolute(path)) throw new BadRequestException("A full path is needed");
    // The link and what it leads to both have to be openable: the computer picks the app by the real file
    // (notes.md -> run.command would open Terminal).
    let real, st;
    try { real = realpathSync(path); st = statSync(real); } catch { throw new BadRequestException("No such file"); }
    if (!st.isFile()) throw new BadRequestException("Not a file");
    if (!openable(path, st.mode) || !openable(real, st.mode)) throw new ForbiddenException("Only text and code files open from here");
    // A thread started in the home folder (or /) doesn't make every file on the disk "a thread's folder".
    const roots = [this.ws.status().root, ...this.listener.listSessions().map((s) => s.cwd)].filter((r): r is string => !!r && !tooBroad(r));
    if (!insideAny(real, roots)) throw new ForbiddenException("Outside the project and the threads' folders");
    const [cmd, args] = process.platform === "darwin" ? ["open", [real]] : process.platform === "win32" ? ["explorer.exe", [real]] : ["xdg-open", [real]];
    execFile(cmd, args, () => { /* the app opens on its own; nothing to report */ });
  }

  /** "Show in Finder" (Explorer, the file manager) for a file shown on the map, an island's too (a temp folder, Claude
   *  Code's own): the folder opens with the file selected. Nothing is opened or run, so any existing path will do. */
  @Post("reveal") @HttpCode(204)
  reveal(@Body() body: { path?: unknown }) {
    const path = typeof body?.path === "string" ? normalize(body.path) : "";
    if (!isAbsolute(path)) throw new BadRequestException("A full path is needed");
    try { statSync(path); } catch { throw new BadRequestException("No such file"); }
    const [cmd, args] = process.platform === "darwin" ? ["open", ["-R", path]]
      : process.platform === "win32" ? ["explorer.exe", [`/select,${path}`]] : ["xdg-open", [dirname(path)]];
    execFile(cmd, args, () => { /* the file manager opens on its own */ });
  }
}
