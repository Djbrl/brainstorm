// The step panel's body: one step in full (its diff, text or tool view) and Ask.
import { useEffect, useMemo, useState } from "react";
import { Diff } from "../lib/Diff";
import type { Step } from "@contract";
import { AskBox } from "../ask/AskBox";
import { Markdown } from "../ask/Markdown";
import { FileIcon, Glyph, RiskIcon } from "./Glyph";
import { ToolView } from "./content/ToolView";
import { editorLink, editorName, openInEditor, useEditor } from "../lib/editor";
import { HtmlPreview, isHtml, PAGE_MARKUP, ViewSwitch } from "./content/HtmlPreview";
import { basename, displayLabel, stepFile, stripInjected, timeIn, toolName } from "./format";
import { PromptBody } from "./PromptBody";
import { LinkedLabel } from "../lib/links";

const BIG_DIFF = 400; // lines; above this the diff starts collapsed

/** How worrying each risk flag from the reader is (server/src/reader computeRisk): red, amber, or quiet grey if unknown. */
const RISK_LEVEL: Record<string, "high" | "mid"> = {
  "possible secret": "high", "touches .env": "high", "deleted test": "high",
  "touches auth": "mid", "touches payment": "mid", "large deletion": "mid",
};

/** The dark themes' diff colours (PS2, Dead Space): tints over the panel, the theme's own ink. */
const darkDiff = {
  diffViewerBackground: "transparent",
  diffViewerColor: "var(--ink)",
  addedBackground: "rgba(52,199,89,.14)",
  addedColor: "var(--ink)",
  removedBackground: "rgba(255,69,58,.14)",
  removedColor: "var(--ink)",
  wordAddedBackground: "rgba(52,199,89,.34)",
  wordRemovedBackground: "rgba(255,69,58,.34)",
  addedGutterBackground: "rgba(52,199,89,.2)",
  removedGutterBackground: "rgba(255,69,58,.2)",
  gutterBackground: "transparent",
  gutterColor: "var(--ink-3)",
  codeFoldGutterBackground: "var(--hover)",
  codeFoldBackground: "var(--hover)",
  codeFoldContentColor: "var(--ink-3)",
  emptyLineBackground: "transparent",
};

export const diffStyles = {
  variables: {
    dark: darkDiff,
    light: {
      diffViewerBackground: "#ffffff",
      diffViewerColor: "#1d1d1f",
      addedBackground: "#eaf7ef",
      addedColor: "#1d1d1f",
      removedBackground: "#fdeeee",
      removedColor: "#1d1d1f",
      wordAddedBackground: "#c6ecd4",
      wordRemovedBackground: "#f8cfcf",
      addedGutterBackground: "#dff3e6",
      removedGutterBackground: "#fbe3e3",
      gutterBackground: "#fbfbfd",
      gutterColor: "#a1a1a6",
      codeFoldGutterBackground: "#f4f4f8",
      codeFoldBackground: "#f7f7fa",
      codeFoldContentColor: "#86868b",
      emptyLineBackground: "#ffffff",
    },
  },
  contentText: { fontFamily: "var(--font-mono)", fontSize: "12.5px", lineHeight: "1.55 !important" },
  lineNumber: { fontSize: "11.5px" },
  gutter: { minWidth: "28px", width: "28px", padding: "0 4px" },
  // The viewer sets minWidth 1000px (unset only on narrow screens), so in the 440px panel every line scrolled sideways.
  // Fill the panel instead; long lines wrap (follow.css, .sd-diff pre).
  diffContainer: { borderRadius: "10px", overflow: "hidden", minWidth: 0 },
};

function inputOf(s: Step): Record<string, unknown> {
  return s.input && typeof s.input === "object" ? (s.input as Record<string, unknown>) : {};
}

/** Before/after for an edit, from the diff or from the raw tool input. */
export function editPair(s: Step): { before: string; after: string } | null {
  if (s.diff) return s.diff;
  const i = inputOf(s);
  if (typeof i.old_string === "string" || typeof i.new_string === "string") return { before: String(i.old_string ?? ""), after: String(i.new_string ?? "") };
  if (typeof i.content === "string") return { before: "", after: i.content };
  if (Array.isArray(i.edits)) {
    const edits = i.edits as { old_string?: string; new_string?: string }[];
    return { before: edits.map((e) => e.old_string ?? "").join("\n\n"), after: edits.map((e) => e.new_string ?? "").join("\n\n") };
  }
  return null;
}

