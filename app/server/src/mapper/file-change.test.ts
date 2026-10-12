import test from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { fileChange } from "./live";
import { CommandEdits } from "../listener/command-edits";

test("a file-content event carries the path; its content is read only when asked", () => {
  const z = (s: string) => deflateRawSync(s, { level: 1 });
  const c = fileChange("/r/a.ts", 1, z("old"), z("new"));
  assert.equal(c.path, "/r/a.ts");
  assert.ok(c.bytes > 0);
  assert.equal(c.before, "old");
  assert.equal(c.after, "new");
  assert.equal(fileChange("/r/a.ts", 1, "", null).before, "");
  assert.equal(fileChange("/r/a.ts", 1, null, null).after, null);
});

test("the changes command edits keep are bounded by bytes, and never decompressed unless a command names the file", () => {
  const ce = new CommandEdits(() => true);
  let reads = 0;
  const big = (i: number) => ({ path: `/r/f${i}`, at: 1000 + i, bytes: 4 * 1024 * 1024, get before() { reads++; return "a"; }, get after() { reads++; return "b"; } });
  for (let i = 0; i < 10; i++) ce.fileChanged(big(i));
  const kept = (ce as unknown as { changes: { path: string }[]; changeBytes: number });
  assert.ok(kept.changeBytes <= 16 * 1024 * 1024, `${kept.changeBytes}`);
  assert.equal(kept.changes.at(-1)!.path, "/r/f9");
  assert.equal(reads, 0);
});
