// Run: npx tsc -p . && node --test dist/
import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { tooBroad } from "./workspace.service";

test("a folder of folders is never a workspace: the disk, home and above it, ~/Documents and the like", () => {
  const home = homedir();
  for (const p of ["/", home, home + "/", join(home, "Documents"), join(home, "Desktop"), join(home, "Downloads"), join(home, "..")]) assert.equal(tooBroad(p), true, p);
});

test("a project is a workspace, also one inside ~/Documents", () => {
  const home = homedir();
  for (const p of [join(home, "rundown"), join(home, "Documents", "brainstorm"), join(home, "Projects"), "/tmp/x"]) assert.equal(tooBroad(p), false, p);
});
