// One rule for "this tool call failed", for the server (Track, agents, cowork, the Markdown export) and the web.
// The stored is_error flag is trusted. Text patterns are only a fallback for the tools whose own result text is
// known to carry the failure: shell commands, file edits and browser navigation. Any other tool's output (a web
// page, a search result, a file) is content, so "Error handling in Go" or "pets are not allowed" is not a failure.
import type { Step } from "./contract";

const SHELL = new Set(["Bash", "BashOutput", "exec_command", "shell", "local_shell", "KillShell"]);
const EDIT = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit", "apply_patch"]);

const SHELL_ERROR = /^\s*(<tool_use_error>|error:|exit code [1-9]\d*|permission to use|.{0,80}\b(denied by|blocked by) (a |the )?(hook|policy))/i;
const EDIT_ERROR = /^\s*(<tool_use_error>|error:)|file has not been read yet|string to replace not found|permission to use/i;
const NAVIGATION_ERROR = /^\s*(navigation to \S+ was denied|navigation to this domain is not allowed|<tool_use_error>)/i;

/** `tool`: the tool the result answers (a result step doesn't carry it); without it only the stored flag counts. */
export function isErrorResult(step: Step, tool?: string): boolean {
  if (step.kind !== "tool_result") return false;
  if ((step.input as { isError?: boolean } | undefined)?.isError) return true;
  const t = tool ?? step.tool ?? "";
  const head = (step.text ?? "").slice(0, 300);
  if (SHELL.has(t)) return SHELL_ERROR.test(head);
  if (EDIT.has(t)) return EDIT_ERROR.test(head);
  if (/^mcp__.*(browser|chrome)/i.test(t) && /(^|__)navigate/.test(t)) return NAVIGATION_ERROR.test(head);
  return false;
}