function EditBody({ step }: { step: Step }) {
  const pair = useMemo(() => editPair(step), [step]);
  const lines = pair ? pair.before.split("\n").length + pair.after.split("\n").length : 0;
  const [open, setOpen] = useState(lines <= BIG_DIFF);
  useEffect(() => setOpen(lines <= BIG_DIFF), [step.id, lines]);
  // A whole HTML file written: shown as the page first, the lines it wrote a click away.
  const page = !!pair && !pair.before && isHtml(step.filePath) && PAGE_MARKUP.test(pair.after);
  const [view, setView] = useState<"page" | "code">("page");
  if (!pair) return <p className="sd-muted">No diff recorded for this edit.</p>;
  const added = pair.after ? pair.after.split("\n").length : 0;
  const removed = pair.before ? pair.before.split("\n").length : 0;
  return (
    <div className="sd-diff">
      <div className="sd-diffstat"><span className="add">+{added}</span><span className="del">−{removed}</span>{page && <ViewSwitch view={view} onView={setView} />}</div>
      {page && view === "page" ? <HtmlPreview html={pair.after} /> : open ? (
        <div className="sd-diff-scroll"><Diff oldValue={pair.before} newValue={pair.after} splitView={false} showDiffOnly extraLinesSurroundingDiff={2} hideSummary styles={diffStyles} path={step.filePath} /></div>
      ) : (
        <button className="sd-expand" onClick={() => setOpen(true)}>Large change, {lines} lines. Show the diff</button>
      )}
    </div>
  );
}

/** The step's file, opened in your editor (Settings, "Open files in"); its name in the body shows it on the map. */
function OpenFile({ path }: { path: string }) {
  const editor = useEditor();
  const link = editorLink(editor, path);
  const title = `${path}\nOpen in ${editorName(editor)}`;
  return link
    ? <a className="chip" href={link} title={title}><FileIcon />{basename(path)}</a>
    : <button className="chip" onClick={() => openInEditor(editor, path)} title={title}><FileIcon />{basename(path)}</button>;
}

/** One step in full. No close button: a click outside the panel, Esc or Back closes it (see StepPanel). */
export function StepDetail({ step, result }: { step: Step; result?: Step; onClose?: () => void }) {
  const file = stepFile(step);
  const label = displayLabel(step);

  return (
    <aside className="sd" key={step.id}>
      <div className="sd-scroll">
        <header className="sd-head">
          <div className={`sd-glyph k-${step.kind}`}><Glyph kind={step.kind} tool={step.tool} size={14} /></div>
          <h2 className="sd-title" title={label}>{step.kind !== "prompt" ? <LinkedLabel text={label} links max={32} /> : stripInjected(step.text) ? "Your prompt" : label}</h2>
        </header>
        <div className="sd-meta">
          <span>{timeIn(step.ts, false, { seconds: true })}</span>
          {step.tool && step.kind !== "edit" && <><span className="sep">·</span><span>{toolName(step.tool)}</span></>}
          {step.isSubagent && <><span className="sep">·</span><span>Subagent</span></>}
          {file && <OpenFile path={file} />}
        </div>
        {step.risk && step.risk.length > 0 && (
          <div className="sd-risks">
            {step.risk.map((r) => <span key={r} className={`sd-risk ${RISK_LEVEL[r] ?? ""}`}><RiskIcon />{r.charAt(0).toUpperCase() + r.slice(1)}</span>)}
          </div>
        )}

        <div className="sd-body">
          {step.kind === "edit" ? <EditBody step={step} />
            : step.kind === "tool_call" ? <ToolView step={step} result={result} />
            : step.kind === "prompt" && step.text ? <div className="sd-text"><PromptBody text={step.text} /></div>
            : step.text ? <div className={`sd-text ${step.kind === "thinking" ? "thinking" : ""}`}><Markdown text={step.text} /></div>
            : null}
        </div>

        <div className="sd-ask">
          <h3 className="sd-ask-title">Ask about this step</h3>
          <AskBox context={{ stepId: step.id }} placeholder="Why did the agent do this?" />
        </div>
      </div>
    </aside>
  );
}
