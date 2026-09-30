// Owner: replay agent. Bottom playback bar on the map during a thread replay.
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { isReplay, useLive } from "../../lib/live";
import { replayCursor, useNav, type ReplaySpeed } from "../../lib/nav";
import { beatLabel, useThread, type Thread } from "../../lib/thread";
import { togglePlay } from "./layer";
import { replayCamera } from "./store";
import "./replay.css";

const SPEEDS: ReplaySpeed[] = [1, 2, 4];
const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export const Icon = {
  play: <svg width="16" height="16" viewBox="0 0 16 16"><path d="M5 3.2v9.6L12.8 8z" fill="currentColor" /></svg>,
  pause: <svg width="16" height="16" viewBox="0 0 16 16"><path d="M5 3.5v9M11 3.5v9" {...P} strokeWidth={2.4} /></svg>,
  back: <svg width="16" height="16" viewBox="0 0 16 16"><path d="M10 3.5L5.5 8l4.5 4.5" {...P} /></svg>,
  fwd: <svg width="16" height="16" viewBox="0 0 16 16"><path d="M6 3.5L10.5 8 6 12.5" {...P} /></svg>,
  close: <svg width="14" height="14" viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" {...P} /></svg>,
  plus: <svg width="14" height="14" viewBox="0 0 16 16"><path d="M8 3v10M3 8h10" {...P} /></svg>,
  minus: <svg width="14" height="14" viewBox="0 0 16 16"><path d="M3 8h10" {...P} /></svg>,
  target: <svg width="14" height="14" viewBox="0 0 16 16"><circle cx="8" cy="8" r="4.2" {...P} /><path d="M8 1.5v2.3M8 12.2v2.3M1.5 8h2.3M12.2 8h2.3" {...P} /></svg>,
};

