// The live agents the map draws (moved out of MapView.tsx): who is shown, who waits on you, their markers'
// animation state (agents.tsx keeps it in `anim`), and whether any of them is still moving.
import { useCallback, useMemo, useRef } from "react";
import type { AgentPresence, Attention } from "@contract";
import { clock } from "../lib/live";
import { attentionText, needsYou } from "../lib/attention";
import { agentAlpha, visibleAgents, type AgentAnim } from "./agents";
import { mapStyle, tripMs } from "./themes";


export function useLiveAgents({ agents: live, attention, hiddenAgents, threadId, liveThread }: {
  agents: Record<string, AgentPresence> | undefined; attention: Record<string, Attention>;
  hiddenAgents: ReadonlySet<string>; threadId: string | null; liveThread: boolean;
}) {
  // An agent waiting on you stays on the map however long it waits; one thinking (mid-turn, nothing logged yet) too.
  const waitingIds = useMemo(() => new Set(Object.values(attention).filter(needsYou).map((a) => a.agentId ?? a.sessionId)), [attention]);
  const thinking = useMemo(() => new Set(Object.values(attention).filter((a) => a.state === "thinking").map((a) => a.sessionId)), [attention]);
  const thinkingRef = useRef(thinking); thinkingRef.current = thinking;
  const agents: AgentPresence[] = useMemo(() => {
    const all = Object.values(live ?? {});
    const shown = new Set(visibleAgents(all));
    return all.filter((a) => shown.has(a) || waitingIds.has(a.id) || thinking.has(a.id) || (!!threadId && a.sessionId === threadId));
  }, [live, waitingIds, thinking, threadId]); // the open thread's agents stay, where they last were
  // Hidden agents (sidebar toggles) are not drawn. With a thread open: its own agents (main and subagents, each in its
  // colour) while it's followed live; none while you move through its past (the replay's cursor is the marker then).
  const drawnAgents = useMemo(() => agents.filter((a) => !hiddenAgents.has(a.id) && (!threadId || (liveThread && a.sessionId === threadId))),
    [agents, hiddenAgents, threadId, liveThread]);
  // Agents waiting on you (attention): agent id → label. A subagent waits under its own id, a main thread under the session's.
  const waiting = useMemo(() => new Map(Object.values(attention).filter(needsYou).map((a) => [a.agentId ?? a.sessionId, attentionText(a).badge === "Stuck" ? "Stuck" : `Needs you · ${attentionText(a).title.toLowerCase()}`])), [attention]);
  const waitingRef = useRef(waiting); waitingRef.current = waiting;
  const agentsRef = useRef(drawnAgents); agentsRef.current = drawnAgents;
  const anim = useRef(new Map<string, AgentAnim>());
  const keepRef = useRef(!!threadId); keepRef.current = !!threadId;

  /** Whether the live agents are still moving: a glide, a fade, a read's line, a pulse, a red flash, a wait's breath. */
  const moving = useCallback((t: number) => {
    const now = clock(), route = mapStyle().route;
    for (const a of agentsRef.current) {
      const st = anim.current.get(a.id);
      if (!st) continue;   // not on the map (its file isn't a node)
      if (t - st.t0 < tripMs(route, 650) + 50 || st.flashes.length || t - st.pulseT0 < 700 || t - st.errT0 < 2600 || waitingRef.current.has(a.id) || thinkingRef.current.has(a.id) || st.easing) return true;
      const target = agentAlpha(a, now, waitingRef.current.has(a.id) || thinkingRef.current.has(a.id), keepRef.current);
      if (Math.abs(target - st.alpha) > 0.01) return true;
    }
    return false;
  }, []);

  return { agents, drawnAgents, waiting, waitingRef, thinkingRef, agentsRef, anim, moving };
}
