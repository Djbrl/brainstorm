// Owner: sidebar agent. The open thread, in the sidebar's Threads tab (a back arrow to the list): its steps, next to the map (scrolling them moves the
// tracer), or its places on the Places lens, under the thread's name (with Share) and, when
// subagents worked in it, who: everyone, or one agent on its own. Live isn't a button: a running thread follows its
// newest step until you move off it (then a footer offers the way back), and follows again once you're back on it
// (App's LiveFollow). Space replays.
import { useEffect, useRef, useState } from "react";
import { useNav } from "../../lib/nav";
import { useLiveSelector } from "../../lib/live";
import { focusAgent, useAgentFocus, useThreadAgents } from "../../lib/agentFocus";
import { useTheme } from "../../lib/theme";
import { agentColor, initial } from "../agents";
import { readTokens } from "../color";
import { ReplaySteps } from "../replay/ReplaySteps";
import { ShareMenu } from "../replay/ReplayBar";
import { isReplay } from "../../lib/live";
import { PlaceSteps } from "../../cowork/PlaceSteps";

export function TrackPanel({ onBack }: { onBack?: () => void }) {
  const nav = useNav();
  const { replay, lens } = nav;
  const sid = replay?.sessionId;
  const session = useLiveSelector((s) => (sid ? s.sessions.find((x) => x.id === sid) : undefined));
  if (!replay) return null;
  return (
    <div className="sidebar-track">
      <div className="track-head">
        {onBack && (
          <button className="track-back" onClick={onBack} aria-label="All threads" title="All threads (the thread stays open on the map)">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10 3.5L5.5 8l4.5 4.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        )}
        <h2 className="sidebar-track-title" title={session?.title}>{session?.title || "Untitled thread"}</h2>
        {!isReplay() && <ShareMenu sessionId={replay.sessionId} className="track-share" />}
      </div>
      {lens !== "places" && <AgentPicker title={session?.title} />}
      {lens === "places" ? <PlaceSteps /> : <ReplaySteps />}
      {session?.status === "running" && !replay.live && replay.mode !== "play" && <BackToLive onBack={() => nav.setReplayLive(true)} />}
    </div>
  );
}

/**
 * A running thread you're looking back through: a footer floating over the bottom of the steps takes you back to its
 * newest step. At the end, nothing: the thread just follows live (its dot pulses in the list and the tab bar).
 */
function BackToLive({ onBack }: { onBack: () => void }) {
  return (
    <div className="track-back-live" role="status">
      <span><i aria-hidden="true" />This thread is live</span>
      <button onClick={onBack}>Back to live <span aria-hidden="true">↓</span></button>
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
  // One row that scrolls sideways (a wheel scrolls it too), an edge fading where more agents hide; the one picked is
  // kept in view.
  const row = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ left: false, right: false });
  const measure = () => {
    const el = row.current;
    if (el) setMore({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
  };
  useEffect(() => {
    row.current?.querySelector(".on")?.scrollIntoView({ block: "nearest", inline: "nearest" });
    measure();
  }, [focus, agents.length]);
  if (agents.length < 2) return null;
  const pick = (id: string | null) => focusAgent(nav, replay, steps, id === focus ? null : id);
  return (
    <div className={`track-agents${more.left ? " more-left" : ""}${more.right ? " more-right" : ""}`} role="radiogroup" aria-label="Whose steps"
      ref={row} onScroll={measure} onWheel={(e) => { const el = row.current; if (el && Math.abs(e.deltaY) > Math.abs(e.deltaX)) el.scrollLeft += e.deltaY; }}>
      <button role="radio" aria-checked={!focus} className={!focus ? "on" : ""} onClick={() => pick(null)}>Everyone</button>
      {agents.map((a) => {
        const name = a.name.replace(/^Subagent\s*·\s*/, "");
        return (
          <button key={a.id} role="radio" aria-checked={focus === a.id} className={focus === a.id ? "on" : ""} onClick={() => pick(a.id)}
            title={`${a.name}: ${a.steps} step${a.steps === 1 ? "" : "s"}. Click to see only its steps`}>
            <i style={{ background: agentColor(a, accent) }} aria-hidden="true">{initial(a.isSubagent ? a : { name: title ?? "", isSubagent: false })}</i>
            <span>{a.isSubagent ? name : "Main"}</span>
          </button>
        );
      })}
    </div>
  );
}
