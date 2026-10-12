// The views read an edit's change through editPair: from `diff` when the step has it (the server may leave the edit's
// text out of `input`), from the tool input otherwise; only an edit with neither needs the whole step fetched.
import { describe, expect, it } from "vitest";
import type { Step } from "@contract";
import { editPair, lacksChange } from "./StepDetail";

const edit = (over: Partial<Step>): Step => ({ id: "e", sessionId: "s", seq: 0, ts: "2026-10-11T10:00:00Z", kind: "edit", tool: "Edit", filePath: "/p/a.ts", ...over });

describe("editPair", () => {
  it("reads the diff when the input has no text (light steps)", () => {
    for (const tool of ["Edit", "Write", "MultiEdit"]) {
      const s = edit({ tool, input: { file_path: "/p/a.ts" }, diff: { before: "a", after: "b" } });
      expect(editPair(s)).toEqual({ before: "a", after: "b" });
      expect(lacksChange(s)).toBe(false);
    }
  });
  it("still reads older steps' input when there is no diff", () => {
    expect(editPair(edit({ input: { old_string: "x", new_string: "y" } }))).toEqual({ before: "x", after: "y" });
    expect(editPair(edit({ tool: "Write", input: { content: "z" } }))).toEqual({ before: "", after: "z" });
    expect(editPair(edit({ tool: "MultiEdit", input: { edits: [{ old_string: "1", new_string: "2" }, { old_string: "3", new_string: "4" }] } })))
      .toEqual({ before: "1\n\n3", after: "2\n\n4" });
  });
  it("says when only the whole step can show the change", () => {
    expect(lacksChange(edit({ input: { file_path: "/p/a.ts" } }))).toBe(true);
    // A change made by a command, with no diff: nothing more to fetch (it wasn't recorded).
    expect(lacksChange(edit({ input: { file_path: "/p/a.ts", command: "sed -i x a.ts", byCommand: true } }))).toBe(false);
    expect(lacksChange({ ...edit({}), kind: "tool_call" })).toBe(false);
  });
});
