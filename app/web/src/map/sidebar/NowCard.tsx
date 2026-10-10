// Owner: sidebar agent. The folded sidebar with a thread open: a small card in the top-left corner with the step the
// thread is on (the newest one while it follows live), a dot for its state (the thread bar names it). Clicking
// it, or T, unfolds the sidebar. Scrolling on it steps through the thread as the Track's list does, folded: up goes
// back (the replay's player opens, paused, the map's marker on that step), down comes forward, and back at the newest
// step a running thread follows live again (App's LiveFollow). On a small map it keeps you up to date without covering
// the map.
import { useEffect, useRef } from "react";
import { useNavActions, useNavState, useReplayCursor } from "../../lib/nav";
import { useLiveSelector } from "../../lib/live";
import { beatLabel, useThread } from "../../lib/thread";
import { injectedLabel } from "../../lib/chapters";
import { attentionText, needsYou, yourTurn } from "../../lib/attention";
import { displayLabel, isVisible } from "../../follow/format";

export function NowCard({ onOpen }: { onOpen: () => void }) {
  const { replay } = useNavState();
  const sid = replay?.sessionId ?? null;
  const thread = useThread(sid, replay?.detail ?? "light");
  const index = useReplayCursor((c) => c.index);
  const session = useLiveSelector((s) => (sid ? s.sessions.find((x) => x.id === sid) : undefined));
  const attn = useLiveSelector((s) => (sid ? s.attention[sid] : undefined));
  const { setReplayIndex, setThreadMode, setReplayPlaying } = useNavActions();

  // Scrolling on the card: one moment per notch (or per ~40 px of a trackpad's glide). Not the map's zoom.
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
      acc += e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY;
      const steps = Math.trunc(acc / 40);
      if (!steps) return;
      acc -= steps * 40;
      if (mode !== "play") setThreadMode("play");
      setReplayPlaying(false);
      setReplayIndex((i) => Math.max(0, Math.min(len - 1, Math.min(i, len - 1) + steps)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [!!replay, setReplayIndex, setThreadMode, setReplayPlaying]);
  if (!replay) return null;

  const beats = thread?.beats ?? [];
  const beat = beats.length ? beats[Math.min(index, beats.length - 1)] : undefined;
  // Live, the newest step itself (a moment can sum up a stretch of work: "Worked in the browser"); looking back, the
  // moment you're on, as the Track says it.
  const newest = replay.live && beat ? [...beat.steps].reverse().find(isVisible) : undefined;
  const step = newest ? injectedLabel(newest) ?? displayLabel(newest) : beat ? injectedLabel(beat.step) ?? beatLabel(beat) : "Loading its steps…";
  const failed = !!beat && beat.failed > 0;
  // Only the dot says the state (the thread bar names the thread and says when it needs you).
  const state = needsYou(attn) ? "blocked" : yourTurn(attn) ? "turn" : attn?.state === "thinking" || session?.status === "running" ? "working" : "idle";
  const said = needsYou(attn) ? attentionText(attn!).badge : yourTurn(attn) ? "Your turn" : state === "working" ? "Working" : "";
  // Looking back through it (not the newest step): say where, so the card doesn't read as what happens now.
  const back = !replay.live && beats.length > 0 && index < beats.length - 1;

  return (
    <button className="sidebar-now" ref={card} onClick={onOpen} aria-expanded={false}
      aria-label={`Open the sidebar. ${said ? `${said}. ` : ""}${back ? `Step ${index + 1}` : "Now"}: ${step}`}
      title="Scroll to step through the thread. Click to open the sidebar (T)">
      <span className={`sn-step${failed ? " failed" : ""}`}>
        <i className={`sn-dot ${state}`} aria-hidden="true" />
        {back && <small>Step {index + 1}</small>}
        <span>{step}</span>
        {failed && <small className="sn-failed">failed</small>}
      </span>
      <i className="sn-open" aria-hidden="true">›</i>
    </button>
  );
}
