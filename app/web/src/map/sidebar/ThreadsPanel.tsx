// Owner: sidebar agent. Threads tab: every thread; clicking one plays it (a running one live) and opens its step list
// (or its places, in the Places view), which fills the sidebar's height; clicking it again closes it.
// Agents: follow the camera, show/hide. With a thread open, its agents fold into one row so the steps keep their room:
// opening the agents folds the steps, and the other way round. The eye in the title row shows or hides all its agents.
import { useEffect, useState } from "react";
import type { AgentPresence, Session } from "@contract";
import { clock, useLive } from "../../lib/live";
import { useNav } from "../../lib/nav";
import { agentColor, baseName, initial, shortName, verbIng } from "../agents";
import { ThreadCard } from "./ThreadCard";
import { ReplaySteps } from "../replay/ReplaySteps";
import { PlaceSteps } from "../../cowork/PlaceSteps";

function useTick(ms: number) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

function ago(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 10) return "now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true" fill="none">
      <path d="M2 10s3-5.5 8-5.5 8 5.5 8 5.5-3 5.5-8 5.5-8-5.5-8-5.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <circle cx="10" cy="10" r="2.3" stroke="currentColor" strokeWidth="1.4" />
      {off && <line x1="3" y1="17" x2="17" y2="3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />}
    </svg>
  );
}

export function ThreadsPanel({ agents, accent, followId, onFollow, onFocusFile }: {
  agents: AgentPresence[];
  accent: string;
  followId: string | null;
  onFollow: (id: string | null) => void;
  onFocusFile: (path: string) => void;
}) {
  useTick(5000);
  const now = clock();
  const { state } = useLive();
  const { replay, hiddenAgents, toggleAgent, setHiddenAgents, startReplay, stopReplay } = useNav();
  const [all, setAll] = useState(false);

  const sessions = [...state.sessions].sort((a, b) => {
    const running = (a.status === "running" ? 0 : 1) - (b.status === "running" ? 0 : 1);
    return running !== 0 ? running : b.lastEventAt.localeCompare(a.lastEventAt);
  });

  if (sessions.length === 0) {
    return <p className="sidebar-empty">No agent threads yet. Start Claude Code in this project.</p>;
  }

  // Clicking a thread opens its footprint (what it touched); its steps and its replay are one click further.
  const select = (s: Session) => {
    if (replay?.sessionId === s.id) { stopReplay(); return; } // clicking the open thread closes it
    startReplay(s.id, 0, { live: s.status === "running" });
  };
  // The most recent few; the rest behind "Show all" (the open thread always shows).
  const SHORT = 5;
  const shown = all || sessions.length <= SHORT + 1 ? sessions : sessions.filter((x, i) => i < SHORT || x.id === replay?.sessionId);

  return (
    <div className={`sidebar-threads ${replay ? "has-open" : ""}`}>
      <ul className="sidebar-thread-list">
        {shown.map((session) => {
          const selected = replay?.sessionId === session.id;
          return (
            <ThreadRow
              key={session.id}
              session={session}
              selected={selected}
              agents={agents.filter((a) => a.sessionId === session.id)}
              accent={accent}
              followId={followId}
              onFollow={onFollow}
              onFocusFile={onFocusFile}
              hiddenAgents={hiddenAgents}
              toggleAgent={toggleAgent}
              setHiddenAgents={setHiddenAgents}
              now={now}
              onSelect={() => select(session)}
            />
          );
        })}
      </ul>
      {sessions.length > shown.length && <button className="sidebar-more" onClick={() => setAll(true)}>Show all {sessions.length} threads</button>}
      {all && sessions.length > SHORT + 1 && <button className="sidebar-more" onClick={() => setAll(false)}>Show fewer</button>}
    </div>
  );
}

