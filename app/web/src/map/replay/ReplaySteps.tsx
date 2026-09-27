// Owner: replay agent. Scrollable step list shown in the sidebar's Threads tab during a replay.
// The list follows the replay cursor, and scrolling the list moves the cursor (beat nearest the center line).
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import DiffViewer from "react-diff-viewer-continued";
import type { Step } from "@contract";
import { isReplay, useLive } from "../../lib/live";
import { useNav } from "../../lib/nav";
import { beatLabel, countParts, isFailedResult, useThread, type Beat } from "../../lib/thread";
import { Glyph } from "../../follow/Glyph";
import { basename, clockTime, displayLabel, resultText, stepFile, stripInjected } from "../../follow/format";
import "./replay.css";

const ROW_H = 52;          // collapsed row height, keep in sync with replay.css
const USER_MS = 400;       // the list stops following the cursor this long after the user scrolls it

type RowState = "done" | "current" | "todo";

const diffStyles = {
  variables: {
    light: {
      diffViewerBackground: "#ffffff", diffViewerColor: "#1d1d1f",
      addedBackground: "#eaf7ef", addedColor: "#1d1d1f", removedBackground: "#fdeeee", removedColor: "#1d1d1f",
      wordAddedBackground: "#c6ecd4", wordRemovedBackground: "#f8cfcf",
      addedGutterBackground: "#dff3e6", removedGutterBackground: "#fbe3e3",
      gutterBackground: "#fbfbfd", gutterColor: "#a1a1a6", emptyLineBackground: "#ffffff",
      codeFoldGutterBackground: "#f4f4f8", codeFoldBackground: "#f7f7fa", codeFoldContentColor: "#86868b",
    },
  },
  contentText: { fontFamily: "var(--font-mono)", fontSize: "11.5px", lineHeight: "1.5 !important" },
  lineNumber: { fontSize: "10.5px" },
  gutter: { minWidth: "28px", padding: "0 4px" },
};

function editPair(s: Step): { before: string; after: string } | null {
  if (s.diff) return s.diff;
  const i = s.input && typeof s.input === "object" ? (s.input as Record<string, unknown>) : {};
  if (typeof i.old_string === "string" || typeof i.new_string === "string") return { before: String(i.old_string ?? ""), after: String(i.new_string ?? "") };
  if (typeof i.content === "string") return { before: "", after: i.content };
  if (Array.isArray(i.edits)) {
    const edits = i.edits as { old_string?: string; new_string?: string }[];
    return { before: edits.map((e) => e.old_string ?? "").join("\n\n"), after: edits.map((e) => e.new_string ?? "").join("\n\n") };
  }
  return null;
}

function preview(s: Step): string {
  const i = s.input && typeof s.input === "object" ? (s.input as Record<string, unknown>) : {};
  const t = typeof i.command === "string" ? `$ ${i.command}` : s.kind === "tool_result" ? resultText(s) : stripInjected(s.text ?? "");
  const clean = t.trim();
  return clean.length > 600 ? `${clean.slice(0, 599)}…` : clean;
}

const SUMMARY_ROWS = 8;

/** A summary or read group, expanded: its notable steps, each opening Follow at that step. */
function GroupDetail({ beat, sessionId }: { beat: Beat; sessionId: string }) {
  const { openStep } = useNav();
  const failedCalls = useMemo(() => {
    const ids = new Set<string>();
    beat.steps.forEach((st, i) => { if (isFailedResult(st)) for (let j = i - 1; j >= 0; j--) if (beat.steps[j].kind === "tool_call") { ids.add(beat.steps[j].id); break; } });
    return ids;
  }, [beat]);
  const notable = useMemo(() => beat.steps.filter((st) => st.kind !== "tool_result" && !(st.kind === "thinking" && !st.text?.trim()) && !(st.kind === "text" && !st.text?.trim() && !st.label)), [beat]);
  const shown = notable.slice(0, SUMMARY_ROWS);
  const more = notable.length - shown.length;
  return (
    <div className="rp-detail">
      <ul className="rp-sub">
        {shown.map((st) => (
          <li key={st.id}>
            <button className={failedCalls.has(st.id) ? "fail" : ""} onClick={() => openStep(sessionId, st.id)} title="Open in Follow">
              <span className="rp-glyph sm" aria-hidden="true"><Glyph kind={st.kind} tool={st.tool} size={12} /></span>
              <span className="rp-sub-label">{displayLabel(st)}</span>
              {failedCalls.has(st.id) && <span className="rp-fail-dot" aria-label="failed" />}
            </button>
          </li>
        ))}
      </ul>
      <button className="rp-link" onClick={() => openStep(sessionId, beat.step.id)}>
        {more > 0 ? `${more} more ${more === 1 ? "step" : "steps"}: open in Follow` : "Open in Follow"}
      </button>
    </div>
  );
}

