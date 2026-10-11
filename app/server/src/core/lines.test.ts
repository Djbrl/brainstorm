import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { forEachLine } from "./lines";
import { earlierCalls, firstCommandItem } from "../listener/codex.source";

const MB4 = 4 * 1024 * 1024;

/** A file whose `line` has the first byte of its "é" as the last byte of the first 4 MB read. */
function acrossTheCut(line: string): string {
  const before = Buffer.byteLength(line.slice(0, line.indexOf("é")));
  const pad = MB4 - 1 - before - 1; // the filler line and its "\n", then `line` up to the "é"
  const filler = JSON.stringify({ type: "x", pad: "" }).length;
  const file = join(mkdtempSync(join(tmpdir(), "rd-lines-")), "log.jsonl");
  writeFileSync(file, JSON.stringify({ type: "x", pad: "p".repeat(pad - filler) }) + "\n" + line + "\n");
  return file;
}

test("a character cut between two reads stays whole: forEachLine and the Codex helpers", () => {
  const cmd = "echo café > menü.txt";
  const call = JSON.stringify({ timestamp: "2026-10-01T00:00:00Z", type: "response_item",
    payload: { type: "function_call", name: "shell", call_id: "call_1", arguments: JSON.stringify({ command: ["bash", "-lc", cmd] }) } });
  const file = acrossTheCut(call);
  const lines: string[] = [];
  assert.equal(forEachLine(file, (l) => { lines.push(l); }), true);
  assert.equal(lines.length, 2);
  assert.equal(lines[1], call);
  assert.equal(earlierCalls(file, () => true).get("call_1")?.args?.command?.[2], cmd);

  const item = JSON.stringify({ timestamp: "2026-10-01T00:00:01Z", type: "event_msg",
    payload: { type: "item_completed", turn_id: "t1", item: { type: "CommandExecution", command: "café" } } }).replace('"type":"item_completed"', '"type":"item_completed","x":"é"');
  assert.equal(firstCommandItem(acrossTheCut(item))?.turnId, "t1");
});

test("forEachLine: only complete lines, a long one skipped, stops when asked", () => {
  const file = join(mkdtempSync(join(tmpdir(), "rd-lines-")), "log.jsonl");
  writeFileSync(file, `a\n${"b".repeat(50)}\n\nc\nd\npartial`);
  const got: string[] = [];
  forEachLine(file, (l) => { got.push(l); }, { chunkBytes: 7, maxLineBytes: 20 });
  assert.deepEqual(got, ["a", "c", "d"]);
  const first: string[] = [];
  forEachLine(file, (l) => { first.push(l); return false; });
  assert.deepEqual(first, ["a"]);
  assert.equal(forEachLine(join(file, "nope"), () => {}), false);
});
