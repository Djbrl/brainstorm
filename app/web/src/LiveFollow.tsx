// Following an open thread: the replay cursor on its newest step while it runs (live), on a step just opened, or kept on
// its step while the thread grows. Mounted by the shell (App.tsx); draws nothing.
import { useEffect, useRef } from "react";
import { useLiveSelector } from "./lib/live";
import { useNavActions, useNavState, useReplayCursor } from "./lib/nav";
import { useThread, type ReplayDetail, type Thread } from "./lib/thread";

/**
 * A thread you chose to follow live stays on its newest step; a replay that reaches the end of a running thread
 * starts following it. Nothing opens or plays by itself: running threads show as moving dots until you click one.
 * The parts that build the thread are mounted only while they're needed.
 */
export function LiveFollow() {
  const { thread } = useNavState();
  const sid = thread?.sessionId;
  const running = useLiveSelector((s) => !!sid && s.sessions.find((x) => x.id === sid)?.status === "running");
  if (!thread) return null;
  // A step opened (a row, a link): the cursor lands on it first, on any lens, and only then may it follow live again.
  if (thread.atStep) return <LandStep sessionId={thread.sessionId} detail={thread.detail} stepId={thread.atStep} />;
  if (thread.live) return <FollowNewest sessionId={thread.sessionId} detail={thread.detail} />;
  // Live is a state, not a switch: a running thread you bring back to its newest step (scrolling, stepping, playing)
  // follows it live again; moving off it is looking back.
  return (
    <>
      <KeepCursor sessionId={thread.sessionId} detail={thread.detail} />
      {running && <FollowAtEnd sessionId={thread.sessionId} detail={thread.detail} />}
    </>
  );
}

/** Looking back at a growing thread, the cursor stays on its step, not on its number: when the thread is built again and
 *  its moments renumber (an edit takes in the talk before it), the cursor moves to the moment that now holds the step it
 *  was on, as LandStep does. */
function KeepCursor({ sessionId, detail }: { sessionId: string; detail: ReplayDetail }) {
  const { landReplay } = useNavActions();
  const thread = useThread(sessionId, detail);
  const index = useReplayCursor((c) => c.index);
  const was = useRef<{ thread: Thread; index: number; stepId?: string } | null>(null);
  useEffect(() => {
    const prev = was.current;
    if (!thread || thread.sessionId !== sessionId || thread.detail !== detail || !thread.beats.length) { was.current = null; return; }
    const at = Math.min(index, thread.beats.length - 1);
    if (prev && prev.thread !== thread && prev.index === index && prev.stepId && thread.beats[at]?.step.id !== prev.stepId) {
      const moved = thread.stepBeat.get(prev.stepId);
      if (moved !== undefined && moved !== at) {
        was.current = { thread, index: moved, stepId: prev.stepId };
        landReplay(moved);
        return;
      }
    }
    was.current = { thread, index, stepId: thread.beats[at]?.step.id };
  }, [thread, index, sessionId, detail, landReplay]);
  return null;
}

/** Put the cursor on the moment holding a step just opened. A step the thread doesn't hold keeps the cursor where it
 *  is (not the thread's start). Until it lands, nothing pulls it back to live: a link to a step of a running thread used
 *  to open on the step and show the newest one, the panel and the Track on two different moments. */
function LandStep({ sessionId, detail, stepId }: { sessionId: string; detail: ReplayDetail; stepId: string }) {
  const { landReplay } = useNavActions();
  const thread = useThread(sessionId, detail);
  const index = useReplayCursor((c) => c.index);
  useEffect(() => {
    if (!thread || thread.sessionId !== sessionId || thread.detail !== detail || !thread.beats.length) return;
    landReplay(thread.stepBeat.get(stepId) ?? Math.min(index, thread.beats.length - 1));
  }, [thread, sessionId, detail, stepId]);
  return null;
}

/** Following live: keep the cursor on the newest beat as the thread grows. */
function FollowNewest({ sessionId, detail }: { sessionId: string; detail: ReplayDetail }) {
  const { followLive } = useNavActions();
  const beats = useThread(sessionId, detail)?.beats.length ?? 0;
  useEffect(() => { if (beats) followLive(beats - 1); }, [beats, followLive]);
  return null;
}

/** A running thread you look back through: once the cursor is back on its last beat (and not playing), follow it live. */
function FollowAtEnd({ sessionId, detail }: { sessionId: string; detail: ReplayDetail }) {
  const { setReplayLive } = useNavActions();
  const all = useThread(sessionId, detail);
  const last = all ? all.beats.length - 1 : -1;
  const atEnd = useReplayCursor((c) => last >= 0 && c.index >= last && !c.playing);
  useEffect(() => { if (atEnd) setReplayLive(true); }, [atEnd, setReplayLive]);
  return null;
}
