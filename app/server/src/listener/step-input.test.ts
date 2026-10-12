import test from "node:test";
import assert from "node:assert/strict";
import { slimStep } from "./step-store";
import type { Step } from "../shared/contract";

const base: Step = { id: "a:0", sessionId: "s", seq: 0, ts: "t", kind: "edit", tool: "Edit", filePath: "/r/a.ts", isSubagent: false };

test("slimStep leaves out what an edit's diff repeats, and only that", () => {
  const edit = { ...base, input: { file_path: "/r/a.ts", old_string: "a", new_string: "b", replace_all: true }, diff: { before: "a", after: "b" } };
  assert.deepEqual(slimStep(edit), { ...edit, input: { file_path: "/r/a.ts", replace_all: true }, inputTrimmed: true });
  const write = { ...base, tool: "Write", input: { file_path: "/r/a.ts", content: "x" }, diff: { before: "", after: "x" } };
  assert.deepEqual(slimStep(write).input, { file_path: "/r/a.ts" });
  const multi = { ...base, tool: "MultiEdit", input: { file_path: "/r/a.ts", edits: [{ old_string: "a", new_string: "b" }] }, diff: { before: "a", after: "b" } };
  assert.deepEqual(slimStep(multi).input, { file_path: "/r/a.ts" });
  // No diff (a command's edit seen without its text): the input is the only copy, kept.
  const byCommand = { ...base, input: { file_path: "/r/a.ts", command: "sed -i", byCommand: true } };
  assert.equal(slimStep(byCommand), byCommand);
  const call: Step = { ...base, kind: "tool_call", tool: "Bash", input: { command: "echo", content: "x" } };
  assert.equal(slimStep(call), call);
});
