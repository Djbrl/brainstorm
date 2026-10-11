// On a small map, an open thread followed live: the camera follows its agent up close by itself (the
// readmap shows the rest). It follows the agent at work: the main one, or a subagent while the main one waits on it,
// switching at most every few seconds. Pick an agent yourself (the Readmap, A, the sidebar), stop following (Esc, the
// arrow keys, a click on the Readmap) or open another thread, and it lets you: until the next thread, it doesn't take
// the camera back.
import { useEffect, useRef } from "react";
import type { AgentPresence } from "@contract";

const SWITCH_MS = 6000;   // the least time on one agent before following another one

export function useAutoTrack({ on, sessionId, agents, followId, setFollowId }: {
  /** A small map with a thread open and followed live. */
  on: boolean;
  sessionId: string | null;
  /** The open thread's agents on the map. */
  agents: AgentPresence[];
  followId: string | null;
  setFollowId: (id: string | null) => void;
}) {
  const st = useRef({ key: null as string | null, mine: null as string | null, off: false, at: 0 });
  useEffect(() => {
    const s = st.current, key = on ? sessionId : null, fresh = key !== s.key;
    if (fresh) { s.key = key; s.mine = null; s.off = false; }
    if (!key || s.off) return;
    // Someone else picked (or let go): it's theirs now. Not on the thread's first run: what's followed then is from
    // before (the camera lets go of it as the thread opens).
    if (!fresh && s.mine && followId !== s.mine) { s.off = true; s.mine = null; return; }
    if (!fresh && !s.mine && followId) { s.off = true; return; }
    const now = Date.now(), at = (a: AgentPresence) => Date.parse(a.ts) || 0;
    const busy = agents.filter((a) => a.active).sort((a, b) => at(b) - at(a));
    const main = agents.find((a) => a.id === key);
    // The main agent while it works; else the subagent that moved last; else the main one where it stopped.
    const want = (main?.active ? main : busy[0]) ?? main ?? agents[0];
    if (!want || want.id === s.mine) return;
    const cur = agents.find((a) => a.id === s.mine);
    if (cur?.active && now - s.at < SWITCH_MS) return;
    s.mine = want.id; s.at = now;
    setFollowId(want.id);
  }, [on, sessionId, agents, followId, setFollowId]);
}
