// The sidebar's Track tab: an open thread's steps next to the map, in chapters: each message you typed is a section, and the
// work it led to is one line per moment under it. The chapter you're in is open; the others show your message, when,
// how long, what it changed and whether something failed. Times and counts stay out of the rows: the step panel has
// them. The list follows the replay cursor, and scrolling it moves the cursor (the moment nearest the center line).
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { isReplay, useLive } from "../../lib/live";
import { useNav } from "../../lib/nav";
import { beatLabel, useThread, type Beat } from "../../lib/thread";
import { chapterAt, chaptersOf, duration, injectedLabel, type Chapter } from "../../lib/chapters";
import { timeIn } from "../../follow/format";
import { attentionText, needsYou, yourTurn } from "../../lib/attention";
import "./replay.css";

const USER_MS = 400;       // the list stops following the cursor this long after the user scrolls it

type RowState = "done" | "current" | "todo";

/** The dot's color says what kind of moment it is: an edit, the agent talking, a failure, or the rest (reads, commands). */
function tone(b: Beat): string {
  if (b.failed > 0) return "fl";
  if (b.action === "edit") return "edit";
  if (b.kind === "summary" || b.step.kind === "text" || b.step.kind === "prompt") return "say";
  return "";
}

const Moment = memo(function Moment({ beat, state, onPick }: { beat: Beat; state: RowState; onPick: (i: number) => void }) {
  const label = injectedLabel(beat.step) ?? beatLabel(beat);
  return (
    <button className={`rp-m ${tone(beat)} ${state}`} data-beat={beat.index} onClick={() => onPick(beat.index)}
      aria-current={state === "current" ? "step" : undefined} title={label}>
      <b aria-hidden="true" />
      <span>{label}</span>
      {beat.failed > 0 && <em>failed</em>}
    </button>
  );
});

/** A chapter's heading is also its first moment (your message): the cursor can sit on it, and scrolling can land on it. */
function ChapterHead({ c, open, at, multiDay, onToggle }: { c: Chapter; open: boolean; at: boolean; multiDay: boolean; onToggle: () => void }) {
  const files = c.files ? `${c.files} file${c.files === 1 ? "" : "s"}` : "no files";
  return (
    <button className={`rp-ch-head${open ? " open" : ""}${at ? " at" : ""}${c.hasPrompt ? "" : " pre"}`} onClick={onToggle} aria-expanded={open}
      data-beat={c.hasPrompt ? c.first : undefined} aria-current={at ? "step" : undefined}>
      <span className="rp-ch-title" title={c.title}>{c.title}</span>
      <span className="rp-ch-meta">
        <span>{timeIn(c.at, multiDay)} · {duration(c.ms)} · {files}</span>
        {c.failed > 0 && <span className="rp-ch-fail">{c.failed} failed</span>}
      </span>
    </button>
  );
}

