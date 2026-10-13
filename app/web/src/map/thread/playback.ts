// The replay's playback and keys (moved out of ThreadLayer.ts): the timer that steps through the thread while it plays, at a
// pace per kind of moment; Space plays from where you are (with a thread open on the map); in the player ← → step and
// Home / End go to the ends. Outside the player the arrows move the map (useCameraKeys).
import { useEffect, useRef, type RefObject } from "react";
import type { ThreadReplay } from "../../lib/nav";
import type { Thread } from "../../lib/thread";
import { useShortcut } from "../../switch/shortcuts";

const OTHER_MS = 120;       // playback pace for single "other" steps (every-step detail)
const SUMMARY_MS = 380;     // playback pace for summary beats (light detail)
const READ_MS = 520;        // playback pace for reads
const STEP_MS = 700;        // playback pace for edits and your prompts (scrolling the steps is the fast-forward)

type SetIndex = (i: number | ((i: number) => number)) => void;

export function useReplayPlayback({ active, replay, thread, index, last, st, setReplayIndex, setReplayPlaying }: {
  active: boolean; replay: ThreadReplay | null; thread: Thread | null; index: number; last: number;
  /** Where the replay is now (read by the keys). */
  st: RefObject<{ active: boolean; mode: string; index: number; len: number }>;
  setReplayIndex: SetIndex; setReplayPlaying: (p: boolean) => void;
}) {
  useEffect(() => {
    if (!active || !replay?.playing) return;
    if (index >= last) { setReplayPlaying(false); return; }
    const cur = thread!.beats[index];
    const base = cur.kind === "summary" ? SUMMARY_MS : cur.action === "read" ? READ_MS : cur.kind === "step" && cur.action === "other" ? OTHER_MS : STEP_MS;
    const t = setTimeout(() => setReplayIndex((i) => Math.min(last, i + 1)), base);
    return () => clearTimeout(t);
  }, [active, replay?.playing, index, last, thread, setReplayIndex, setReplayPlaying]);

  const replayPlayingRef = useRef(false);
  replayPlayingRef.current = !!replay?.playing;
  const inPlayer = () => st.current.active && st.current.mode === "play";
  useShortcut("play", (e) => {
    if (!st.current.active || (e?.target as HTMLElement | null)?.tagName === "BUTTON") return false; // let the focused button click
    togglePlay(replayPlayingRef.current, setReplayPlaying, st.current.index >= st.current.len - 1, () => setReplayIndex(0));
  });
  useShortcut("player.step", (e) => {
    if (!inPlayer() || !e) return false;
    const d = (e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 10 : 1);
    setReplayPlaying(false); setReplayIndex((i) => Math.max(0, Math.min(st.current.len - 1, i + d)));
  });
  useShortcut("player.ends", (e) => {
    if (!inPlayer() || !e) return false;
    setReplayPlaying(false); setReplayIndex(e.key === "Home" ? 0 : st.current.len - 1);
  });
}

/**
 * Play/pause from the step you're on. At the last one, play starts again from the first (`restart` goes there). Shared
 * by the keyboard and Places' own Space.
 */
export function togglePlay(playing: boolean, setPlaying: (p: boolean) => void, atEnd = false, restart?: () => void) {
  if (!playing && atEnd) restart?.();
  setPlaying(!playing);
}
