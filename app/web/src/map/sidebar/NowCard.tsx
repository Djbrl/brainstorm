// Owner: sidebar agent. The folded sidebar with a thread open: its Track, folded down to a few lines in the top-left
// corner. The moment the thread is on (the newest while it follows live) as the Track's highlighted row, the two before
// it fading out above, the next one below when you look back; the same words and dots as the Track (ReplaySteps'
// textOf). The current row's dot breathes while the thread works. Clicking it, or T, unfolds the sidebar. Scrolling on
// it steps through the thread as the Track's list does: up goes back (the replay's player opens, paused, the map's
// marker on that moment), down comes forward, and back at the newest a running thread follows live again (App's
// LiveFollow).
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

  // Scrolling on the card: one moment per notch. Not the map's zoom.
  const card = useRef<HTMLButtonElement>(null);
  const now = useRef({ len: 0, mode: replay?.mode }); now.current = { len: thread?.beats.length ?? 0, mode: replay?.mode };
  useEffect(() => {
    const el = card.current;
    if (!el) return;
    let acc = 0, lastAt = 0;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { len, mode } = now.current;
      if (!len) return;
      const t = performance.now();
      if (t - lastAt > 250) acc = 0;   // a new gesture
      lastAt = t;
      acc += e.deltaMode === 1 ? e.deltaY * NOTCH : e.deltaY;
      const steps = Math.trunc(acc / NOTCH);
      if (!steps) return;
      acc -= steps * NOTCH;
      if (mode !== "play") setThreadMode("play");
      setReplayPlaying(false);
      setReplayIndex((i) => Math.max(0, Math.min(len - 1, Math.min(i, len - 1) + steps)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [!!replay, setReplayIndex, setThreadMode, setReplayPlaying]);
  if (!replay) return null;

  const beats = thread?.beats ?? [];
  const at = Math.min(index, beats.length - 1);
  const rows = beats.length ? [at - 2, at - 1, at, at + 1].filter((i) => i >= 0 && i < beats.length) : [];
  const working = running && !needsYou(attn) && !yourTurn(attn);
  const cur = beats[at];

  return (
    <button className="sidebar-now" ref={card} onClick={onOpen} aria-expanded={false}
      aria-label={`Open the thread's steps. ${cur ? `On: ${textOf(cur).label}` : "Loading its steps"}`}
      title="Scroll to step through the thread. Click to open it (T)">
      <span className="sn-rows" aria-hidden="true">
        {!rows.length && <span className="sn-m current"><b /><span>Loading its steps…</span></span>}
        {rows.map((i) => {
          const { label, tone } = textOf(beats[i]);
          const state = i === at ? "current" : i < at ? `done d${at - i}` : "todo";
          return (
            <span key={beats[i].step.id} className={`sn-m ${tone} ${state}${i === at && working ? " working" : ""}`}>
              <b /><span>{label}</span>{beats[i].failed > 0 && <em>failed</em>}
            </span>
          );
        })}
      </span>
      <span className="sn-open" aria-hidden="true">
        <svg viewBox="0 0 16 16"><rect x="1.75" y="2.25" width="12.5" height="11.5" rx="2.5" /><path d="M6 2.5v11" /><path d="M9 6.5 10.75 8 9 9.5" /></svg>
      </span>
    </button>
  );
}
