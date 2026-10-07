// Owner: sidebar agent. The sidebar's Track tab: the open thread's steps, next to the map (scrolling them moves the
// tracer), or its places on the Places lens, under the thread's name (so you see which one you're tracking), what you
// can do with it (Live, Replay, Share) and, when subagents worked in it, who: everyone, or one agent on its own.
import { useState } from "react";
import { useNav } from "../../lib/nav";
import { useLiveSelector } from "../../lib/live";
import { focusAgent, useAgentFocus, useThreadAgents } from "../../lib/agentFocus";
import { useTheme } from "../../lib/theme";
import { agentColor, initial } from "../agents";
import { readTokens } from "../color";
import { ReplaySteps } from "../replay/ReplaySteps";
import { ThreadActions } from "../replay/ReplayBar";
import { PlaceSteps } from "../../cowork/PlaceSteps";

export function TrackPanel() {
  const { replay, lens } = useNav();
  const sid = replay?.sessionId;
  const session = useLiveSelector((s) => (sid ? s.sessions.find((x) => x.id === sid) : undefined));
  if (!replay) return null;
  return (
    <div className="sidebar-track">
      <h2 className="sidebar-track-title" title={session?.title}>
        <span>{session?.title || "Untitled thread"}</span>
      </h2>
      <ThreadActions />
      {lens !== "places" && <AgentPicker title={session?.title} />}
      {lens === "places" ? <PlaceSteps /> : <ReplaySteps />}
    </div>
  );
}

/** Everyone, or one agent's steps on their own (the map then shows only that agent's files). Only with subagents. */
function AgentPicker({ title }: { title?: string }) {
  const nav = useNav();
  const { replay } = nav;
  const sid = replay?.sessionId ?? null;
  const agents = useThreadAgents(sid);
  const focus = useAgentFocus(sid);
  const steps = useLiveSelector((s) => (sid ? s.steps[sid] : undefined));
  useTheme(); // the colours follow the map theme
  const accent = readTokens().accent;
  const [all, setAll] = useState(false);
  if (agents.length < 2) return null;
  const pick = (id: string | null) => focusAgent(nav, replay, steps, id === focus ? null : id);
  // Many subagents: the main agent and the two latest, the one shown on its own, and "+ N" for the rest.
  const SHORT = 3;
  const shown = all || agents.length <= SHORT + 1 ? agents : agents.filter((a, i) => i < SHORT || a.id === focus);
  return (
    <div className="track-agents" role="radiogroup" aria-label="Whose steps">
      <button role="radio" aria-checked={!focus} className={!focus ? "on" : ""} onClick={() => pick(null)}>Everyone</button>
      {shown.map((a) => {
        const name = a.name.replace(/^Subagent\s*·\s*/, "");
        return (
          <button key={a.id} role="radio" aria-checked={focus === a.id} className={focus === a.id ? "on" : ""} onClick={() => pick(a.id)}
            title={`${a.name}: ${a.steps} step${a.steps === 1 ? "" : "s"}. Click to see only its steps`}>
            <i style={{ background: agentColor(a, accent) }} aria-hidden="true">{initial(a.isSubagent ? a : { name: title ?? "", isSubagent: false })}</i>
            <span>{a.isSubagent ? name : "Main"}</span>
          </button>
        );
      })}
      {agents.length > shown.length && <button className="more" onClick={() => setAll(true)} title="Every agent of this thread">+ {agents.length - shown.length}</button>}
      {all && agents.length > SHORT + 1 && <button className="more" onClick={() => setAll(false)}>Fewer</button>}
    </div>
  );
}
