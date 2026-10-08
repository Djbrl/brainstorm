import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { insideAny } from "./roots";

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
