// A shared replay's map: only the touched files and a few around them. Run: cd app/server && npx tsc -p . && node --test dist/replay/
import { test } from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import type { ProjectMap, Step } from "../types";
import { forSharing } from "./privacy";
import { slimMap, touchedFiles } from "./slim";

const R = `${homedir()}/app`;
const file = (rel: string, lastChangedAt = "2026-10-01T00:00:00.000Z") => ({ path: `${R}/${rel}`, module: rel.split("/")[0], lines: 10, lastChangedAt });
const step = (filePath: string, seq = 1): Step => ({ id: `s${seq}`, sessionId: "t", seq, ts: "2026-10-08T00:00:00.000Z", kind: "edit", tool: "Edit", filePath });

function bigMap(): ProjectMap {
  const files = [
    file("src/a.ts"), file("src/b.ts"), file("src/c.ts", "2026-10-07T00:00:00.000Z"),
    file("lib/used-by-a.ts"), file("lib/uses-a.ts"), file("lib/unrelated.ts"),
    ...Array.from({ length: 500 }, (_, i) => file(`far/f${i}.ts`)),
  ];
  return {
    root: R, files, modules: [{ id: "src" }, { id: "lib" }, { id: "far" }], totalFiles: 900, unread: 3,
    edges: [
      { from: `${R}/src/a.ts`, to: `${R}/lib/used-by-a.ts` },
      { from: `${R}/lib/uses-a.ts`, to: `${R}/src/a.ts` },
      { from: `${R}/far/f1.ts`, to: `${R}/far/f2.ts` },
    ],
  };
}

test("keeps the touched files, their imports and folder, and drops the rest", () => {
  const map = bigMap();
  const slim = slimMap(map, [step(`${R}/src/a.ts`), step(`${homedir()}/.claude/plans/x.md`, 2)]);
  const paths = slim.files.map((f) => f.path.slice(R.length + 1)).sort();
  assert.deepEqual(paths, ["lib/used-by-a.ts", "lib/uses-a.ts", "src/a.ts", "src/b.ts", "src/c.ts"]);
  assert.equal(slim.edges.length, 2); // only the imports between kept files
  assert.deepEqual(slim.modules.map((m) => m.id).sort(), ["lib", "src"]);
  assert.equal(slim.totalFiles, 900); // the project's size, for the "N of M files" note
  assert.equal(slim.unread, undefined);
  assert.ok(JSON.stringify(slim).length < JSON.stringify(map).length / 20);
});

test("caps the files around the touched ones, imports first", () => {
  const map = bigMap();
  const slim = slimMap(map, [step(`${R}/src/a.ts`), step(`${R}/far/f0.ts`, 2)], 3);
  const paths = new Set(slim.files.map((f) => f.path.slice(R.length + 1)));
  assert.equal(slim.files.length, 5); // 2 touched + 3 around them
  assert.ok(paths.has("lib/used-by-a.ts") && paths.has("lib/uses-a.ts"));
});

test("matches files touched from a worktree of the repo", () => {
  const map = bigMap();
  assert.deepEqual([...touchedFiles(map, [step(`${R}/.claude/worktrees/fix/src/b.ts`)])], [`${R}/src/b.ts`]);
});

test("a thread that touched no file still gets a few files", () => {
  const slim = slimMap(bigMap(), [], 4);
  assert.equal(slim.files.length, 4);
  assert.equal(slim.files.some((f) => f.path.endsWith("src/c.ts")), true); // the most recently changed
});

test("the slim map is still redacted when shared", () => {
  const shared = forSharing(slimMap(bigMap(), [step(`${R}/src/a.ts`)]));
  assert.equal(shared.root, "~/app");
  assert.equal(shared.files.length, 5);
  assert.ok(shared.files.every((f) => f.path.startsWith("~/app/")));
  assert.ok(shared.edges.every((e) => e.from.startsWith("~/app/") && e.to.startsWith("~/app/")));
});
