// Owner: sidebar agent. The folded sidebar with a thread open: its Track, folded down to a few lines in the top-left
// corner. The moment the thread is on (the newest while it follows live) as the Track's highlighted row, the two before
// it fading out above, the next one below when you look back; the same words and dots as the Track (ReplaySteps'
// textOf). The current row's dot breathes while the thread works. Beside them a scroller, as plain as a scroll bar: where
// you are in the thread (its start at the top, now at the bottom); click or drag it to go there. Clicking the rows, or
// T, unfolds the sidebar. Scrolling on the card steps through the thread as the Track's list does: up goes back (into the
// replay, paused, the map's marker on that moment), down comes forward, and back at the newest a running thread
// follows live again (App's LiveFollow).
import { useEffect, useRef } from "react";
import { useNavActions, useNavState, useReplayCursor } from "../../lib/nav";
import { useLiveSelector } from "../../lib/live";
import { useThread } from "../../lib/thread";
import { needsYou, yourTurn } from "../../lib/attention";
import { textOf } from "../replay/ReplaySteps";

const NOTCH = 40;   // px of wheel per moment (a mouse notch, or a stretch of a trackpad's glide)

export function NowCard({ onOpen }: { onOpen: () => void }) {
  const { replay } = useNavState();
  const sid = replay?.sessionId ?? null;
  const thread = useThread(sid, replay?.detail ?? "light");
  const index = useReplayCursor((c) => c.index);
  const running = useLiveSelector((s) => !!sid && s.sessions.find((x) => x.id === sid)?.status === "running");
  const attn = useLiveSelector((s) => (sid ? s.attention[sid] : undefined));
  const { setReplayIndex, setThreadMode, setReplayPlaying } = useNavActions();

  // Going to a moment by hand (the wheel, the line): into the replay, paused there.
  const now = useRef({ len: 0, mode: replay?.mode }); now.current = { len: thread?.beats.length ?? 0, mode: replay?.mode };
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
  }, [!!replay]);
  if (!replay) return null;

  const beats = thread?.beats ?? [];
  const at = Math.min(index, beats.length - 1);
  const rows = beats.length ? [at - 2, at - 1, at, at + 1].filter((i) => i >= 0 && i < beats.length) : [];
  const working = running && !needsYou(attn) && !yourTurn(attn);
  const cur = beats[at];

  return (
    <div className="sidebar-now" ref={card} title="Scroll to step through the thread">
      <button className="sn-rows" onClick={onOpen} aria-expanded={false}
        aria-label={`Open the thread's steps (T). ${cur ? `On: ${textOf(cur).label}` : "Loading its steps"}`} title="Open the thread's steps (T)">
        {!rows.length && <span className="sn-m current"><b /><span>Loading its steps…</span></span>}
        {rows.map((i) => {
          const { label, tone } = textOf(beats[i]);
          const state = i === at ? "current" : i < at ? `done d${at - i}` : "todo";
          return (
            <span key={beats[i].step.id} className={`sn-m ${tone} ${state}${i === at && working ? " working" : ""}`} aria-hidden="true">
              <b /><span>{label}</span>{beats[i].failed > 0 && <em>failed</em>}
            </span>
          );
        })}
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
