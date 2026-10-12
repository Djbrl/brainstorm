// One agent of a thread on its own: its steps in the Track, its files on the map, its moments in the player. A thread's
// steps interleave the main agent's and its subagents'; every view builds the thread through useThread, which reads
// this, so they all agree. Not saved: opening another thread shows everyone again.
import { useMemo } from "react";
import type { AgentPresence, Step } from "@contract";
import { useLiveSelector, useThreadSteps } from "./live";
import { createAtom, useStoreSelector } from "./store";
import { END, type NavActions, type OpenThread } from "./nav";

type Focus = { sessionId: string; agent: string } | null;
const focus = createAtom<Focus>(null);

/** Who made a step: the subagent's id, or the session's id for the main agent (as AgentPresence ids are). */
export const streamOf = (s: Pick<Step, "agentId" | "isSubagent">, sessionId: string) => s.agentId ?? (s.isSubagent ? "sub" : sessionId);

export function setAgentFocus(sessionId: string, agent: string | null) {
  const next: Focus = agent ? { sessionId, agent } : null;
  const now = focus.get();
  if (next?.sessionId === now?.sessionId && next?.agent === now?.agent) return;
  focus.set(next);
}
/** The agent shown on its own in this thread, or null for everyone. */
export const agentFocusOf = (sessionId: string | null) => { const f = focus.get(); return sessionId && f?.sessionId === sessionId ? f.agent : null; };
export const useAgentFocus = (sessionId: string | null) => useStoreSelector(focus, () => agentFocusOf(sessionId));

/** One agent's steps, the same list each time for the same steps (so a thread built from it is reused). */
const only = new WeakMap<Step[], Map<string, Step[]>>();
export function stepsOf(steps: Step[], sessionId: string, agent: string): Step[] {
  let m = only.get(steps);
  if (!m) only.set(steps, (m = new Map()));
  let out = m.get(agent);
  if (!out) m.set(agent, (out = steps.filter((s) => streamOf(s, sessionId) === agent)));
  return out;
}

export type ThreadAgent = { id: string; isSubagent: boolean; name: string; steps: number };

const key = (t: string) => t.replace(/\s+/g, " ").trim();

/** A subagent's name from its first prompt (the task it was given), when the live agents don't know it. */
function taskName(text: string | undefined): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  return t ? `Subagent · ${t.length > 40 ? t.slice(0, 39).trimEnd() + "…" : t}` : "Subagent";
}

/** The agents of a thread, main first then its subagents (latest started first), with their names. */
export function useThreadAgents(sessionId: string | null): ThreadAgent[] {
  const steps = useThreadSteps(sessionId); // held: the picker can show with no other view holding the thread
  const live = useLiveSelector((s) => s.agents);
  return useMemo(() => {
    if (!sessionId || !steps) return [];
    // The main agent starts each subagent with a short description and a prompt; the subagent's log opens with that
    // prompt: matched on it, the subagent gets the description as its name.
    const named = new Map<string, string>();
    for (const s of steps) {
      if (s.kind !== "tool_call" || (s.tool !== "Task" && s.tool !== "Agent")) continue;
      const i = s.input as { description?: unknown; prompt?: unknown } | undefined;
      if (typeof i?.prompt === "string" && typeof i.description === "string") named.set(key(i.prompt), i.description);
    }
    const by = new Map<string, ThreadAgent>();
    for (const s of steps) {
      const id = streamOf(s, sessionId);
      let a = by.get(id);
      if (!a) {
        const known = (live as Record<string, AgentPresence> | undefined)?.[id];
        a = { id, isSubagent: id !== sessionId, steps: 0, name: id === sessionId ? "Main agent"
          : known?.name ?? (s.kind === "prompt" && named.has(key(s.text ?? "")) ? `Subagent · ${named.get(key(s.text ?? ""))}` : taskName(s.kind === "prompt" ? s.text : undefined)) };
        by.set(id, a);
      }
      a.steps++;
    }
    // Main first, then the subagents, the latest started first (the ones at work now are usually those).
    const all = [...by.values()];
    return [...all.filter((a) => !a.isSubagent), ...all.filter((a) => a.isSubagent).reverse()];
  }, [sessionId, steps, live]);
}

/**
 * Show one agent on its own (null: everyone again), keeping your place: the step you're on if it's theirs, else their
 * last one. A thread followed live keeps following (now their newest step).
 */
export function focusAgent(
  nav: Pick<NavActions, "setReplayDetail" | "landReplay" | "cursorStep">, replay: Pick<OpenThread, "sessionId" | "live" | "detail"> | null, steps: Step[] | undefined, agent: string | null,
) {
  if (!replay) return;
  const sid = replay.sessionId;
  setAgentFocus(sid, agent);
  if (replay.live) return;
  const cur = nav.cursorStep(), at = cur ? steps?.find((s) => s.id === cur) : undefined;
  if (at && (!agent || streamOf(at, sid) === agent)) nav.setReplayDetail(replay.detail, at.id);
  else nav.landReplay(END);   // past their last step: the replay layer brings it back to it
}
