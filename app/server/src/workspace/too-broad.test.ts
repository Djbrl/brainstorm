// Run: npx tsc -p . && node --test dist/
import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { tooBroad } from "./workspace.service";
import { walkCandidates } from "../mapper/list-files";

test("a folder of folders is never a workspace: the disk, home and above it, ~/Documents and the like", () => {
  const home = homedir();
  for (const p of ["/", home, home + "/", join(home, "Documents"), join(home, "Desktop"), join(home, "Downloads"), join(home, "..")]) assert.equal(tooBroad(p), true, p);
});

test("a project is a workspace, also one inside ~/Documents", () => {
  const home = homedir();
  for (const p of [join(home, "rundown"), join(home, "Documents", "brainstorm"), join(home, "Projects"), "/tmp/x"]) assert.equal(tooBroad(p), false, p);
});

test("a git project is a workspace even where a folder of folders would be (Documents kept in git)", () => {
  const home = mkdtempSync(join(tmpdir(), "rd-home-"));
  try {
    mkdirSync(join(home, "Documents"));
    assert.equal(tooBroad(join(home, "Documents"), home), true);
    mkdirSync(join(home, "Documents", ".git"));
    assert.equal(tooBroad(join(home, "Documents"), home), false);
    assert.equal(tooBroad(home, home), true); // home itself, never
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("a walk stops at its budget and says so; a small one doesn't", async () => {
  const root = mkdtempSync(join(tmpdir(), "rd-walk-"));
  try {
    for (let i = 0; i < 30; i++) mkdirSync(join(root, `d${i}`, "x"), { recursive: true });
    assert.equal((await walkCandidates(root, { dirs: 10, ms: 10_000 })).stopped, true);
    assert.equal((await walkCandidates(root, { dirs: 1000, ms: 10_000 })).stopped, undefined);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