function BeatDetail({ beat, sessionId }: { beat: Beat; sessionId: string }) {
  const { openStep } = useNav();
  const s = beat.step;
  if (beat.kind === "summary" || (beat.kind === "reads" && beat.steps.filter((x) => x.kind === "tool_call").length > 1)) return <GroupDetail beat={beat} sessionId={sessionId} />;
  const pair = useMemo(() => (s.kind === "edit" ? editPair(s) : null), [s]);
  const lines = pair ? pair.before.split("\n").length + pair.after.split("\n").length : 0;
  const text = s.kind === "edit" ? "" : preview(s);
  return (
    <div className="rp-detail">
      {s.kind === "edit" ? (
        pair ? (
          <div className="rp-diff">
            {lines > 600 ? <p className="rp-quiet">Large change, {lines} lines. Open it in Follow to read it.</p>
              : <DiffViewer oldValue={pair.before} newValue={pair.after} splitView={false} showDiffOnly extraLinesSurroundingDiff={1} hideSummary styles={diffStyles} />}
          </div>
        ) : <p className="rp-quiet">No diff recorded for this edit.</p>
      ) : text ? <pre className="rp-pre">{text}</pre> : null}
      {s.filePath && <p className="rp-path" title={s.filePath}>{s.filePath}</p>}
      <button className="rp-link" onClick={() => openStep(sessionId, s.id)}>Open in Follow at this step</button>
    </div>
  );
}

const Row = memo(function Row({ beat, state, expanded, sessionId, onPick }: {
  beat: Beat; state: RowState; expanded: boolean; sessionId: string; onPick: (i: number) => void;
}) {
  const s = beat.step;
  const file = beat.kind === "summary" ? undefined : stepFile(s);
  const label = s.kind === "prompt" && !s.isSubagent ? `You: ${beatLabel(beat)}` : beatLabel(beat);
  const parts = beat.counts ? countParts(beat.counts) : [];
  const readFiles = beat.kind === "reads" ? beat.files.map(basename) : [];
  return (
    <div className={`rp-row ${state} a-${beat.action} k-${beat.kind}${expanded ? " open" : ""}`} data-beat={beat.index}>
      <button className="rp-row-main" onClick={() => onPick(beat.index)} aria-current={state === "current" ? "step" : undefined}>
        <span className="rp-glyph" aria-hidden="true">{
          beat.kind === "summary" ? <SummaryGlyph />
            : s.kind === "prompt" && s.isSubagent ? <Glyph kind="tool_call" tool="Agent" size={14} />
            : <Glyph kind={s.kind} tool={s.tool} size={14} />}</span>
        <span className="rp-row-text">
          <span className="rp-row-label">{label}</span>
          <span className="rp-row-meta">
            <time>{clockTime(s.ts)}</time>
            {beat.failed > 0 && <span className="rp-chip fail">{beat.failed} failed</span>}
            {parts.length > 0 && <span className="rp-counts" title={parts.join(" · ")}>{parts.join(" · ")}</span>}
            {readFiles.length > 1
              ? <span className="rp-file" title={readFiles.join(", ")}>{readFiles.slice(0, 2).join(", ")}{readFiles.length > 2 ? ` +${readFiles.length - 2}` : ""}</span>
              : file && <span className="rp-file" title={file}>{basename(file)}</span>}
            {beat.outside && <span className="rp-chip">outside project</span>}
            {beat.why && <span className="rp-why" title={beat.why}>{beat.why}</span>}
          </span>
        </span>
      </button>
      {expanded && <BeatDetail beat={beat} sessionId={sessionId} />}
    </div>
  );
});

function SummaryGlyph() {
  return <svg width="14" height="14" viewBox="0 0 16 16"><path d="M3 4.5h10M3 8h10M3 11.5h6" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" /></svg>;
}

