// The sidebar's Track tab: an open thread's steps next to the map, in chapters: each message you typed is a section, and the
// work it led to is one line per moment under it. The chapter you're in is open; the others show your message, when,
// how long, what it changed and whether something failed. Times and counts stay out of the rows: the step panel has
// them. The list follows the replay cursor, and scrolling it moves the cursor (the moment nearest the center line).
//
// A long thread can have thousands of moments in one chapter ("Show every step"): an open chapter draws only the rows
// around what you see and around the cursor (every row is one line, the same height), with empty space standing in
// for the rest, so the scroll bar, the follow and the center line work as if they were all there.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { isReplay, useHarness, useLive, useLiveSelector } from "../../lib/live";
import { harnessName } from "../../lib/harness";
import { useNav } from "../../lib/nav";
import { beatLabel, useThread, type Beat, type Thread } from "../../lib/thread";
import { chapterAt, chaptersOf, duration, injectedLabel, type Chapter } from "../../lib/chapters";
import { timeIn } from "../../follow/format";
import { LinkedLabel } from "../../lib/links";
import { attentionText, needsYou, yourTurn } from "../../lib/attention";
import "./replay.css";

const USER_MS = 400;       // the list stops following the cursor this long after the user scrolls it
const ROW_H = 30;          // a moment's row height until one is measured (.rp-m: one line)
const OVERSCAN = 40;       // rows drawn past each edge of the view, and around the cursor

type RowState = "done" | "current" | "todo";

/** The dot's color says what kind of moment it is: an edit, the agent talking, a failure, or the rest (reads, commands). */
function tone(b: Beat): string {
  if (b.failed > 0) return "fl";
  if (b.action === "edit") return "edit";
  if (b.kind === "summary" || b.step.kind === "text" || b.step.kind === "prompt") return "say";
  return "";
}
/** A moment's label and tone, worked out once per beat (a beat is rebuilt when its thread is). */
const rowText = new WeakMap<Beat, { label: string; tone: string }>();
function textOf(b: Beat) {
  let t = rowText.get(b);
  if (!t) rowText.set(b, (t = { label: injectedLabel(b.step) ?? beatLabel(b), tone: tone(b) }));
  return t;
}

/** One moment. Its props are plain values, so a new step (which rebuilds every beat) redraws only the rows that changed. */
const Moment = memo(function Moment({ index, label, tone, failed, state, onPick }:
  { index: number; label: string; tone: string; failed: boolean; state: RowState; onPick: (i: number) => void }) {
  return (
    <button className={`rp-m ${tone} ${state}`} data-beat={index} onClick={() => onPick(index)}
      aria-current={state === "current" ? "step" : undefined} title={label}>
      <b aria-hidden="true" />
      <span><LinkedLabel text={label} max={40} /></span>
      {failed && <em>failed</em>}
    </button>
  );
});

/** A chapter's heading is also its first moment (your message): the cursor can sit on it, and scrolling can land on it. */
const ChapterHead = memo(function ChapterHead({ c, open, at, multiDay, onToggle }: { c: Chapter; open: boolean; at: boolean; multiDay: boolean; onToggle: (i: number) => void }) {
  const files = c.files ? `${c.files} file${c.files === 1 ? "" : "s"}` : "no files";
  return (
    <button className={`rp-ch-head${open ? " open" : ""}${at ? " at" : ""}${c.hasPrompt ? "" : " pre"}`} onClick={() => onToggle(c.index)} aria-expanded={open}
      data-beat={c.hasPrompt ? c.first : undefined} aria-current={at ? "step" : undefined}>
      <span className="rp-ch-title" title={c.title}><LinkedLabel text={c.title} /></span>
      <span className="rp-ch-meta">
        <span>{timeIn(c.at, multiDay)} · {duration(c.ms)} · {files}</span>
        {c.failed > 0 && <span className="rp-ch-fail">{c.failed} failed</span>}
      </span>
    </button>
  );
});

type Range = [number, number]; // rows [start, end) of a chapter, as beat indexes

/**
 * An open chapter's moments, beats `from`..`last`: the rows in view and around the cursor, with spacers for the rest.
 * Each spacer says which rows it stands for (data-from), so the center line can find a moment there too.
 */