function ThreadRow({ session, selected, agents, accent, followId, onFollow, onFocusFile, hiddenAgents, toggleAgent, setHiddenAgents, now, onSelect }: {
  session: Session;
  selected: boolean;
  agents: AgentPresence[];
  accent: string;
  followId: string | null;
  onFollow: (id: string | null) => void;
  onFocusFile: (path: string) => void;
  hiddenAgents: ReadonlySet<string>;
  toggleAgent: (id: string) => void;
  setHiddenAgents: (ids: Iterable<string>) => void;
  now: number;
  onSelect: () => void;
}) {
  const sorted = [...agents].sort((a, b) => (a.isSubagent ? 1 : 0) - (b.isSubagent ? 1 : 0) || a.id.localeCompare(b.id));
  const running = session.status === "running";
  // Which git worktree the thread ran in ("hackathon-landing-page", without Claude Code's random suffix).
  const tree = /\/\.claude\/worktrees\/([^/]+)/.exec(session.cwd ?? "")?.[1]?.replace(/-[0-9a-f]{6}$/, "");
  const { lens, replay } = useNav();
  const mode = selected ? replay?.mode ?? "footprint" : "footprint";
  const [agentsOpen, setAgentsOpen] = useState(false);
  useEffect(() => { if (!selected) setAgentsOpen(false); }, [selected]);
  const ids = sorted.map((a) => a.id);
  const allHidden = ids.length > 0 && ids.every((id) => hiddenAgents.has(id));
  const toggleAll = () => setHiddenAgents(allHidden ? [...hiddenAgents].filter((id) => !ids.includes(id)) : [...hiddenAgents, ...ids]);
  const working = sorted.filter((a) => a.active).length;
  return (
    <li className={`sidebar-thread ${selected ? "selected" : ""} ${selected && mode === "footprint" && lens !== "places" ? "footprint" : ""}`}>
      <div className="sidebar-thread-headrow">
        <button className="sidebar-thread-head" onClick={onSelect} aria-pressed={selected} title={selected ? "Close this thread" : "Open this thread: what it touched"}>
          <span className={`sidebar-thread-status ${session.status}`} aria-hidden="true" />
          <span className="sidebar-thread-title">{session.title || "Untitled thread"}</span>
          {tree && <span className="sidebar-thread-tree" title={session.cwd}>{tree}</span>}
          <time>{running ? "live" : ago(session.lastEventAt, now)}</time>
        </button>
        {ids.length > 0 && (
          <button className="sidebar-agent-eye" onClick={toggleAll} aria-label={allHidden ? "Show this thread's agents on the map" : "Hide this thread's agents from the map"} title={allHidden ? "Show its agents" : "Hide its agents"}>
            <EyeIcon off={allHidden} />
          </button>
        )}
      </div>
      {selected && sorted.length > 0 && (
        <button className="sidebar-fold" onClick={() => setAgentsOpen((o) => !o)} aria-expanded={agentsOpen}>
          <span className="sidebar-fold-avatars" aria-hidden="true">
            {sorted.slice(0, 5).map((a) => <i key={a.id} style={{ background: agentColor(a, accent) }}>{initial(a)}</i>)}
          </span>
          <span className="sidebar-fold-text">{sorted.length} agent{sorted.length > 1 ? "s" : ""}{working ? `, ${working} working` : ""}</span>
          <i className={`sidebar-tree-caret ${agentsOpen ? "open" : ""}`} aria-hidden="true">›</i>
        </button>
      )}
      {sorted.length > 0 && selected && agentsOpen && (
        <ul className="sidebar-thread-agents">
          {sorted.map((a) => {
            const following = followId === a.id;
            const hidden = hiddenAgents.has(a.id);
            const name = shortName(a, 22);
            return (
              <li key={a.id} className={`${following ? "following" : ""} ${hidden ? "hidden-agent" : ""}`}>
                <button className="sidebar-agent-main" onClick={() => onFollow(following ? null : a.id)} title={following ? "Stop following" : "Follow this agent"}>
                  <i className="sidebar-agent-avatar" style={{ background: agentColor(a, accent) }}>{initial(a)}</i>
                  <span className="sidebar-agent-text">
                    <span className="sidebar-agent-name">{name}</span>
                    <span className="sidebar-agent-doing">
                      {verbIng(a.action)}
                      {a.file && (
                        <>
                          {" "}
                          <button onClick={(e) => { e.stopPropagation(); onFocusFile(a.file!); }}>{baseName(a.file)}</button>
                        </>
                      )}
                    </span>
                  </span>
                </button>
                <button className="sidebar-agent-eye" onClick={() => toggleAgent(a.id)} aria-label={hidden ? `Show ${name} on the map` : `Hide ${name} from the map`} title={hidden ? "Show on map" : "Hide from map"}>
                  <EyeIcon off={hidden} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {selected && !agentsOpen && lens !== "places" && mode === "footprint" && <ThreadCard session={session} />}
      {selected && (agentsOpen
        ? <button className="sidebar-fold" onClick={() => setAgentsOpen(false)}><span className="sidebar-fold-text">{lens === "places" ? "Places" : mode === "footprint" ? "Summary" : "Steps"}</span><i className="sidebar-tree-caret" aria-hidden="true">›</i></button>
        : (lens === "places" || mode !== "footprint") && <div className="sidebar-replay-steps sidebar-thread-steps">{lens === "places" ? <PlaceSteps /> : <ReplaySteps />}</div>)}
    </li>
  );
}
