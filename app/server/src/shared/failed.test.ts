import test from "node:test";
import assert from "node:assert/strict";
import { errorLine, errorText, isErrorResult } from "./failed";
import type { Step } from "./contract";

const res = (text: string, isError = false): Step => ({ id: "r", sessionId: "s", seq: 1, ts: "2026-01-01T00:00:00Z", kind: "tool_result", text, ...(isError ? { input: { isError: true } } : {}) });
const NAV = "mcp__claude-in-chrome__navigate";

// [name, tool, text, flagged, expected]
const CASES: [string, string, string, boolean, boolean][] = [
  ["is_error flag, any tool", "WebFetch", "boom", true, true],
  ["is_error flag, shell", "Bash", "whatever", true, true],
  ["tool_use_error, no flag, edit", "Edit", "<tool_use_error>nope</tool_use_error>", false, true],
  ["Error: Cannot find module, shell", "Bash", "Error: Cannot find module 'x'", false, true],
  ["Exit code 1", "Bash", "Exit code 1\nboom", false, true],
  ["Exit code 137", "Bash", "Exit code 137", false, true],
  ["indented exit code 2", "Bash", "  exit code 2", false, true],
  ["file has not been read yet", "Edit", "File has not been read yet. Read it first.", false, true],
  ["string to replace not found", "Edit", "String to replace not found in file.", false, true],
  ["permission to use Bash denied", "Bash", "Permission to use Bash has been denied.", false, true],
  ["navigation not allowed", NAV, "Navigation to https://x.test was denied", false, true],
  ["navigation domain not allowed", NAV, "Navigation to this domain is not allowed", false, true],
  ["WebFetch page saying not allowed", "WebFetch", "Pets are not allowed in the hotel.", false, false],
  ["WebFetch page titled Error handling", "WebFetch", "Error handling in Go\nGo has no exceptions", false, false],
  ["permission_required", "mcp__x__act", "permission_required", false, false],
  ["Command timed out after", "Bash", "Command timed out after 120s", false, false],
  ["was denied or failed", "mcp__x__act", "The action was denied or failed", false, false],
  ["hook denied by policy", "Bash", "hook: denied by policy", false, true],
  ["Grep output with not allowed", "Grep", "a.md: that is not allowed here", false, false],
  ["user rejected tool use", "Bash", "The user doesn't want to proceed with this tool use. rejected", false, false],
  ["fatal: not a git repository", "Bash", "fatal: not a git repository", false, false],
  ["Exit code 0 on line 2", "Bash", "ok\nExit code 0", false, false],
  ["Error on line 2", "Bash", "ok\nError: later", false, false],
  ["shell cat of a doc starting Error handling", "Bash", "Error handling\n", false, false],
  ["unknown tool, no flag", "", "Error: x", false, false],
];

test("one rule for a failed result", () => {
  for (const [name, tool, text, flagged, want] of CASES) assert.equal(isErrorResult(res(text, flagged), tool), want, name);
});

test("a call that is not a result never fails", () => {
  assert.equal(isErrorResult({ ...res("Error: x"), kind: "tool_call" }, "Bash"), false);
});

test("errorText and errorLine drop Claude Code's wrapper", () => {
  assert.equal(errorText("<tool_use_error>File has not been read yet</tool_use_error>"), "File has not been read yet");
  assert.equal(errorLine("<tool_use_error>\n  Exit code 1\nboom\n</tool_use_error>"), "Exit code 1");
  assert.equal(errorLine(""), "");
});
