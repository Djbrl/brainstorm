// Owner: C. Sessions list + live timeline of steps. Click a step → diff + AskBox.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Session, Step } from "@contract";
import { clock, useLive } from "../lib/live";
import { useNav } from "../lib/nav";
import { FileIcon, Glyph, RiskIcon } from "./Glyph";
import { StepDetail } from "./StepDetail";
import { ReplayOnMapButton } from "../map/replay/ReplayButton";
import { basename, clockTime, displayLabel, isVisible, pairResults, realLabel, relTime, stepFile } from "./format";
import { isFailedResult } from "../lib/thread";
import "./follow.css";

const PAGE = 300;

function useNow(ms = 15000) {
  const [now, setNow] = useState(clock());
  useEffect(() => { const t = setInterval(() => setNow(clock()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

function SessionList({ sessions, selected, onSelect }: { sessions: Session[]; selected: string | null; onSelect: (id: string) => void }) {
  const now = useNow();
  return (
    <nav className="fl-sessions">
      <h2 className="fl-sessions-title">Sessions</h2>
      <div className="fl-sessions-list">
        {sessions.map((s) => (
          <button key={s.id} className={`fl-session ${s.id === selected ? "on" : ""}`} onClick={() => onSelect(s.id)}>
            <div className="fl-session-title">{s.title || "Untitled session"}</div>
            <div className="fl-session-meta">
              {s.status === "running" && <span className="fl-live" />}
              {s.cwd && <><span className="fl-session-cwd">{basename(s.cwd) || s.cwd}</span><span className="sep">·</span></>}
              <span>{s.status === "running" ? "running" : relTime(s.lastEventAt, now)}</span>
            </div>
          </button>
        ))}
      </div>
    </nav>
  );
}

/** The first line of a failed result, without the harness wrapper. */
const errorLine = (r: Step) => (r.text ?? "").replace(/<\/?tool_use_error>/g, "").trim().split("\n")[0].slice(0, 220);

function StepRow({ step, selected, fresh, flash, onSelect, error }: { step: Step; selected: boolean; fresh: boolean; flash?: boolean; onSelect: (s: Step) => void; error?: string }) {
  const { openFile } = useNav();
  const file = stepFile(step);
  const label = displayLabel(step);
  const labeled = !!realLabel(step);
  const brief = step.kind === "prompt" && step.isSubagent; // lead agent's brief to a subagent
  const cls = ["tl-row", brief ? "k-brief" : `k-${step.kind}`, step.isSubagent && "sub", selected && "on", fresh && "fresh", flash && "flash", error !== undefined && "failed"].filter(Boolean).join(" ");

  // A subagent's "prompt" is the lead agent's brief, not the human: render it as a normal step.
  if (step.kind === "prompt" && !step.isSubagent) {
    return (
      <div className={cls} data-step-id={step.id} onClick={() => onSelect(step)}>
        <div className="tl-glyph"><Glyph kind="prompt" size={17} /></div>
        <div className="tl-body">
          <div className="tl-prompt">{step.text?.trim() || label}</div>
          <div className="tl-meta"><span>You</span><span className="sep">·</span><span>{clockTime(step.ts)}</span></div>
        </div>
      </div>
    );
  }

  return (
    <div className={cls} data-step-id={step.id} onClick={() => onSelect(step)}>
      <div className="tl-glyph">{brief ? <Glyph kind="tool_call" tool="Agent" /> : <Glyph kind={step.kind} tool={step.tool} />}</div>
      <div className="tl-body">
        <div className={`tl-label ${labeled ? "has" : "pending"}`} key={labeled ? "l" : "f"}>{label}</div>
        <div className="tl-meta">
          <span>{clockTime(step.ts)}</span>
          {step.isSubagent && <><span className="sep">·</span><span>subagent</span></>}
          {file && (
            <button className="chip" onClick={(e) => { e.stopPropagation(); openFile(file); }} title={`${file}\nOpen on the map`}>
              <FileIcon />{basename(file)}
            </button>
          )}
          {step.risk?.map((r) => <span key={r} className="risk"><RiskIcon />{r}</span>)}
          {error !== undefined && <span className="tl-failed">failed</span>}
        </div>
        {error && <div className="tl-error">{error}</div>}
      </div>
    </div>
  );
}

function Timeline({ session, steps, selectedId, onSelect, reveal }: { session: Session; steps: Step[] | undefined; selectedId: string | null; onSelect: (s: Step) => void; reveal?: { id: string; n: number } | null }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const initialIds = useRef<Set<string> | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const visible = useMemo(() => (steps ?? []).filter(isVisible), [steps]);
  const shown = visible.length > limit ? visible.slice(visible.length - limit) : visible;
  const edits = useMemo(() => visible.filter((s) => s.kind === "edit").length, [visible]);
  // Failed calls show in red with the first line of the error: the quickest way to see where the agent got stuck.
  const errors = useMemo(() => {
    const m = new Map<string, string>();
    for (const [callId, r] of pairResults(steps ?? [])) if (isFailedResult(r)) m.set(callId, errorLine(r));
    return m;
  }, [steps]);
  const now = useNow();

  // Reset per session.
  useEffect(() => { initialIds.current = null; atBottom.current = true; setLimit(PAGE); }, [session.id]);
  if (steps && !initialIds.current) initialIds.current = new Set(steps.map((s) => s.id));

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && atBottom.current) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [visible.length]);

  // First paint of a session: jump, don't glide.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && steps) el.scrollTop = el.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, !!steps]);

  // Reveal a focused step (from Failures): page it in, scroll to it, flash it.
  const [flashId, setFlashId] = useState<string | null>(null);
  const handled = useRef(0);
  useEffect(() => { if (!flashId) return; const t = setTimeout(() => setFlashId(null), 2000); return () => clearTimeout(t); }, [flashId]);
  useEffect(() => {
    if (!reveal || reveal.n === handled.current) return;
    const idx = visible.findIndex((s) => s.id === reveal.id);
    if (idx === -1) return;
    if (idx < visible.length - limit) { setLimit(visible.length - idx + 20); return; }
    atBottom.current = false;
    const raf = requestAnimationFrame(() => {
      scrollRef.current?.querySelector(`[data-step-id="${CSS.escape(reveal.id)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
      handled.current = reveal.n;
      setFlashId(reveal.id);
    });
    return () => cancelAnimationFrame(raf);
  }, [reveal, visible, limit]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (el) atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  return (
    <section className="fl-timeline">
      <header className="tl-head">
        <h1 className="tl-title">{session.title || "Untitled session"}</h1>
        <div className="tl-sub">
          {session.status === "running" ? <span className="tl-running"><span className="fl-live" />Live</span> : <span>Last active {relTime(session.lastEventAt, now)}</span>}
          {session.cwd && <><span className="sep">·</span><span className="tl-cwd" title={session.cwd}>{session.cwd}</span></>}
          {steps && <><span className="sep">·</span><span>{visible.length} steps, {edits} edits</span></>}
        </div>
        {steps && steps.length > 0 && <ReplayOnMapButton sessionId={session.id} stepId={selectedId} />}
      </header>
      <div className="tl-scroll" ref={scrollRef} onScroll={onScroll}>
        {!steps ? (
          <div className="tl-list">
            {Array.from({ length: 7 }, (_, i) => (
              <div key={i} className="tl-skel" style={{ animationDelay: `${i * 80}ms` }}><span className="dotph" /><span className="bar" style={{ width: `${40 + ((i * 37) % 45)}%` }} /></div>
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="fl-empty small"><p className="fl-empty-title">Nothing yet</p><p>Steps appear here the moment the agent acts.</p></div>
        ) : (
          <div className="tl-list">
            {visible.length > shown.length && (
              <button className="tl-more" onClick={() => setLimit((l) => l + PAGE)}>Show {Math.min(PAGE, visible.length - shown.length)} earlier steps</button>
            )}
            {shown.map((s) => (
              <StepRow key={s.id} step={s} selected={s.id === selectedId} fresh={!initialIds.current?.has(s.id)} flash={s.id === flashId} onSelect={onSelect} error={errors.get(s.id)} />
            ))}
            {session.status === "running" && <div className="tl-tail"><span className="tl-pulse" />Working</div>}
          </div>
        )}
      </div>
    </section>
  );
}

export function FollowView() {
  const { state, loadSteps } = useLive();
  const { sessionId, setSessionId, focusStep, setFocusStep } = useNav();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reveal, setReveal] = useState<{ id: string; n: number } | null>(null);
  const retried = useRef<string | null>(null);

  // Auto-select the most recent running session (sessions are sorted newest first).
  useEffect(() => {
    if (sessionId && state.sessions.some((s) => s.id === sessionId)) return;
    const pick = state.sessions.find((s) => s.status === "running") ?? state.sessions[0];
    if (pick) setSessionId(pick.id);
  }, [state.sessions, sessionId, setSessionId]);

  useEffect(() => {
    if (sessionId && !state.steps[sessionId]) loadSteps(sessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, loadSteps]);

  const session = state.sessions.find((s) => s.id === sessionId) ?? null;
  const steps = sessionId ? state.steps[sessionId] : undefined;
  const results = useMemo(() => pairResults(steps ?? []), [steps]);
  const selected = steps?.find((s) => s.id === selectedId) ?? null;

  // Focus a step requested by another view (openStep). tool_result rows are hidden, so land on their call.
  useEffect(() => {
    if (!focusStep || !sessionId) return;
    if (!steps) { loadSteps(sessionId); return; }
    const idx = steps.findIndex((s) => s.id === focusStep);
    if (idx === -1) {
      if (retried.current !== focusStep) { retried.current = focusStep; loadSteps(sessionId); return; } // maybe newer than our copy
      setFocusStep(null);
      return;
    }
    let target = steps[idx];
    if (!isVisible(target)) {
      const callId = [...results.entries()].find(([, r]) => r.id === target.id)?.[0];
      target = (callId && steps.find((s) => s.id === callId)) || [...steps.slice(0, idx)].reverse().find(isVisible) || target;
    }
    setSelectedId(target.id);
    setReveal((r) => ({ id: target.id, n: (r?.n ?? 0) + 1 }));
    setFocusStep(null);
  }, [focusStep, sessionId, steps, results, loadSteps, setFocusStep]);

  const select = useCallback((id: string) => { setSessionId(id); setSelectedId(null); loadSteps(id); }, [setSessionId, loadSteps]);
  const onClose = useCallback(() => setSelectedId(null), []);

  if (state.sessions.length === 0) {
    return (
      <div className="fl-root empty">
        <div className="fl-empty">
          <span className="fl-empty-pulse" />
          <p className="fl-empty-title">{state.connected ? "Waiting for an agent" : "Connecting…"}</p>
          <p>Start a Claude Code session in any project. It shows up here, live, step by step.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`fl-root ${selected ? "with-detail" : ""}`}>
      <SessionList sessions={state.sessions} selected={sessionId} onSelect={select} />
      {session ? (
        <Timeline session={session} steps={steps} selectedId={selectedId} reveal={reveal} onSelect={(s) => setSelectedId((cur) => (cur === s.id ? null : s.id))} />
      ) : <section className="fl-timeline" />}
      {selected && <StepDetail step={selected} result={results.get(selected.id)} onClose={onClose} />}
    </div>
  );
}
