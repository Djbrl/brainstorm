// The map's floating footer, a slim timeline shown while you replay (Space plays and pauses, Esc leaves); and the share
// menu, beside the open thread's title in the sidebar. No play button and no speeds: Space plays, and scrolling the
// steps is the fast-forward. The timeline is ‹ › and a scrubber cut by chapter (red where one failed). The step panel
// follows the cursor, the camera recenters itself, "Every step" is under the step list.
import { memo, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useNavActions, useNavState, useReplay } from "../../lib/nav";
import { useThread, type Thread } from "../../lib/thread";
import { useLiveSelector } from "../../lib/live";
import { useShortcut } from "../../switch/shortcuts";
import { chaptersOf } from "../../lib/chapters";
import { CompactBar } from "../../switch/CompactBar";
import "./replay.css";
import "../dock.css";

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
export function ShareMenu({ sessionId, className = "track-share" }: { sessionId: string; className?: string }) {
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

/** `steps`, given: ‹ › go by those instead of the thread's moments (Places: by place), `at` of `count`. */
type Steps = { at: number; count: number; go: (i: number) => void; noun: string };

function Player({ steps }: { steps?: Steps }) {
  const replay = useReplay();
  const { setReplayIndex, setReplayPlaying } = useNavActions();
  const thread = useThread(replay?.sessionId ?? null, replay?.detail ?? "light");
  if (!replay || !thread || !thread.beats.length) return null;
  const len = thread.beats.length;
  const index = Math.min(replay.index, len - 1);
  const set = (i: number) => { setReplayPlaying(false); setReplayIndex(Math.max(0, Math.min(len - 1, i))); };
  const pct = len > 1 ? (index / (len - 1)) * 100 : 100;
  return (
    <div className="rp-player" role="region" aria-label={replay.playing ? "Replay, playing (Space pauses)" : "Replay (Space plays)"}>
      {steps
        ? <button className="rp-icon" onMouseDown={keepFocus} onClick={() => steps.go(steps.at - 1)} disabled={steps.at <= 0} aria-label={`Previous ${steps.noun}`} title={`Previous ${steps.noun} (←)`}>{Icon.back}</button>
        : <button className="rp-icon" onMouseDown={keepFocus} onClick={() => set(index - 1)} disabled={index === 0} aria-label="Previous step" title="Previous step (←)">{Icon.back}</button>}
      <div className="rp-slider" style={{ ["--rp-pct" as string]: `${pct}%` }}>
        <ChapterMarks thread={thread} />
        <input type="range" min={0} max={len - 1} step={1} value={index} aria-label="Replay position"
          aria-valuetext={`${index + 1} of ${len}`} onChange={(e) => set(Number(e.target.value))}
          onPointerUp={(e) => e.currentTarget.blur()} /> {/* dragged, it lets go of the keys: Space plays again, ← → step */}
      </div>
      {steps
        ? <button className="rp-icon" onMouseDown={keepFocus} onClick={() => steps.go(steps.at + 1)} disabled={steps.at >= steps.count - 1} aria-label={`Next ${steps.noun}`} title={`Next ${steps.noun} (→)`}>{Icon.fwd}</button>
        : <button className="rp-icon" onMouseDown={keepFocus} onClick={() => set(index + 1)} disabled={index >= len - 1} aria-label="Next step" title="Next step (→)">{Icon.fwd}</button>}
    </div>
  );
}

/** A click that doesn't take the focus: Space keeps playing and pausing instead of pressing the button again. */
const keepFocus = (e: ReactMouseEvent) => e.preventDefault();

/**
 * Looking back through the open thread (the map shows where its agent was then): a small pill to the present, its
 * newest step, followed live again while it runs. End does the same. The sidebar's footer says the same words.
 */
function BackToNow() {
  const replay = useReplay();
  const { setReplayIndex, setReplayLive, setReplayPlaying } = useNavActions();
  const thread = useThread(replay?.sessionId ?? null, replay?.detail ?? "light");
  const running = useLiveSelector((s) => !!replay && s.sessions.find((x) => x.id === replay.sessionId)?.status === "running");
  const len = thread?.sessionId === replay?.sessionId ? thread?.beats.length ?? 0 : 0;
  const back = !!replay && !replay.live && !replay.atStep && len > 0 && (replay.index < len - 1 || running);
  const go = () => { setReplayPlaying(false); setReplayIndex(len - 1); if (running) setReplayLive(true); };
  useShortcut("now", (e) => { if (!back || e?.key !== "End") return false; go(); });
  if (!back) return null;
  return <button className="rp-now" onMouseDown={keepFocus} onClick={go} title="Back to the newest step (End)">Back to now</button>;
}

/**
 * The footer. On a full screen, only the player, while replaying. Share sits by the thread's title in the sidebar's
 * Track; the map's switches are in Settings and on keys (L, M). On Places its ‹ › go place by place (CoworkView).
 * On a small window (1100 px and below) no player: the compact bar instead (switch/CompactBar.tsx, map/dock.css).
 */
export function Dock({ steps, player = true }: { steps?: Steps; player?: boolean } = {}) {
  const { thread, lens } = useNavState();
  return <div className="dock">{lens === "map" && <BackToNow />}{player && thread?.mode === "play" && <Player steps={steps} />}<CompactBar /></div>;
}
