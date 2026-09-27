// Owner: C. Recurring failures, grouped and prioritized, with evidence steps.
import { useEffect, useState } from "react";
import type { FailureEvidence, FailureGroup } from "@contract";
import { clock, useLive } from "../lib/live";
import { useNav } from "../lib/nav";
import { basename, clockTime, relTime, toolName } from "../follow/format";
import "./failures.css";

function useNow(ms = 15000) {
  const [now, setNow] = useState(clock());
  useEffect(() => { const t = setInterval(() => setNow(clock()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function Evidence({ ev }: { ev: FailureEvidence }) {
  const { openStep } = useNav();
  return (
    <button className="fx-ev" onClick={() => openStep(ev.sessionId, ev.stepId)} title="Open this step in Follow">
      <div className="fx-ev-meta">
        <span>{clockTime(ev.ts)}</span>
        <span className="sep">·</span>
        <span>{toolName(ev.tool)}</span>
        {ev.filePath && <span className="fx-file">{basename(ev.filePath)}</span>}
        <span className="fx-ev-open">Open step
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M6 3.5L10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
      </div>
      {ev.input && <div className="fx-ev-input">{ev.input}</div>}
      <div className="fx-ev-error">{ev.error}</div>
    </button>
  );
}

function GroupRow({ g, rank, maxPriority, open, onToggle, now }: { g: FailureGroup; rank: number; maxPriority: number; open: boolean; onToggle: () => void; now: number }) {
  const level = rank < 3 ? "high" : rank < 6 ? "mid" : "low";
  const pct = Math.max(8, Math.round((g.priority / (maxPriority || 1)) * 100));
  return (
    <div className={`fx-group ${level} ${open ? "open" : ""}`}>
      <button className="fx-row" onClick={onToggle} aria-expanded={open}>
        <div className="fx-rank">
          <span className="fx-rank-n">{rank + 1}</span>
          <span className="fx-bar" title={`Priority ${g.priority.toFixed(1)}`}><span style={{ width: `${pct}%` }} /></span>
        </div>
        <div className="fx-main">
          <div className="fx-title">{g.title}</div>
          {g.advice && <div className="fx-advice">{g.advice}</div>}
          <div className="fx-meta">
            <span className="fx-tool">{toolName(g.tool)}</span>
            <span>{plural(g.sessions.length, "session")}</span>
            <span className="sep">·</span>
            <span>last seen {relTime(g.lastSeen, now)}</span>
            {g.retried && <span className="fx-mark retried">retried</span>}
            {g.touchesEdits && <span className="fx-mark edits">touches edits</span>}
          </div>
        </div>
        <div className="fx-count"><span className="n">{g.count}</span><span className="x">{g.count === 1 ? "time" : "times"}</span></div>
        <svg className="fx-chev" width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <div className="fx-evidence">
          {g.evidence.map((ev) => <Evidence key={ev.stepId} ev={ev} />)}
          {g.count > g.evidence.length && <div className="fx-more">and {g.count - g.evidence.length} more like these</div>}
        </div>
      )}
    </div>
  );
}

export function FailuresView() {
  const { state } = useLive();
  const groups = state.failures;
  const now = useNow();
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => { if (open === null && groups[0]) setOpen(groups[0].key); }, [groups, open]);

  const total = groups.reduce((n, g) => n + g.count, 0);
  const sessions = new Set(groups.flatMap((g) => g.sessions)).size;
  const maxPriority = Math.max(0, ...groups.map((g) => g.priority));

  if (groups.length === 0) {
    return (
      <div className="fx-root">
        <div className="fx-empty">
          <span className="fx-empty-icon">
            <svg width="22" height="22" viewBox="0 0 16 16" fill="none"><path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
          <p className="fx-empty-title">No failures found</p>
          <p>Every tool call in the watched sessions succeeded. When one fails, it shows up here, grouped with the ones like it and ranked by what needs attention first.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fx-root">
      <div className="fx-inner">
        <header className="fx-head">
          <h1 className="fx-h1">Recurring failures</h1>
          <p className="fx-sub">
            <strong>{plural(total, "failure")}</strong> in {plural(groups.length, "group")} across {plural(sessions, "session")}, most urgent first.
          </p>
        </header>
        <div className="fx-list">
          {groups.map((g, i) => (
            <GroupRow key={g.key} g={g} rank={i} maxPriority={maxPriority} now={now} open={open === g.key} onToggle={() => setOpen((k) => (k === g.key ? "" : g.key))} />
          ))}
        </div>
      </div>
    </div>
  );
}
