// The folded sidebar with a thread open: its Track, folded down to a few lines in the top-left
// corner. The moment the thread is on (the newest while it follows live) as the Track's highlighted row, the ones before
// it fading out above, the next one below when you look back, always four rows of the same height; the same words and dots as the Track (ReplaySteps'
// textOf). The newest moment's dot breathes while the thread works (only that one: a moment you scroll back to keeps
// its own colour). Beside them a scroller, as plain as a scroll bar: where
// you are in the thread (its start at the top, now at the bottom); click or drag it to go there. Clicking the rows, or
// T, unfolds the sidebar. Scrolling on the card steps through the thread as the Track's list does: up goes back (into the
// replay, paused, the map's marker on that moment), down comes forward, and back at the newest a running thread
// follows live again (App's LiveFollow).
import { useEffect, useLayoutEffect, useRef } from "react";
import { useNavActions, useNavState, useReplayCursor } from "../../lib/nav";
import { useLiveSelector } from "../../lib/live";
import { useThread } from "../../lib/thread";
import { needsYou, yourTurn } from "../../lib/attention";
import { textOf } from "../replay/ReplaySteps";
import { reducedMotion } from "../../lib/breakpoints";
import { MomentRow, useRowWindow } from "../replay/moments";

const NOTCH = 40;   // px of wheel per moment (a mouse notch, or a stretch of a trackpad's glide)
const ROWS = 4;     // moments on the card
const ROW_H = 31;   // a row and the gap under it (sidebar.css .sn-m): how far the rows slide per moment
const SLIDE_MS = 170;

export function NowCard({ onOpen }: { onOpen: () => void }) {
  const { thread: openThread } = useNavState();
  const sid = openThread?.sessionId ?? null;
  const thread = useThread(sid, openThread?.detail ?? "light");
  const index = useReplayCursor((c) => c.index);
  const running = useLiveSelector((s) => !!sid && s.sessions.find((x) => x.id === sid)?.status === "running");
  const attn = useLiveSelector((s) => (sid ? s.attention[sid] : undefined));
  const { setReplayIndex, setThreadMode, setReplayPlaying } = useNavActions();

  // Going to a moment by hand (the wheel, the line): into the replay, paused there.
  const now = useRef({ len: 0, mode: openThread?.mode }); now.current = { len: thread?.beats.length ?? 0, mode: openThread?.mode };
  const go = useRef((_to: (i: number) => number) => {});
  go.current = (to) => {
    const { len, mode } = now.current;
    if (!len) return;
    if (mode !== "play") setThreadMode("play");
    setReplayPlaying(false);
    setReplayIndex((i) => Math.max(0, Math.min(len - 1, to(Math.min(i, len - 1)))));
  };
  // Scrolling on the card: one moment per notch. Not the map's zoom.
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = card.current;
    if (!el) return;
    let acc = 0, lastAt = 0;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const t = performance.now();
      if (t - lastAt > 250) acc = 0;   // a new gesture
      lastAt = t;
      acc += e.deltaMode === 1 ? e.deltaY * NOTCH : e.deltaY;
      const steps = Math.trunc(acc / NOTCH);
      if (!steps) return;
      acc -= steps * NOTCH;
      go.current((i) => i + steps);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [!!openThread]);
  const beats = thread?.beats ?? [];
  const at = Math.min(index, beats.length - 1);
  // Always the same four rows (fewer only in a thread that short), so the card keeps its height as you scroll: the
  // moment you're on third, with one after it, or last at the newest (three before it).
  const [shown] = useRowWindow({ end: beats.length, at, before: 2, size: ROWS });
  const start = shown?.[0] ?? 0;
  // Moving a moment, the rows slide by one, as the Track's list scrolls, instead of jumping (a fast scroll that moves
  // several at once slides by up to three).
  // Only when the window of rows moves: at the thread's ends it stays put and the highlight moves instead.
  const list = useRef<HTMLSpanElement>(null), was = useRef(start);
  useLayoutEffect(() => {
    const el = list.current, d = Math.max(-3, Math.min(3, start - was.current));
    was.current = start;
    if (!el || !d || reducedMotion()) return;
    el.getAnimations().forEach((a) => a.cancel());
    el.animate([{ transform: `translateY(${d * ROW_H}px)` }, { transform: "none" }], { duration: SLIDE_MS, easing: "cubic-bezier(.2,.7,.25,1)" });
  }, [start]);
  if (!openThread) return null;

  const rows = shown ? Array.from({ length: shown[1] - shown[0] }, (_, k) => start + k) : [];
  const working = running && !needsYou(attn) && !yourTurn(attn);
  const cur = beats[at];


  return (
    <div className="sidebar-now" ref={card} title="Scroll to step through the thread">
      <button className="sn-rows" onClick={onOpen} aria-expanded={false}
        aria-label={`Open the thread's steps (T). ${cur ? `On: ${textOf(cur).label}` : "Loading its steps"}`} title="Open the thread's steps (T)">
        <span className="sn-list" ref={list}>
          {!rows.length && <MomentRow as="span" className="sn-m current" mark={<b />} label="Loading its steps…" />}
          {rows.map((i) => {
            const { label, tone } = textOf(beats[i]);
            const state = i === at ? "current" : i < at ? `done d${at - i}` : "todo";
            return (
              <MomentRow as="span" key={beats[i].step.id} className={`sn-m ${tone} ${state}${i === beats.length - 1 && working ? " working" : ""}`} aria-hidden="true"
                mark={<b />} label={label} failed={beats[i].failed > 0} />
            );
          })}
        </span>
      </button>
      {beats.length > 1 && <Scroller len={beats.length} at={at} go={(i) => go.current(() => i)} />}
    </div>
  );
}

/** Where you are in the thread, as a scroll bar: click or drag to go to a moment. */
function Scroller({ len, at, go }: { len: number; at: number; go: (i: number) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const n = Math.max(1, len - 1);
  const pick = (y: number) => {
    const r = el.current?.getBoundingClientRect();
    if (r) go(Math.round(Math.max(0, Math.min(1, (y - r.top) / Math.max(1, r.height))) * n));
  };
  return (
    <div className="sn-scroll" ref={el} role="slider" tabIndex={0} aria-orientation="vertical" aria-label="Where you are in the thread"
      aria-valuemin={1} aria-valuemax={len} aria-valuenow={at + 1} aria-valuetext={`Step ${at + 1} of ${len}`}
      style={{ ["--at" as string]: at / n }}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); pick(e.clientY); }}
      onPointerMove={(e) => { if (e.buttons) pick(e.clientY); }}
      onKeyDown={(e) => {
        const d = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : e.key === "Home" ? -len : e.key === "End" ? len : 0;
        if (!d) return;
        e.preventDefault(); e.stopPropagation();
        go(Math.max(0, Math.min(len - 1, at + d)));
      }}>
      <i aria-hidden="true" />
    </div>
  );
}
