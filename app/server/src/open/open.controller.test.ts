import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Session, SetupStatus } from "../shared/contract";

// Never run `open` here: execFile is replaced before the controller is loaded (it calls it through the module object).
const opened: string[][] = [];
// eslint-disable-next-line @typescript-eslint/no-require-imports
require("node:child_process").execFile = (_cmd: string, args: string[]) => { opened.push(args); };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { OpenController } = require("./open.controller") as typeof import("./open.controller");

test("a link is opened by what it leads to: a script behind a .md name is refused, dotfiles and plain names open", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "rd-open-")));
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "run.command"), "echo hi");
  symlinkSync(join(root, "run.command"), join(root, "notes.md"));
  for (const f of [".env", ".env.local", ".gitignore", "README", "Makefile", "src/a.ts"]) writeFileSync(join(root, f), "x");
  writeFileSync(join(root, "LICENSE"), "x"); chmodSync(join(root, "LICENSE"), 0o755); // executable: a terminal would run it
  const ctl = new OpenController({ status: () => ({ root }) as SetupStatus }, { listSessions: () => [] });
  const open = (p: string) => { try { ctl.open({ path: join(root, p) }); return "ok"; } catch (e: any) { return e.getStatus?.() ?? String(e); } };
  assert.equal(open("notes.md"), 403);
  assert.equal(open("run.command"), 403);
  assert.equal(open("LICENSE"), 403);
  for (const f of [".env", ".env.local", ".gitignore", "README", "Makefile", "src/a.ts"]) assert.equal(open(f), "ok", f);
  assert.equal(open("missing.md"), 400);
  assert.deepEqual(opened.map((a) => a[a.length - 1]), [".env", ".env.local", ".gitignore", "README", "Makefile", "src/a.ts"].map((f) => join(root, f)));
});

test("/api/open refuses: no path, a relative path, a folder, a file outside the project and the threads' folders", () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "rd-open-")));
  const root = join(base, "project"), thread = join(base, "thread-folder"), other = join(base, "elsewhere");
  for (const d of [root, thread, other]) mkdirSync(d);
  for (const d of [root, thread, other]) writeFileSync(join(d, "a.md"), "x");
  // A thread that worked in "/" must not make every file on the disk openable.
  const ctl = new OpenController({ status: () => ({ root }) as SetupStatus }, { listSessions: () => [{ cwd: thread } as Session, { cwd: "/" } as Session] });
  const open = (path: unknown) => { const before = opened.length; try { ctl.open({ path }); return opened.length > before ? "ok" : "not run"; } catch (e) { return (e as { getStatus?: () => number }).getStatus?.() ?? String(e); } };
  assert.equal(open(undefined), 400);
  assert.equal(open(42), 400);
  assert.equal(open("project/a.md"), 400);
  assert.equal(open(root), 400); // a folder
  assert.equal(open(join(other, "a.md")), 403);
  assert.equal(open(join(root, "..", "elsewhere", "a.md")), 403); // .. doesn't lead out
  assert.equal(open(join(root, "a.md")), "ok");
  assert.equal(open(join(thread, "a.md")), "ok"); // a thread's folder
});

test("/api/reveal needs a full path to something that exists", () => {
  const ctl = new OpenController({ status: () => ({ root: "/" }) as SetupStatus }, { listSessions: () => [] });
  const reveal = (path: unknown) => { try { ctl.reveal({ path }); return "ok"; } catch (e) { return (e as { getStatus?: () => number }).getStatus?.() ?? String(e); } };
  assert.equal(reveal("relative/x"), 400);
  assert.equal(reveal(join(tmpdir(), "rd-missing-" + Date.now())), 400);
  assert.equal(reveal(tmpdir()), "ok");
});
