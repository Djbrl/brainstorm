import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inside, insideAny, relativeTo } from "./paths";

test("inside the project, not outside, and a symlink can't lead out", () => {
  const base = mkdtempSync(join(tmpdir(), "roots-"));
  const project = join(base, "project"), outside = join(base, "outside");
  mkdirSync(project); mkdirSync(outside);
  writeFileSync(join(project, "a.ts"), ""); writeFileSync(join(outside, "secret.txt"), "");
  symlinkSync(join(outside, "secret.txt"), join(project, "link.txt"));
  assert.equal(insideAny(join(project, "a.ts"), [project]), true);
  assert.equal(insideAny(join(outside, "secret.txt"), [project]), false);
  assert.equal(insideAny(join(project, "..", "outside", "secret.txt"), [project]), false);
  assert.equal(insideAny(join(project, "link.txt"), [project]), false);
  assert.equal(insideAny(project + "-other/x.ts", [project]), false);
});

test("relativeTo is the path below a root, inside includes the root", () => {
  assert.equal(relativeTo("/a/b/c.ts", "/a"), "b/c.ts");
  assert.equal(relativeTo("/a", "/a"), null);
  assert.equal(relativeTo("/ab/c", "/a"), null);
  assert.equal(relativeTo("/x", "/a"), null);
  assert.equal(inside("/a", "/a"), true);
  assert.equal(inside("/a/b", "/a/"), true);
  assert.equal(inside("/ab", "/a"), false);
});
