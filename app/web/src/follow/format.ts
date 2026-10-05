// Display helpers for steps and sessions.
import { clock } from "../lib/live";
import type { Step } from "@contract";
import { CallPairer } from "../lib/pairing";
import { commandLabel, toolLabel } from "@shared/labels";

export const basename = (p?: string) => (p ? p.split(/[\\/]/).filter(Boolean).pop() ?? p : "");

// ---- Times: one way to say when, everywhere ----

const toMs = (t: string | number | Date) => (typeof t === "number" ? t : typeof t === "string" ? Date.parse(t) : t.getTime());
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const pad = (n: number) => String(n).padStart(2, "0");

/** "14:05" (24-hour, local time); "14:05:09" with seconds. */
export function hhmm(t: string | number | Date, seconds = false): string {
  const d = new Date(toMs(t));
  if (Number.isNaN(d.getTime())) return "";
  return `${pad(d.getHours())}:${pad(d.getMinutes())}${seconds ? `:${pad(d.getSeconds())}` : ""}`;
}

/** "Mon 2 Oct", with the year only when it isn't this year ("Thu 2 Oct 2025"). */
export function dayLabel(t: string | number | Date, now = clock()): string {
  const d = new Date(toMs(t));
  if (Number.isNaN(d.getTime())) return "";
  const day = `${d.toLocaleDateString("en-GB", { weekday: "short" })} ${d.getDate()} ${d.toLocaleDateString("en-GB", { month: "short" })}`;
  return d.getFullYear() === new Date(now).getFullYear() ? day : `${day} ${d.getFullYear()}`;
}

/**
 * How long ago, the one way the app says it: "just now" (under a minute), "5 min ago", "3 h ago" (under a day),
 * "yesterday 14:05", then "Mon 2 Oct" (the year only when it isn't this year).
 */
export function relTime(iso: string | number | Date | undefined, now = clock()): string {
  if (iso === undefined) return "";
  const t = toMs(iso);
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (dayKey(new Date(t)) === dayKey(yesterday)) return `yesterday ${hhmm(t)}`;
  return dayLabel(t, now);
}

/**
 * A clock time inside a thread (a chapter, a step, a stop): "14:05", or "Mon 2 Oct · 14:05" when the thread runs
 * over more than one day (`multiDay`) or the time isn't today.
 */
export function timeIn(iso: string, multiDay = false, opts: { seconds?: boolean; now?: number } = {}): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const now = opts.now ?? clock();
  const time = hhmm(t, opts.seconds);
  return multiDay || dayKey(new Date(t)) !== dayKey(new Date(now)) ? `${dayLabel(t, now)} · ${time}` : time;
}

const PASTE = /<pasted_content\b[^>]*>([\s\S]*?)(<\/pasted_content>|$)/g;

/** Text the person pasted into a prompt arrives wrapped in `<pasted_content id="…">`. For a one-line label, what they
 * typed around it says more ("help me draft it?"); with nothing typed around it, the pasted text itself. */
export const withoutPastes = (t = "") => {
  const typed = t.replace(PASTE, " ").trim();
  return typed || t.replace(PASTE, "$1");
};
/** The full prompt: pasted text stays, its wrapper tag goes. */
export const unwrapPastes = (t = "") => t.replace(PASTE, "\n$1\n");

/** Drop blocks Claude Code injects into the log (e.g. `<system-reminder>…</system-reminder>`); they aren't what the person or agent wrote. */
export const stripInjected = (t = "") =>
  withoutPastes(t).replace(/<bash-input>([\s\S]*?)(<\/bash-input>|$)/g, "$ $1") // a command you ran with ! in Claude Code
    .replace(/<(bash-stdout|bash-stderr)>[\s\S]*?(<\/\1>|$)/g, " ")
    .replace(/<(system-reminder|command-[a-z-]+|local-command-[a-z-]+|task-notification)>[\s\S]*?(<\/\1>|$)/g, " ")
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
        case "Bash": return str(input.description) || commandLabel(str(input.command));
        case "Read": return file ? `Read ${file}` : "Read a file";
        case "Grep": return `Search for “${firstLine(str(input.pattern), 60)}”`;
        case "Glob": return `Find files ${firstLine(str(input.pattern), 60)}`;
        case "Task": case "Agent": return str(input.description) ? `Delegate: ${str(input.description)}` : "Start a subagent";
        case "WebFetch": return `Fetch ${firstLine(str(input.url), 70)}`;
        case "WebSearch": return `Search the web for “${firstLine(str(input.query), 60)}”`;
        case "TodoWrite": return "Update the plan";
        case "ToolSearch": return "Look up tools";
        default: return file ? `${t} ${file}` : toolLabel(t, input);
      }
    }
  }
}

/** Mirrors the reader's instant heuristic label, so we can keep our richer fallback until Nemotron's label lands. */
function readerHeuristic(s: Step): string | undefined {
  if (s.kind === "edit") return `Edit ${s.filePath ? s.filePath.split("/").pop() : "file"}`;
  if (s.kind === "tool_call") {
    if (s.tool === "Bash") { const cmd = str(obj(s.input).command); return cmd ? `Run: ${cmd.replace(/\s+/g, " ").trim().slice(0, 40)}` : "Run: shell command"; }
    if (s.filePath) return `${s.tool ?? "Tool"} ${s.filePath.split("/").pop()}`;
    return `Run: ${s.tool ?? "tool"}`;
  }
  if (s.kind === "prompt") return (s.text ?? "").trim().split(/\s+/).slice(0, 8).join(" ") || "Prompt";
  return undefined;
}

/** The model-written label, or undefined while only the heuristic one exists. */
export function realLabel(s: Step): string | undefined {
  const l = s.label?.trim();
  // Any "Run: …" on a command is the reader's placeholder, whichever version of it wrote the label.
  if (!l || l === readerHeuristic(s) || (s.tool === "Bash" && l.startsWith("Run: "))) return undefined;
  return l;
}

export const displayLabel = (s: Step) => realLabel(s) || fallbackLabel(s);

export function stepFile(s: Step): string | undefined {
  if (s.filePath) return s.filePath;
  const input = obj(s.input);
  return str(input.file_path) || str(input.notebook_path) || undefined;
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