export function ReplaySteps() {
  const { replay, setReplayIndex, setReplayPlaying, setReplayDetail, openStep } = useNav();
  const { state } = useLive();
  const thread = useThread(replay?.sessionId ?? null, replay?.detail ?? "light");
  const threadRef = useRef(thread); threadRef.current = thread;
  const listRef = useRef<HTMLDivElement>(null);
  const userAt = useRef(0);
  const dragging = useRef(false);

  const len = thread?.beats.length ?? 0;
  const index = replay ? Math.min(replay.index, Math.max(0, len - 1)) : 0;
  const playing = !!replay?.playing;
  const chapters = useMemo(() => (thread ? chaptersOf(thread) : []), [thread]);
  const here = chapters.length ? chapterAt(chapters, index).index : -1;
  const multiDay = chapters.length > 1 && new Date(chapters[0].at).toDateString() !== new Date(chapters[chapters.length - 1].at).toDateString();

  // Open chapters: the one the cursor is in, plus any you opened. Moving into another chapter opens it (and folds the rest).
  const [open, setOpen] = useState<Set<number>>(new Set());
  useEffect(() => { if (here >= 0) setOpen(new Set([here])); }, [here, replay?.sessionId]);
  const toggle = (i: number) => setOpen((o) => { const n = new Set(o); if (n.has(i)) n.delete(i); else n.add(i); return n; });

  const playingRef = useRef(playing); playingRef.current = playing;
  const indexRef = useRef(index); indexRef.current = index;

  // A moment opens in the side panel (a summary, on the agent's own words).
  const onPick = useCallback((i: number) => {
    setReplayPlaying(false); setReplayIndex(i); userAt.current = 0;
    const beat = threadRef.current?.beats[i];
    if (!beat || !replay) return;
    const words = beat.kind === "summary" ? [...beat.steps].reverse().find((s) => s.kind === "text" && s.text?.trim()) : undefined;
    openStep(replay.sessionId, (words ?? beat.step).id);
  }, [setReplayIndex, setReplayPlaying, openStep, replay?.sessionId]);

  // Any real scroll input from the user (wheel, touch, scrollbar drag, keys).
  const markUser = useCallback(() => { userAt.current = performance.now(); }, []);
  useEffect(() => {
    const up = () => { if (dragging.current) { dragging.current = false; markUser(); } };
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => { window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up); };
  }, [markUser]);

  // The list's scroll moves the cursor to the moment nearest the center line.
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

  // The cursor scrolls the list, unless the user scrolled it just now.
  const first = useRef(true);
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el || !len) return;
    if (dragging.current || performance.now() - userAt.current < USER_MS) return;
    const row = el.querySelector<HTMLElement>(`[data-beat="${index}"]`) ?? el.querySelector<HTMLElement>(`[data-chapter="${here}"] .rp-ch-head`);
    if (!row) return;
    const top = Math.max(0, row.offsetTop - el.clientHeight / 2 + row.offsetHeight / 2);
    const delta = Math.abs(el.scrollTop - top);
    if (delta < 2) return;
    el.scrollTo({ top, behavior: first.current || delta > 1600 ? "auto" : "smooth" });
    first.current = false;
  }, [index, len, here, open]);
  useEffect(() => { first.current = true; }, [replay?.sessionId]);

  if (!replay) return null;
  if (!thread) {
    const missing = isReplay() && state.sessions.length > 0;
    return <div className="rp-steps"><p className="rp-quiet rp-pad">{missing ? "No steps were recorded for this thread." : "Loading steps…"}</p></div>;
  }
  if (!len) return <div className="rp-steps"><p className="rp-quiet rp-pad">This thread has no steps yet.</p></div>;
  const full = replay.detail === "full";

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
              <ChapterHead c={c} open={isOpen} multiDay={multiDay} at={c.hasPrompt && index === c.first} onToggle={() => toggle(c.index)} />
              {isOpen && from <= c.last && (
                <div className="rp-ch-moments">
                  {thread.beats.slice(from, c.last + 1).map((b) => (
                    <Moment key={b.step.id} beat={b} onPick={onPick} state={b.index < index ? "done" : b.index === index ? "current" : "todo"} />
                  ))}
                </div>
              )}
            </section>
          );
        })}
        <WaitingRow sessionId={replay.sessionId} onOpen={(stepId) => openStep(replay.sessionId, stepId)} />
        <button className="rp-detail-switch" onClick={() => setReplayDetail(full ? "light" : "full")}>
          {full ? "Group the steps into moments" : "Show every step"}
        </button>
      </div>
    </div>
  );
}

/** The live end of the list: the agent is waiting on you (or done and it's your turn). */
function WaitingRow({ sessionId, onOpen }: { sessionId: string; onOpen: (stepId: string) => void }) {
  const a = useLive().state.attention[sessionId];
  if (!a || !(needsYou(a) || yourTurn(a))) return null;
  const t = attentionText(a);
  const blocked = needsYou(a);
  return (
    <div className={`rp-waiting ${blocked ? "blocked" : "turn"}`} role="status">
      <b aria-hidden="true" />
      <span className="rp-waiting-line">{t.line}</span>
      {a.detail && <code className="rp-waiting-detail" title={a.detail}>{a.detail}</code>}
      {blocked && <span className="rp-waiting-hint">{a.state === "stuck" ? "It may need a hint from you." : "Answer it in Claude Code."}</span>}
      {a.stepId && <button className="rp-waiting-open" onClick={() => onOpen(a.stepId!)}>Show the step</button>}
    </div>
  );
}
