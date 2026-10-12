import { relativeTo } from "../core/paths";
import { GITHUB_URL } from "../core/urls";
import type { ProjectMap, Session, Step } from "../shared/contract";
import { errorText, isErrorResult } from "../shared/failed";
import { SUBAGENT_TOOLS } from "../shared/tools";
import { groupFailed } from "./failure-text";
import { CallPairer } from "../shared/pairing";
import { promptTitle } from "../listener/listener.service";

const oneLine = (s: string, n: number) => { const t = s.replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
const code = (s: string) => "`" + s.replace(/`/g, "'") + "`";
/**
 * What the person typed, tags removed. Harness messages logged as user turns are not requests: attached images, skill
 * text, subagent and other sessions' messages, task notifications, the summary that continues a compacted conversation.
 */
const HARNESS = /^\s*(?:<(?:task-notification|agent-message|cross-session-message)\b|Another Claude session sent a message|This session is being continued from a previous conversation)/;
const request = (st: Step): string | undefined => {
  if (HARNESS.test(st.text ?? "")) return undefined;
  const text = promptTitle(st.text ?? "", 2000);
  return text && !/^\[Image[ :#]|^Base directory for this skill:/.test(text) ? text : undefined;
};
const dateOf = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
function duration(from: string, to: string): string {
  const min = Math.round((Date.parse(to) - Date.parse(from)) / 60000);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}`;
}

type Turn = { prompt: string; edits: Step[]; commands: Step[]; delegated: Step[]; reads: number; failed: { call?: Step; result: Step }[]; lastText?: string };

/** What a thread's report says, worked out from its steps and the map (aggregate), before any of it is written. */
type Report = {
  turns: Turn[];
  /** The requests the person made (turns with a prompt). */
  asked: Turn[];
  /** Files changed, with how many edits; and by module (the map's), with the modules' summaries. */
  changed: Map<string, { edits: number }>;
  byModule: Map<string, string[]>;
  moduleSummary: Map<string, string | undefined>;
  /** A file's node on the map (its summary). */
  files: Map<string, { summary?: string }>;
  failedAll: { call?: Step; result: Step }[];
  edits: number;
  commands: number;
  subagentSteps: number;
  /** A path as the report shows it: relative to the project. */
  rel: (p: string) => string;
};

/**
 * A thread as a Markdown report for a review or a pull request: what was asked, the files changed (by module, with
 * their summaries), what failed, then each request with what the agent did. Reads are counted, not listed.
 */
export function threadMarkdown(session: Session, steps: Step[], map: ProjectMap | null): string {
  return render(session, aggregate(session, steps, collect(steps), map));
}

/** The thread's steps in turns: one per request, with what the agent did for it (an edit or a call before the first
 * request opens a turn without a prompt). */
function collect(steps: Step[]): Turn[] {
  const turns: Turn[] = [];
  const pairer = new CallPairer();
  let turn: Turn | undefined;
  const cur = () => (turn ??= (turns.push({ prompt: "", edits: [], commands: [], delegated: [], reads: 0, failed: [] }), turns[turns.length - 1]));
  for (const st of steps) {
    if (st.kind === "prompt" && !st.isSubagent) {
      const text = request(st);
      if (!text) continue;
      turn = { prompt: text, edits: [], commands: [], delegated: [], reads: 0, failed: [] };
      turns.push(turn);
      continue;
    }
    if (st.kind === "edit") { pairer.call(st); cur().edits.push(st); continue; }
    if (st.kind === "tool_call") {
      pairer.call(st);
      if (st.tool === "Bash") cur().commands.push(st);
      else if (SUBAGENT_TOOLS.has(st.tool ?? "")) cur().delegated.push(st);
      else if (st.tool === "Read" || st.tool === "Grep" || st.tool === "Glob") cur().reads++;
      continue;
    }
    if (st.kind === "tool_result") {
      const call = pairer.result(st);
      if (isErrorResult(st, call?.tool)) cur().failed.push({ call, result: st });
      continue;
    }
    if (st.kind === "text" && !st.isSubagent && st.text?.trim()) cur().lastText = st.text;
  }
  return turns;
}

/** The counts and the files changed, by module. */
function aggregate(session: Session, steps: Step[], turns: Turn[], map: ProjectMap | null): Report {
  const root = map?.root ?? session.cwd;
  const rel = (p: string) => (root ? relativeTo(p, root) ?? p : p); // /a/bc is not inside /a/b
  const files = new Map((map?.files ?? []).map((f) => [f.path, f]));
  const main = steps.filter((s) => !s.isSubagent);

  // Files changed, with how many edits.
  const changed = new Map<string, { edits: number }>();
  for (const st of steps) if (st.kind === "edit" && st.filePath) {
    const c = changed.get(st.filePath) ?? { edits: 0 };
    c.edits++;
    changed.set(st.filePath, c);
  }
  const byModule = new Map<string, string[]>();
  for (const p of changed.keys()) {
    const mod = files.get(p)?.module ?? "other files";
    byModule.set(mod, [...(byModule.get(mod) ?? []), p]);
  }
  const moduleSummary = new Map((map?.modules ?? []).map((m) => [m.id, m.summary]));

  return {
    turns, asked: turns.filter((t) => t.prompt), changed, byModule, moduleSummary, files,
    failedAll: turns.flatMap((t) => t.failed),
    edits: steps.filter((s) => s.kind === "edit").length,
    commands: steps.filter((s) => s.kind === "tool_call" && s.tool === "Bash").length,
    subagentSteps: steps.length - main.length,
    rel,
  };
}

/** The report as Markdown: the header and counts, what was asked, files changed, what failed, step by step. */
function render(session: Session, r: Report): string {
  const { turns, asked, changed, byModule, moduleSummary, files, failedAll, edits, commands, subagentSteps, rel } = r;
  const failedCalls = failedAll.length;

  const out: string[] = [];
  out.push(`# ${session.title || "Untitled thread"}`, "");
  out.push(`Recorded with [Rundown](${GITHUB_URL}) · ${dateOf(session.startedAt)}, ${timeOf(session.startedAt)} to ${timeOf(session.lastEventAt)} (${duration(session.startedAt, session.lastEventAt)})`, "");
  out.push([
    `${asked.length} request${asked.length === 1 ? "" : "s"}`,
    `${edits} edit${edits === 1 ? "" : "s"} to ${changed.size} file${changed.size === 1 ? "" : "s"}`,
    `${commands} command${commands === 1 ? "" : "s"}`,
    `${failedCalls} failed tool call${failedCalls === 1 ? "" : "s"}`,
    ...(subagentSteps ? [`${subagentSteps} steps by subagents`] : []),
  ].join(" · "), "");

  if (asked.length) {
    out.push("## What was asked", "");
    asked.forEach((t, i) => out.push(`${i + 1}. ${oneLine(t.prompt, 300)}`));
    out.push("");
  }

  if (changed.size) {
    out.push("## Files changed", "");
    for (const [mod, paths] of [...byModule.entries()].sort((a, b) => b[1].length - a[1].length)) {
      out.push(`### ${code(mod)}`, "");
      const ms = moduleSummary.get(mod);
      if (ms) out.push(ms, "");
      for (const p of paths.sort()) {
        const c = changed.get(p)!;
        const summary = files.get(p)?.summary;
        out.push(`- ${code(rel(p))} · ${c.edits} edit${c.edits === 1 ? "" : "s"}${summary ? ` · ${oneLine(summary, 220)}` : ""}`);
      }
      out.push("");
    }
  }

  if (failedAll.length) {
    out.push("## What failed", "");
    for (const g of groupFailed(failedAll).slice(0, 12)) {
      out.push(`- **${oneLine(g.title, 120)}** (${g.count}×)`);
      out.push(`  ${code(oneLine(g.sample, 160))}`);
    }
    out.push("");
  }

  if (turns.length) {
    out.push("## Step by step", "");
    turns.forEach((t, i) => {
      const head = t.prompt ? oneLine(t.prompt, 120) : "Before the first request";
      out.push(`### ${i + 1}. ${head}`, "");
      for (const e of t.edits) out.push(`- ${e.tool === "Write" ? "Wrote" : "Edited"} ${code(rel(e.filePath ?? "?"))}${e.label ? ` · ${e.label}` : ""}`);
      for (const c of t.commands) {
        const input = c.input as { command?: string; description?: string } | undefined;
        out.push(`- Ran ${code(oneLine(input?.command ?? "", 140))}${input?.description ? ` · ${oneLine(input.description, 100)}` : c.label ? ` · ${c.label}` : ""}`);
      }
      for (const d of t.delegated) {
        const input = d.input as { description?: string } | undefined;
        out.push(`- Delegated to a subagent${input?.description ? `: ${oneLine(input.description, 120)}` : ""}`);
      }
      if (t.reads) out.push(`- Read or searched ${t.reads} time${t.reads === 1 ? "" : "s"}`);
      for (const f of t.failed) {
        const what = f.call?.tool === "Bash" ? oneLine((f.call.input as { command?: string } | undefined)?.command ?? "", 80) : f.call?.filePath ? rel(f.call.filePath) : f.call?.tool ?? "a tool call";
        out.push(`- **Failed:** ${f.call?.tool ?? "tool"} ${code(what)}: ${oneLine(errorText(f.result.text ?? ""), 160)}`);
      }
      if (t.lastText) out.push("", `> ${oneLine(t.lastText, 600)}`);
      out.push("");
    });
  }
  return out.join("\n");
}