const Moments = memo(function Moments({ beats, from, last, index, rowH, onPick, onRowH }:
  { beats: Beat[]; from: number; last: number; index: number; rowH: number; onPick: (i: number) => void; onRowH: (h: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const end = last + 1;
  const clamp = (r: Range): Range => [Math.max(from, r[0]), Math.min(end, r[1])];
  // The rows in view, from where this chapter sits in the list's scroll.
  const inView = useCallback((): Range | null => {
    const el = box.current, list = el?.closest(".rp-list");
    if (!el || !list) return null;
    const top = el.getBoundingClientRect().top - list.getBoundingClientRect().top;
    const a = from + Math.floor(-top / rowH), b = from + Math.ceil((list.clientHeight - top) / rowH);
    return [a, b];
  }, [from, rowH]);
  const [view, setView] = useState<Range>(() => [index - OVERSCAN, index + OVERSCAN]);
  // Follow the list's scroll: draw again only once the view nears the edge of what is drawn.
  useLayoutEffect(() => {
    const list = box.current?.closest(".rp-list");
    if (!list) return;
    const update = () => {
      const v = inView();
      if (v) setView((cur) => (v[0] - OVERSCAN / 2 < cur[0] && cur[0] > from) || (v[1] + OVERSCAN / 2 > cur[1] && cur[1] < end) || v[1] < cur[0] || v[0] > cur[1]
        ? [v[0] - OVERSCAN, v[1] + OVERSCAN] : cur);
    };
    update();
    list.addEventListener("scroll", update, { passive: true });
    return () => list.removeEventListener("scroll", update);
  }, [inView, from, end]);
  // Measure a row: the spacers are rows' worth of height.
  useLayoutEffect(() => {
    const row = box.current?.querySelector<HTMLElement>(".rp-m");
    const h = row?.getBoundingClientRect().height;
    if (h && Math.abs(h - rowH) > 0.05) onRowH(h);
  });

  // What to draw: the view, and the cursor's neighbourhood (the list scrolls to it right after this render).
  const ranges: Range[] = [clamp(view)];
  if (index >= from && index <= last) ranges.push(clamp([index - OVERSCAN, index + OVERSCAN]));
  ranges.sort((p, q) => p[0] - q[0]);
  const merged: Range[] = [];
  for (const r of ranges) {
    if (r[1] <= r[0]) continue;
    const m = merged[merged.length - 1];
    if (m && r[0] <= m[1]) m[1] = Math.max(m[1], r[1]); else merged.push([r[0], r[1]]);
  }
  const out: ReactNode[] = [];
  const spacer = (a: number, b: number) => out.push(<div key={`s${a}`} className="rp-m-gap" data-from={a} style={{ height: (b - a) * rowH }} aria-hidden="true" />);
  let at = from;
  for (const [a, b] of merged) {
    if (a > at) spacer(at, a);
    for (let i = a; i < b; i++) {
      const beat = beats[i], t = textOf(beat);
      out.push(<Moment key={beat.step.id} index={i} label={t.label} tone={t.tone} failed={beat.failed > 0} onPick={onPick}
        state={i < index ? "done" : i === index ? "current" : "todo"} />);
    }
    at = b;
  }
  if (at < end) spacer(at, end);
  return <div className="rp-ch-moments" ref={box}>{out}</div>;
});

export function ReplaySteps() {
  const { replay, setReplayIndex, setReplayPlaying, setReplayDetail, openStep } = useNav();
  const thread = useThread(replay?.sessionId ?? null, replay?.detail ?? "light");
  if (!replay) return null;
  if (!thread) return <div className="rp-steps"><p className="rp-quiet rp-pad"><Loading /></p></div>;
  if (!thread.beats.length) return <div className="rp-steps"><p className="rp-quiet rp-pad">This thread has no steps yet.</p></div>;
  const len = thread.beats.length;
  return (
    <TrackList thread={thread} sessionId={replay.sessionId} index={Math.min(replay.index, Math.max(0, len - 1))} playing={!!replay.playing}
      full={replay.detail === "full"} setReplayIndex={setReplayIndex} setReplayPlaying={setReplayPlaying} setReplayDetail={setReplayDetail} openStep={openStep} />
  );
}

/** While the steps load; a recorded demo that has none for this thread says so. */
function Loading() {
  const { state } = useLive();
  return <>{isReplay() && state.sessions.length > 0 ? "No steps were recorded for this thread." : "Loading steps…"}</>;
}

type TrackProps = {
  thread: Thread; sessionId: string; index: number; playing: boolean; full: boolean;
  setReplayIndex: (i: number | ((prev: number) => number)) => void; setReplayPlaying: (p: boolean) => void;
  setReplayDetail: (d: "light" | "full") => void; openStep: (sessionId: string, stepId: string) => void;
};

/** The list itself. Memoised: a live message that doesn't change this thread or its cursor leaves it alone. */
const TrackList = memo(function TrackList({ thread, sessionId, index, playing, full, setReplayIndex, setReplayPlaying, setReplayDetail, openStep }: TrackProps) {
  const threadRef = useRef(thread); threadRef.current = thread;
  const listRef = useRef<HTMLDivElement>(null);
  const userAt = useRef(0);
  const dragging = useRef(false);
  const [rowH, setRowH] = useState(ROW_H);

  const len = thread.beats.length;
  const chapters = useMemo(() => chaptersOf(thread), [thread]);
  const here = chapters.length ? chapterAt(chapters, index).index : -1;
  const multiDay = chapters.length > 1 && new Date(chapters[0].at).toDateString() !== new Date(chapters[chapters.length - 1].at).toDateString();

  // Open chapters: the one the cursor is in, plus any you opened. Moving into another chapter opens it (and folds the rest).
  const [open, setOpen] = useState<Set<number>>(new Set());
  useEffect(() => { if (here >= 0) setOpen(new Set([here])); }, [here, sessionId]);
  const toggle = useCallback((i: number) => setOpen((o) => { const n = new Set(o); if (n.has(i)) n.delete(i); else n.add(i); return n; }), []);

  const playingRef = useRef(playing); playingRef.current = playing;
  const indexRef = useRef(index); indexRef.current = index;

  // A moment opens in the side panel (a summary, on the agent's own words).
  const onPick = useCallback((i: number) => {
    setReplayPlaying(false); setReplayIndex(i); userAt.current = 0;
    const beat = threadRef.current?.beats[i];
    if (!beat) return;
    const words = beat.kind === "summary" ? [...beat.steps].reverse().find((s) => s.kind === "text" && s.text?.trim()) : undefined;
    openStep(sessionId, (words ?? beat.step).id);
  }, [setReplayIndex, setReplayPlaying, openStep, sessionId]);

  // Any real scroll input from the user (wheel, touch, scrollbar drag, keys).
  const markUser = useCallback(() => { userAt.current = performance.now(); }, []);
  useEffect(() => {
    const up = () => { if (dragging.current) { dragging.current = false; markUser(); } };
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => { window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up); };
  }, [markUser]);

  // The list's scroll moves the cursor to the moment nearest the center line (a spacer stands for rows of moments).
  const raf = useRef(0);
  const rowHRef = useRef(rowH); rowHRef.current = rowH;
  const onScroll = useCallback(() => {
    if (!dragging.current && performance.now() - userAt.current > USER_MS) return; // our own scroll or layout shift
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const el = listRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const cy = r.top + r.height / 2;
      let i = NaN;
      for (const dy of [0, -6, 6, -14, 14]) {
        const hit = document.elementFromPoint(r.left + r.width / 2, cy + dy);
        const row = hit?.closest<HTMLElement>("[data-beat], .rp-m-gap");
        if (!row || !el.contains(row)) continue;
        i = row.dataset.beat !== undefined ? Number(row.dataset.beat)
          : Number(row.dataset.from) + Math.floor((cy + dy - row.getBoundingClientRect().top) / rowHRef.current);
        break;
      }
      if (Number.isFinite(i) && i !== indexRef.current) {
        if (playingRef.current) setReplayPlaying(false);
        setReplayIndex(i);
      }
    });
  }, [setReplayIndex, setReplayPlaying]);

  // The cursor scrolls the list, unless the user scrolled it just now. A moment that isn't drawn yet is found by its
  // place in its chapter (every row is one line).
  const first = useRef(true);
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el || !len) return;
    if (dragging.current || performance.now() - userAt.current < USER_MS) return;
    let rowTop: number | null = null, rowHeight = 0;
    const row = el.querySelector<HTMLElement>(`[data-beat="${index}"]`);
    if (row) { rowTop = row.offsetTop; rowHeight = row.offsetHeight; }
    else if (here >= 0 && open.has(here)) {
      const c = chapters[here], from = c.hasPrompt ? c.first + 1 : c.first;
      const box = el.querySelector<HTMLElement>(`[data-chapter="${here}"] .rp-ch-moments`);
      if (box && index >= from && index <= c.last) { rowTop = box.offsetTop + (index - from) * rowH; rowHeight = rowH; }
    }
    if (rowTop === null) {
      const head = el.querySelector<HTMLElement>(`[data-chapter="${here}"] .rp-ch-head`);
      if (!head) return;
      rowTop = head.offsetTop; rowHeight = head.offsetHeight;
    }
    const top = Math.max(0, rowTop - el.clientHeight / 2 + rowHeight / 2);
    const delta = Math.abs(el.scrollTop - top);
    if (delta < 2) return;
    el.scrollTo({ top, behavior: first.current || delta > 1600 ? "auto" : "smooth" });
    first.current = false;
  }, [index, len, here, open, chapters, rowH]);
  useEffect(() => { first.current = true; }, [sessionId]);

  const onRowH = useCallback((h: number) => setRowH(h), []);

  return (
    <div className="rp-steps">
      <div className="rp-list rp-chapters" ref={listRef} onScroll={onScroll} onWheel={markUser} onTouchMove={markUser}
        onKeyDown={(e) => { if (["PageUp", "PageDown", "ArrowUp", "ArrowDown"].includes(e.key)) markUser(); }}
        onPointerDown={(e) => { if (e.target === e.currentTarget) { dragging.current = true; markUser(); } }}>
        {chapters.map((c) => {
          const isOpen = open.has(c.index);
          const from = c.hasPrompt ? c.first + 1 : c.first; // the message itself is the heading
          return (
            <section key={c.first} className="rp-ch" data-chapter={c.index}>
              <ChapterHead c={c} open={isOpen} multiDay={multiDay} at={c.hasPrompt && index === c.first} onToggle={toggle} />
              {isOpen && from <= c.last && (
                <Moments beats={thread.beats} from={from} last={c.last} index={index} rowH={rowH} onPick={onPick} onRowH={onRowH} />
              )}
            </section>
          );
        })}
        <WaitingRow sessionId={sessionId} onOpen={(stepId) => openStep(sessionId, stepId)} />
        <button className="rp-detail-switch" onClick={() => setReplayDetail(full ? "light" : "full")}>
          {full ? "Group the steps into moments" : "Show every step"}
        </button>
      </div>
    </div>
  );
});

