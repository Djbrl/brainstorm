// Owner: replay agent. The map's floating footer: Replay and the legend in one pill, and the player above it when you
// ask for it. The player is only what playing needs: back, play, forward, a timeline cut by chapter (red where one
// failed), speed and hide. The rest moved: the step panel follows the cursor (no "Open step"), the camera recenters
// itself, "Every step" is under the step list, and Share is on the thread's card.
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNav, type ReplaySpeed } from "../../lib/nav";
import { useThread, type Thread } from "../../lib/thread";
import { chaptersOf } from "../../lib/chapters";
import { togglePlay } from "./layer";
import "./replay.css";

const SPEEDS: ReplaySpeed[] = [1, 2, 4];
const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export const Icon = {
  play: <svg width="16" height="16" viewBox="0 0 16 16"><path d="M5 3.2v9.6L12.8 8z" fill="currentColor" /></svg>,
  pause: <svg width="16" height="16" viewBox="0 0 16 16"><path d="M5 3.5v9M11 3.5v9" {...P} strokeWidth={2.4} /></svg>,
  back: <svg width="16" height="16" viewBox="0 0 16 16"><path d="M10 3.5L5.5 8l4.5 4.5" {...P} /></svg>,
  fwd: <svg width="16" height="16" viewBox="0 0 16 16"><path d="M6 3.5L10.5 8 6 12.5" {...P} /></svg>,
  close: <svg width="14" height="14" viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" {...P} /></svg>,
  small: <svg width="11" height="11" viewBox="0 0 12 12"><path d="M3 1.8v8.4L10.2 6z" fill="currentColor" /></svg>,
};

/** A mark where each chapter starts (red if something failed in it): the timeline reads as your messages. */
const ChapterMarks = memo(function ChapterMarks({ thread }: { thread: Thread }) {
  const marks = useMemo(() => {
    const n = Math.max(1, thread.beats.length - 1);
    return chaptersOf(thread).map((c) => ({ x: (c.first / n) * 100, failed: c.failed > 0, key: c.first }));
  }, [thread]);
  return (
    <div className="rp-marks" aria-hidden="true">
      {marks.map((m) => <i key={m.key} className={m.failed ? "f" : ""} style={{ left: `${m.x}%` }} />)}
    </div>
  );
});

/** Local app: download this thread as a replay file anyone can open, or as a Markdown summary. */
export function ShareMenu({ sessionId, className = "rp-text" }: { sessionId: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(false); } };
    document.addEventListener("mousedown", away);
    window.addEventListener("keydown", esc, true); // before the app's Esc (up one level)
    return () => { document.removeEventListener("mousedown", away); window.removeEventListener("keydown", esc, true); };
  }, [open]);
  const q = `sessionId=${encodeURIComponent(sessionId)}`;
  return (
    <div className="rp-share" ref={ref}>
      <button className={className} aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((o) => !o)} title="Share this thread">Share</button>
      {open && (
        <div className="rp-share-menu" role="menu">
          <a role="menuitem" href={`/api/share?${q}`} download onClick={() => setOpen(false)}>
            <strong>Replay file</strong>
            <span>One .html file that opens in any browser, with the map, every step and the code changes.</span>
          </a>
          <a role="menuitem" href={`/api/export.md?${q}`} download onClick={() => setOpen(false)}>
            <strong>Summary</strong>
            <span>A Markdown report: what was asked, the files changed by module, what failed.</span>
          </a>
          <p className="rp-share-note">Both include this thread's prompts, messages, commands and code changes. Secrets are masked and your home folder is hidden. Screenshots are never included.</p>
        </div>
      )}
    </div>
  );
}

function Player() {
  const { replay, setReplayIndex, setReplayPlaying, setReplaySpeed, setThreadMode } = useNav();
  const thread = useThread(replay?.sessionId ?? null, replay?.detail ?? "light");
  if (!replay) return null;
  const hide = <button className="rp-icon" onClick={() => setThreadMode("steps")} aria-label="Hide the player" title="Hide the player (Esc)">{Icon.close}</button>;
  if (!thread || !thread.beats.length) {
    return <div className="rp-player rp-player-empty" role="region" aria-label="Replay"><p className="rp-empty">{thread ? "This thread has no steps yet." : "Loading the thread…"}</p>{hide}</div>;
  }
  const len = thread.beats.length;
  const index = Math.min(replay.index, len - 1);
  const set = (i: number) => { setReplayPlaying(false); setReplayIndex(Math.max(0, Math.min(len - 1, i))); };
  const pct = len > 1 ? (index / (len - 1)) * 100 : 100;
  return (
    <div className="rp-player" role="region" aria-label="Replay">
      <button className="rp-icon" onClick={() => set(index - 1)} disabled={index === 0} aria-label="Previous step" title="Previous step (←)">{Icon.back}</button>
      <button className="rp-icon rp-play" onClick={() => togglePlay(index, len, replay.playing, setReplayIndex, setReplayPlaying)}
        aria-label={replay.playing ? "Pause" : "Play"} title={replay.playing ? "Pause (Space)" : "Play (Space)"}>
        {replay.playing ? Icon.pause : Icon.play}
      </button>
      <button className="rp-icon" onClick={() => set(index + 1)} disabled={index >= len - 1} aria-label="Next step" title="Next step (→)">{Icon.fwd}</button>
      <div className="rp-slider" style={{ ["--rp-pct" as string]: `${pct}%` }}>
        <ChapterMarks thread={thread} />
        <input type="range" min={0} max={len - 1} step={1} value={index} aria-label="Replay position"
          aria-valuetext={`${index + 1} of ${len}`} onChange={(e) => set(Number(e.target.value))} />
      </div>
      <div className="rp-speed" role="group" aria-label="Speed">
        {SPEEDS.map((s) => (
          <button key={s} className={replay.speed === s ? "on" : ""} aria-pressed={replay.speed === s} onClick={() => setReplaySpeed(s)}>{s}×</button>
        ))}
      </div>
      {hide}
    </div>
  );
}

/** The footer pill: Replay (with a thread open) and the legend, which the view passes in. The player rises above it. */
export function Dock({ children }: { children: ReactNode }) {
  const { replay, setReplayIndex, setReplayPlaying, setThreadMode } = useNav();
  const thread = useThread(replay?.sessionId ?? null, replay?.detail ?? "light");
  const on = replay?.mode === "play";
  const toggle = () => {
    if (on) { setThreadMode("steps"); return; }
    const len = thread?.beats.length ?? 0;
    togglePlay(Math.min(replay?.index ?? 0, Math.max(0, len - 1)), len, false, setReplayIndex, setReplayPlaying);
  };
  return (
    <div className="dock">
      {on && <Player />}
      <div className="dock-pill">
        {replay && (
          <button className={`dock-replay${on ? " on" : ""}`} onClick={toggle} disabled={!thread?.beats.length} aria-pressed={on}>
            {Icon.small}{on ? "Hide replay" : "Replay"}
          </button>
        )}
        {children}
      </div>
    </div>
  );
}
