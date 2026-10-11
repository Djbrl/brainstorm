import type { Step } from "../shared/contract";

/** A failed result's error, reduced to what repeats: tags, paths, ids, numbers and quoted strings stripped. */
export function normalizeError(text: string): string {
  const lines = text.replace(/<\/?tool_use_error>/g, "").split("\n").map((l) => l.trim()).filter(Boolean);
  // For shell failures the first line is just "Exit code N": use the most error-like line of the output instead.
  let s = lines[0] ?? "";
  if (/^exit code/i.test(s)) {
    const hit = lines.slice(1).find((l) => /error|not found|no such|denied|cannot|can't|failed|fatal|killed|exceeded|refused|timed? ?out|invalid|unknown/i.test(l));
    s = hit ? hit.replace(/^.*?(\w*error\w*[:\s])/i, "$1") : "non-zero exit";
  }
  s = s
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
    .replace(/(~|\.{1,2})?\/[\w.@+\-/]+/g, "<path>")
    .replace(/"[^"]*"|'[^']*'|`[^`]*`/g, "\"…\"")
    .replace(/\d+(\.\d+)?/g, "N")
    .replace(/\s+/g, " ")
    .trim();
  return s.slice(0, 80) || "unknown error";
}

/** The failed results of one thread grouped by tool and normalized error, most frequent first. */
export function groupFailed(failed: { call?: Step; result: Step }[]): { title: string; count: number; sample: string }[] {
  const groups = new Map<string, { title: string; count: number; sample: string }>();
  for (const { call, result } of failed) {
    const tool = call?.tool ?? (call?.kind === "edit" ? "Edit" : "tool");
    const error = normalizeError(result.text ?? "");
    const key = `${tool} · ${error}`;
    const g = groups.get(key);
    if (g) g.count++;
    else groups.set(key, { title: `${tool}: ${error}`, count: 1, sample: (result.text ?? "").replace(/<\/?tool_use_error>/g, "").trim().split("\n")[0] ?? error });
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}