/** When the agent last did something: "14:32", or "Mon 5 Oct, 14:32" before today. */
function stoppedAt(iso: string): string {
  const d = new Date(iso), today = new Date().toDateString() === d.toDateString();
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return today ? `at ${time}` : `${d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}, ${time}`;
}

/** The live end of the list while the model works on its next step (nothing in the log yet): "Thinking", and for how long. */
function ThinkingRow({ since }: { since: string }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, []);
  const s = Math.max(0, Math.round((Date.now() - Date.parse(since)) / 1000));
  const took = s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
  return (
    <div className="rp-waiting thinking" role="status">
      <b aria-hidden="true" />
      <span className="rp-waiting-line">Thinking<i className="rp-dots" aria-hidden="true"><i /><i /><i /></i></span>
      <span className="rp-waiting-detail">{took}</span>
    </div>
  );
}

/** The live end of the list: the agent is waiting on you (or done and it's your turn). */
function WaitingRow({ sessionId, onOpen }: { sessionId: string; onOpen: (stepId: string) => void }) {
  const a = useLive().state.attention[sessionId];
  const harness = useHarness(sessionId);
  const session = useLiveSelector((s) => s.sessions.find((x) => x.id === sessionId));
  if (a?.state === "thinking") return <ThinkingRow since={a.since} />;
  if (!a || !(needsYou(a) || yourTurn(a))) {
    // At rest: the agent stopped (its marker stays where it last was on the map). Not while it's running.
    if (!session || session.status === "running" || isReplay()) return null;
    return (
      <div className="rp-waiting stopped" role="status">
        <b aria-hidden="true" />
        <span className="rp-waiting-line">Stopped</span>
        <span className="rp-waiting-detail">{stoppedAt(session.lastEventAt)}</span>
      </div>
    );
  }
  const t = attentionText(a);
  const blocked = needsYou(a);
  return (
    <div className={`rp-waiting ${blocked ? "blocked" : "turn"}`} role="status">
      <b aria-hidden="true" />
      <span className="rp-waiting-line" title={blocked && a.state !== "stuck" ? `Answer it in ${harnessName(harness)}` : undefined}>{t.title}</span>
      {a.detail && <span className="rp-waiting-detail" title={a.detail}>{a.detail}</span>}
      {a.stepId && <button className="rp-waiting-open" onClick={() => onOpen(a.stepId!)}>Show the step</button>}
    </div>
  );
}