export function ReplaySteps() {
  const { replay, setReplayIndex, setReplayPlaying } = useNav();
  const { state } = useLive();
  const thread = useThread(replay?.sessionId ?? null, replay?.detail ?? "light");
  const listRef = useRef<HTMLDivElement>(null);
  const userAt = useRef(0);
  const dragging = useRef(false);
  const settle = useRef(0);
  const [scrolling, setScrolling] = useState(false);

  const len = thread?.beats.length ?? 0;
  const index = replay ? Math.min(replay.index, Math.max(0, len - 1)) : 0;
  const playing = !!replay?.playing;

  const playingRef = useRef(playing); playingRef.current = playing;
  const indexRef = useRef(index); indexRef.current = index;

  const onPick = useCallback((i: number) => { setReplayPlaying(false); setReplayIndex(i); userAt.current = 0; }, [setReplayIndex, setReplayPlaying]);

  // Any real scroll input from the user (wheel, touch, scrollbar drag, keys).
  const markUser = useCallback(() => {
    userAt.current = performance.now();
    setScrolling(true);
    clearTimeout(settle.current);
    settle.current = window.setTimeout(() => { if (!dragging.current) setScrolling(false); }, USER_MS);
  }, []);
  useEffect(() => () => clearTimeout(settle.current), []);
  useEffect(() => {
    const up = () => { if (dragging.current) { dragging.current = false; markUser(); } };
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => { window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up); };
  }, [markUser]);

  // The list's scroll moves the cursor to the beat nearest the center line.
  const raf = useRef(0);
  const onScroll = useCallback(() => {
    if (!dragging.current && performance.now() - userAt.current > USER_MS) return; // our own scroll or layout shift
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const el = listRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const cy = r.top + r.height / 2;
      let row: Element | null = null;
      for (const dy of [0, -6, 6, -14, 14]) {
        row = document.elementFromPoint(r.left + r.width / 2, cy + dy)?.closest("[data-beat]") ?? null;
        if (row && el.contains(row)) break;
        row = null;
      }
      const i = row ? Number((row as HTMLElement).dataset.beat) : NaN;
      if (Number.isFinite(i) && i !== indexRef.current) {
        if (playingRef.current) setReplayPlaying(false);
        setReplayIndex(i);
      }
    });
  }, [setReplayIndex, setReplayPlaying]);

  const expandedIndex = scrolling || playing ? -1 : index;

  // The cursor scrolls the list, unless the user scrolled it just now.
  const first = useRef(true);
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el || !len) return;
    if (dragging.current || performance.now() - userAt.current < USER_MS) return;
    const row = el.querySelector<HTMLElement>(`[data-beat="${index}"]`);
    if (!row) return;
    const top = Math.max(0, row.offsetTop - el.clientHeight / 2 + ROW_H / 2);
    const delta = Math.abs(el.scrollTop - top);
    if (delta < 2) return;
    el.scrollTo({ top, behavior: first.current || delta > 1600 ? "auto" : "smooth" });
    first.current = false;
  }, [index, len, expandedIndex]);
  useEffect(() => { first.current = true; }, [replay?.sessionId]);


  if (!replay) return null;
  if (!thread) {
    const missing = isReplay() && state.sessions.length > 0;
    return <div className="rp-steps"><p className="rp-quiet rp-pad">{missing ? "No steps were recorded for this thread." : "Loading steps…"}</p></div>;
  }
  if (!len) return <div className="rp-steps"><p className="rp-quiet rp-pad">This thread has no steps yet.</p></div>;

  return (
    <div className="rp-steps">
      <p className="rp-steps-sum">
        {thread.detail === "light"
          ? <>{len.toLocaleString()} moments from {thread.stepCount.toLocaleString()} steps · {thread.editCount} edits · {thread.files.length} files</>
          : <>{thread.stepCount.toLocaleString()} steps · {thread.editCount} edits · {thread.files.length} files</>}
      </p>
      <div className="rp-list" ref={listRef} onScroll={onScroll} onWheel={markUser} onTouchMove={markUser}
        onKeyDown={(e) => { if (["PageUp", "PageDown", "ArrowUp", "ArrowDown"].includes(e.key)) markUser(); }}
        onPointerDown={(e) => { if (e.target === e.currentTarget) { dragging.current = true; markUser(); } }}>
        <div className="rp-spacer" aria-hidden="true" />
        {thread.beats.map((b) => (
          <Row key={b.step.id} beat={b} sessionId={thread.sessionId} onPick={onPick}
            state={b.index < index ? "done" : b.index === index ? "current" : "todo"}
            expanded={b.index === expandedIndex} />
        ))}
        <div className="rp-spacer" aria-hidden="true" />
      </div>
    </div>
  );
}