/** Small ticks under the slider where the thread edits a file. One path, so thousands of beats stay cheap. */
const EditTicks = memo(function EditTicks({ thread }: { thread: Thread }) {
  const d = useMemo(() => {
    const n = Math.max(1, thread.beats.length - 1);
    return thread.beats.filter((b) => b.action === "edit").map((b) => `M${((b.index / n) * 1000).toFixed(1)} 0v10`).join("");
  }, [thread]);
  return (
    <svg className="rp-ticks" viewBox="0 0 1000 10" preserveAspectRatio="none" aria-hidden="true">
      <path d={d} stroke="currentColor" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
});

/** Red ticks where a step failed: where to look first when something went wrong. */
const FailTicks = memo(function FailTicks({ thread }: { thread: Thread }) {
  const d = useMemo(() => {
    const n = Math.max(1, thread.beats.length - 1);
    return thread.beats.filter((b) => b.failed > 0).map((b) => `M${((b.index / n) * 1000).toFixed(1)} 0v10`).join("");
  }, [thread]);
  return (
    <svg className="rp-ticks rp-fail-ticks" viewBox="0 0 1000 10" preserveAspectRatio="none" aria-hidden="true">
      <path d={d} stroke="#d93025" strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
});

/** Local app: download this thread as a replay file anyone can open, or as a Markdown summary. */
function ShareMenu({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    document.addEventListener("mousedown", away);
    window.addEventListener("keydown", esc, true); // before the replay's own Esc (stop)
    return () => { document.removeEventListener("mousedown", away); window.removeEventListener("keydown", esc, true); };
  }, [open]);
  const q = `sessionId=${encodeURIComponent(sessionId)}`;
  return (
    <div className="rp-share" ref={ref}>
      <button className="rp-text" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((o) => !o)} title="Share this thread">Share</button>
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

export function ReplayBar() {
  const { replay: current, setReplayIndex, setReplayPlaying, setReplaySpeed, setReplayDetail, stopReplay, openStep, setSessionId, setView } = useNav();
  const { state } = useLive();
  // After the replay closes, keep showing its last state while the bar slides out.
  const last = useRef(current);
  if (current) last.current = current;
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (current) { setLeaving(false); return; }
    if (!last.current) return;
    setLeaving(true);
    const t = setTimeout(() => { last.current = null; setLeaving(false); }, 260);
    return () => clearTimeout(t);
  }, [current]);
  const replay = current ?? (leaving ? last.current : null);
  const thread = useThread(replay?.sessionId ?? null, replay?.detail ?? "light");
  if (!replay) return null;
  const cls = leaving ? " leaving" : "";

  const stop = <button className="rp-icon" onClick={stopReplay} aria-label="Stop replay" title="Stop replay (Esc)">{Icon.close}</button>;
  const session = state.sessions.find((s) => s.id === replay.sessionId);
  const title = session?.title || "Untitled thread";

  if (!thread || thread.beats.length === 0) {
    const missing = !thread && isReplay() && state.sessions.length > 0;
    return (
      <div className={`rp-bar rp-bar-empty${cls}`} role="region" aria-label="Thread replay">
        <p className="rp-empty">{thread ? "This thread has no steps yet." : missing ? "No steps were recorded for this thread." : "Loading the thread…"}</p>
        {stop}
      </div>
    );
  }

  const len = thread.beats.length;
  const index = Math.min(replay.index, len - 1);
  const beat = thread.beats[index];
  const label = beatLabel(beat);
  const full = replay.detail === "full";
  const set = (i: number) => { setReplayPlaying(false); setReplayIndex(Math.max(0, Math.min(len - 1, i))); };
  const pct = len > 1 ? (index / (len - 1)) * 100 : 100;

  return (
    <div className={`rp-bar${cls}`} role="region" aria-label="Thread replay">
      <div className="rp-top">
        <span className="rp-count">{index + 1} / {len}</span>
        <span className="rp-label" title={`${title}\n${label}`}>{label}</span>
        {beat.failed > 0 && <span className="rp-chip fail">{beat.failed} failed</span>}
        <button className={`rp-text rp-detail-toggle${full ? " on" : ""}`} aria-pressed={full}
          onClick={() => setReplayDetail(full ? "light" : "full", beat.step.id)}
          title={full ? "Back to the light replay: edits, reads and summaries" : "Show every step, including commands, messages and results"}>
          All steps
        </button>
        <button className="rp-text" onClick={() => replayCamera.recenter()} title="Follow the tracer again">{Icon.target}<span>Recenter</span></button>
        <button className="rp-text" onClick={() => { const at = replayCursor.stepId; if (at) openStep(replay.sessionId, at); else { setSessionId(replay.sessionId); setView("follow"); } }} title="Open this step in Follow">Open in Follow</button>
        {!isReplay() && <ShareMenu sessionId={replay.sessionId} />}
        {stop}
      </div>
      <div className="rp-controls">
        <div className="rp-group">
          <button className="rp-icon" onClick={() => set(index - 1)} disabled={index === 0} aria-label="Previous step" title="Previous step (←)">{Icon.back}</button>
          <button className="rp-icon rp-play" onClick={() => togglePlay(index, len, replay.playing, setReplayIndex, setReplayPlaying)}
            aria-label={replay.playing ? "Pause" : "Play"} title={replay.playing ? "Pause (Space)" : "Play (Space)"}>
            {replay.playing ? Icon.pause : Icon.play}
          </button>
          <button className="rp-icon" onClick={() => set(index + 1)} disabled={index >= len - 1} aria-label="Next step" title="Next step (→)">{Icon.fwd}</button>
        </div>
        <div className="rp-slider" style={{ ["--rp-pct" as string]: `${pct}%` }}>
          <EditTicks thread={thread} />
          <FailTicks thread={thread} />
          <input type="range" min={0} max={len - 1} step={1} value={index} aria-label="Replay position"
            aria-valuetext={`${index + 1} of ${len}: ${label}`}
            onChange={(e) => set(Number(e.target.value))} />
        </div>
        <div className="rp-speed" role="group" aria-label="Speed">
          {SPEEDS.map((s) => (
            <button key={s} className={replay.speed === s ? "on" : ""} aria-pressed={replay.speed === s} onClick={() => setReplaySpeed(s)}>{s}×</button>
          ))}
        </div>
      </div>
    </div>
  );
}
