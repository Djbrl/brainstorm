// lineHunks: the changed parts of a file a command rewrote, as an edit's before and after.
import { test } from "node:test";
import assert from "node:assert/strict";
import { lineHunks } from "./line-diff";

const L = (n: number, tag = "line") => Array.from({ length: n }, (_, i) => `${tag} ${i + 1}`);
const j = (a: string[]) => a.join("\n");

test("no change, a new file, an emptied file", () => {
  assert.deepEqual(lineHunks("same\n", "same\n"), { before: "", after: "" });
  assert.deepEqual(lineHunks("", "new\nfile"), { before: "", after: "new\nfile" });
  assert.deepEqual(lineHunks("old\nfile", ""), { before: "old\nfile", after: "" });
});

test("one changed line comes with two lines of context each side", () => {
  const a = L(10), b = [...a];
  b[4] = "changed 5";
  assert.deepEqual(lineHunks(j(a), j(b)), { before: j(["line 3", "line 4", "line 5", "line 6", "line 7"]), after: j(["line 3", "line 4", "changed 5", "line 6", "line 7"]) });
});

test("an insertion and a deletion", () => {
  const a = L(6);
  assert.deepEqual(lineHunks(j(a), j([...a.slice(0, 3), "inserted", ...a.slice(3)])), { before: j(["line 2", "line 3", "line 4", "line 5"]), after: j(["line 2", "line 3", "inserted", "line 4", "line 5"]) });
  assert.deepEqual(lineHunks(j(a), j([...a.slice(0, 2), ...a.slice(3)])), { before: j(["line 1", "line 2", "line 3", "line 4", "line 5"]), after: j(["line 1", "line 2", "line 4", "line 5"]) });
});

test("far-apart changes are separate hunks joined by ---; near ones merge", () => {
  const a = L(30), far = [...a], near = [...a];
  far[2] = "x"; far[25] = "y";
  const h = lineHunks(j(a), j(far));
  assert.equal(h.before.split("\n---\n").length, 2);
  assert.equal(h.after.split("\n---\n")[1], j(["line 24", "line 25", "y", "line 27", "line 28"]));
  near[10] = "x"; near[13] = "y"; // contexts touch
  assert.equal(lineHunks(j(a), j(near)).before.split("\n---\n").length, 1);
});

test("a file that changed everywhere past the diff limit is one hunk, start to end of the change", () => {
  const a = L(3000, "a"), b = L(3000, "b");
  const h = lineHunks(j(["head", ...a, "tail"]), j(["head", ...b, "tail"]));
  assert.equal(h.before, j(["head", ...a, "tail"]));
  assert.equal(h.after, j(["head", ...b, "tail"]));
});

test("a trailing newline added or removed is a change on the last line", () => {
  const h = lineHunks("a\nb\nc", "a\nb\nc\n");
  assert.deepEqual(h, { before: "b\nc", after: "b\nc\n" });
});
