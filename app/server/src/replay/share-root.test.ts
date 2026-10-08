import { test } from "node:test";
import assert from "node:assert/strict";
import { shareMapRoot } from "./share-root";

const HOME = "/Users/me";
const open = "/Users/me/code/app";

test("a thread of the open project shares the open project's map", () => {
  assert.equal(shareMapRoot({ cwd: "/Users/me/code/app/web" }, [{ filePath: "/Users/me/code/app/web/a.ts" }], open, HOME), open);
});

test("a thread from another project shares its own project's map", () => {
  const steps = [{ filePath: "/Users/me/code/other/src/a.ts" }, { filePath: "/Users/me/code/other/b.ts" }, {}];
  assert.equal(shareMapRoot({ cwd: "/Users/me/code/other" }, steps, open, HOME), "/Users/me/code/other");
});

test("a thread in a worktree, even deep in it, uses its repo", () => {
  const steps = [{ filePath: "/Users/me/code/other/.claude/worktrees/x/app/a.ts" }];
  assert.equal(shareMapRoot({ cwd: "/Users/me/code/other/.claude/worktrees/x/app/server" }, steps, open, HOME), "/Users/me/code/other/app/server");
  assert.equal(shareMapRoot({ cwd: "/Users/me/code/other/.claude/worktrees/x" }, steps, open, HOME), "/Users/me/code/other");
});

test("a thread from elsewhere that mostly worked in the open project shares the open project's map", () => {
  const steps = [{ filePath: "/Users/me/code/app/a.ts" }, { filePath: "/Users/me/code/app/b.ts" }, { filePath: "/Users/me/code/other/c.ts" }];
  assert.equal(shareMapRoot({ cwd: "/Users/me/code/other" }, steps, open, HOME), open);
});

test("a thread run from the home folder never maps the home folder", () => {
  assert.equal(shareMapRoot({ cwd: HOME }, [{ filePath: "/Users/me/notes.md" }], open, HOME), open);
});
