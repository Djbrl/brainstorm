// Which project's map a shared thread carries (share.controller.ts).
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { inside } from "../core/paths";
import type { Session, Step } from "../shared/contract";
import { outOfWorktree } from "../shared/paths";
import { tooBroad } from "../workspace/workspace.service";

/** A path inside a folder, or the folder itself. */
export const within = (p: string, root: string) => inside(resolve(p), resolve(root));

/** The project a folder belongs to: the repo it's in (up to the folder with .git), or the folder itself outside one. */
function projectOf(dir: string): string {
  const start = resolve(outOfWorktree(dir));
  for (let d = start; ; d = dirname(d)) {
    if (existsSync(join(d, ".git"))) return d;
    if (dirname(d) === d) return start;
  }
}

/**
 * Whose map a thread is shared with: its own project's (where it ran), unless most of the files it touched are in the
 * open project (a thread from elsewhere that came to work here). Never a folder too broad to map (a thread run from ~).
 */
export function shareMapRoot(session: Pick<Session, "cwd" | "home">, steps: Pick<Step, "filePath">[], open: string, homeDir?: string): string {
  const own = [...new Set([session.home, session.cwd].filter((f): f is string => !!f).map(projectOf))].filter((f) => !tooBroad(f, homeDir));
  if (!own.length || own.some((r) => within(r, open))) return open;
  const files = steps.map((s) => s.filePath).filter((f): f is string => !!f).map(outOfWorktree);
  const count = (roots: string[]) => files.filter((f) => roots.some((r) => within(f, r))).length;
  return count(own) >= count([open]) ? own[0] : open;
}
