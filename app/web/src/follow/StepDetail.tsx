// Owner: C. Right pane: full detail of one step + AskBox.
import { useEffect, useMemo, useState } from "react";
import { Diff } from "../lib/Diff";
import type { Step } from "@contract";
import { AskBox } from "../ask/AskBox";
import { Markdown } from "../ask/Markdown";
import { useNav } from "../lib/nav";
import { CloseIcon, FileIcon, Glyph, RiskIcon } from "./Glyph";
import { basename, clockTime, displayLabel, resultText, stepFile, toolName, unwrapPastes } from "./format";

const BIG_DIFF = 400; // lines; above this the diff starts collapsed

const diffStyles = {
  variables: {
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
  gutter: { minWidth: "36px", padding: "0 6px" },
  diffContainer: { borderRadius: "10px", overflow: "hidden" },
};

function inputOf(s: Step): Record<string, unknown> {
  return s.input && typeof s.input === "object" ? (s.input as Record<string, unknown>) : {};
}

/** Before/after for an edit, from the diff or from the raw tool input. */
function editPair(s: Step): { before: string; after: string } | null {
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
  if (!pair) return <p className="sd-muted">No diff recorded for this edit.</p>;
  const added = pair.after ? pair.after.split("\n").length : 0;
  const removed = pair.before ? pair.before.split("\n").length : 0;
  return (
    <div className="sd-diff">
      <div className="sd-diffstat"><span className="add">+{added}</span><span className="del">−{removed}</span></div>
      {open ? (
        <div className="sd-diff-scroll"><Diff oldValue={pair.before} newValue={pair.after} splitView={false} showDiffOnly extraLinesSurroundingDiff={2} hideSummary styles={diffStyles} /></div>
      ) : (
        <button className="sd-expand" onClick={() => setOpen(true)}>Large change, {lines} lines. Show the diff</button>
      )}
    </div>
  );
}

function ToolBody({ step, result }: { step: Step; result?: Step }) {
  const i = inputOf(step);
  const command = typeof i.command === "string" ? i.command : null;
  const out = result ? resultText(result) : "";
  const [full, setFull] = useState(false);
  useEffect(() => setFull(false), [step.id]);
  const shown = full || out.length <= 2400 ? out : `${out.slice(0, 2400)}…`;
  return (
    <>
      {command ? (
        <pre className="sd-code sd-shell"><span className="prompt">$</span> {command}</pre>
      ) : step.input != null ? (
        <pre className="sd-code">{typeof step.input === "string" ? step.input : JSON.stringify(step.input, null, 2)}</pre>
      ) : null}
      {out.trim() && (
        <div className="sd-output">
          <div className="sd-subhead">Output</div>
          <pre className="sd-code sd-out">{shown}</pre>
          {out.length > 2400 && !full && <button className="sd-link" onClick={() => setFull(true)}>Show all output</button>}
        </div>
      )}
    </>
  );
}

export function StepDetail({ step, result, onClose }: { step: Step; result?: Step; onClose: () => void }) {
  const { openFile } = useNav();
  const file = stepFile(step);
  const label = displayLabel(step);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !(e.target instanceof HTMLInputElement)) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <aside className="sd" key={step.id}>
      <div className="sd-scroll">
        <header className="sd-head">
          <div className={`sd-glyph k-${step.kind}`}><Glyph kind={step.kind} tool={step.tool} size={18} /></div>
          <button className="sd-close" onClick={onClose} aria-label="Close"><CloseIcon /></button>
        </header>
        <h2 className="sd-title">{step.kind === "prompt" ? "Your prompt" : label}</h2>
        <div className="sd-meta">
          <span>{clockTime(step.ts)}</span>
          {step.tool && step.kind !== "edit" && <><span className="sep">·</span><span>{toolName(step.tool)}</span></>}
          {step.isSubagent && <><span className="sep">·</span><span>Subagent</span></>}
          {file && (
            <button className="chip" onClick={() => openFile(file)} title={`${file}\nOpen on the map`}>
              <FileIcon />{basename(file)}
            </button>
          )}
        </div>
        {step.risk && step.risk.length > 0 && (
          <div className="sd-risks">{step.risk.map((r) => <span key={r} className="risk"><RiskIcon />{r}</span>)}</div>
        )}

        <div className="sd-body">
          {step.kind === "edit" ? <EditBody step={step} />
            : step.kind === "tool_call" ? <ToolBody step={step} result={result} />
            : step.text ? <div className={`sd-text ${step.kind === "thinking" ? "thinking" : ""}`}><Markdown text={unwrapPastes(step.text)} /></div>
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
