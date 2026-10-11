import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
  const ctl = new OpenController({ status: () => ({ root }) } as any, { listSessions: () => [] } as any);
  const open = (p: string) => { try { ctl.open({ path: join(root, p) }, undefined, "application/json"); return "ok"; } catch (e: any) { return e.getStatus?.() ?? String(e); } };
  assert.equal(open("notes.md"), 403);
  assert.equal(open("run.command"), 403);
  assert.equal(open("LICENSE"), 403);
  for (const f of [".env", ".env.local", ".gitignore", "README", "Makefile", "src/a.ts"]) assert.equal(open(f), "ok", f);
  assert.equal(open("missing.md"), 400);
  assert.deepEqual(opened.map((a) => a[a.length - 1]), [".env", ".env.local", ".gitignore", "README", "Makefile", "src/a.ts"].map((f) => join(root, f)));
});
