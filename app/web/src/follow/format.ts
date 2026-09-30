// Owner: C. Display helpers for steps and sessions.
import { clock } from "../lib/live";
import type { Step } from "@contract";
import { CallPairer } from "../lib/pairing";

export const basename = (p?: string) => (p ? p.split(/[\\/]/).filter(Boolean).pop() ?? p : "");

export function relTime(iso: string, now = clock()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export const clockTime = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

/** Drop blocks Claude Code injects into the log (e.g. `<system-reminder>…</system-reminder>`); they aren't what the person or agent wrote. */
export const stripInjected = (t = "") =>
  t.replace(/<(system-reminder|command-[a-z-]+|local-command-[a-z-]+|task-notification)>[\s\S]*?(<\/\1>|$)/g, " ")
    .replace(/^\[Image[:#][^\]]*\]\s*$/gm, "") // Claude Code's note on an image a tool returned
    .trim();

const firstLine = (t = "", max = 140) => {
  const line = stripInjected(t).replace(/```[\s\S]*?```/g, " ").replace(/\*\*|__|`|^#+\s*/gm, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
};

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** A readable fallback while the Nemotron label is on its way. */
export function fallbackLabel(s: Step): string {
  const input = obj(s.input);
  switch (s.kind) {
    case "prompt": return firstLine(s.text, 400) || "Prompt";
    case "text": return firstLine(s.text, 180) || "Reply";
    case "thinking": return s.text ? `Thinking: ${firstLine(s.text, 120)}` : "Thinking";
    case "edit": {
      const f = basename(s.filePath ?? str(input.file_path));
      if (s.tool === "Write") return `Write ${f}`;
      return f ? `Edit ${f}` : "Edit a file";
    }
    case "tool_result": return "Result";
    case "tool_call": {
      const t = s.tool ?? "Tool";
      const file = basename(s.filePath ?? str(input.file_path) ?? str(input.path));
      switch (t) {
        case "Bash": return str(input.description) || `Run ${firstLine(str(input.command), 80)}`;
        case "Read": return file ? `Read ${file}` : "Read a file";
        case "Grep": return `Search for “${firstLine(str(input.pattern), 60)}”`;
        case "Glob": return `Find files ${firstLine(str(input.pattern), 60)}`;
        case "Task": case "Agent": return str(input.description) ? `Delegate: ${str(input.description)}` : "Start a subagent";
        case "WebFetch": return `Fetch ${firstLine(str(input.url), 70)}`;
        case "WebSearch": return `Search the web for “${firstLine(str(input.query), 60)}”`;
        case "TodoWrite": return "Update the plan";
        case "ToolSearch": return "Look up tools";
        default: return file ? `${t} ${file}` : t.replace(/^mcp__.+?__/, "").replace(/_/g, " ");
      }
    }
  }
}

/** Mirrors the reader's instant heuristic label, so we can keep our richer fallback until Nemotron's label lands. */
function readerHeuristic(s: Step): string | undefined {
  if (s.kind === "edit") return `Edit ${s.filePath ? s.filePath.split("/").pop() : "file"}`;
  if (s.kind === "tool_call") {
    if (s.tool === "Bash") { const cmd = str(obj(s.input).command); return cmd ? `Run: ${cmd.slice(0, 40)}` : "Run: shell command"; }
    if (s.filePath) return `${s.tool ?? "Tool"} ${s.filePath.split("/").pop()}`;
    return `Run: ${s.tool ?? "tool"}`;
  }
  if (s.kind === "prompt") return (s.text ?? "").trim().split(/\s+/).slice(0, 8).join(" ") || "Prompt";
  return undefined;
}

/** The model-written label, or undefined while only the heuristic one exists. */
export function realLabel(s: Step): string | undefined {
  const l = s.label?.trim();
  if (!l || l === readerHeuristic(s)) return undefined;
  return l;
}

export const displayLabel = (s: Step) => realLabel(s) || fallbackLabel(s);

export function stepFile(s: Step): string | undefined {
  if (s.filePath) return s.filePath;
  const input = obj(s.input);
  return str(input.file_path) || str(input.notebook_path) || undefined;
}

/** Stringify a tool_result's text for the detail pane. */
export function resultText(s: Step): string {
  if (s.text) return s.text;
  if (s.input == null) return "";
  return typeof s.input === "string" ? s.input : JSON.stringify(s.input, null, 2);
}

/** Pair tool_call/edit steps with their tool_result: call id → result. */
export function pairResults(steps: Step[]): Map<string, Step> {
  const out = new Map<string, Step>();
  const pairer = new CallPairer();
  for (const s of steps) {
    if (s.kind === "tool_call" || s.kind === "edit") pairer.call(s);
    else if (s.kind === "tool_result") { const call = pairer.result(s); if (call) out.set(call.id, s); }
    else if (s.kind === "prompt" && !s.isSubagent) pairer.clear();
  }
  return out;
}

export const isVisible = (s: Step) => s.kind !== "tool_result" && !(s.kind === "thinking" && !s.text?.trim()) && !(s.kind === "text" && !s.text?.trim() && !s.label);

export const toolName = (t?: string) => (t ?? "").replace(/^mcp__.+?__/, "").replace(/_/g, " ");
