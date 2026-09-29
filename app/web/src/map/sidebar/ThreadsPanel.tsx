// Owner: sidebar agent. Threads tab: every thread; clicking one plays it (a running one live) and opens its step list,
// which fills the sidebar's height; clicking it again closes it. Agents: follow the camera, show/hide.
import { useEffect, useState } from "react";
import type { AgentPresence, Session } from "@contract";
import { clock, useLive } from "../../lib/live";
import { useNav } from "../../lib/nav";
import { agentColor, baseName, initial, shortName, verbIng } from "../agents";
import { ReplaySteps } from "../replay/ReplaySteps";

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
  const { replay, hiddenAgents, toggleAgent, setHiddenAgents, startReplay, setReplayPlaying, stopReplay } = useNav();

  const sessions = [...state.sessions].sort((a, b) => {
    const running = (a.status === "running" ? 0 : 1) - (b.status === "running" ? 0 : 1);
    return running !== 0 ? running : b.lastEventAt.localeCompare(a.lastEventAt);
  });

  if (sessions.length === 0) {
    return <p className="sidebar-empty">No agent threads yet. Start Claude Code in this project.</p>;
  }

  const allIds = agents.map((a) => a.id);
  const allHidden = allIds.length > 0 && allIds.every((id) => hiddenAgents.has(id));

  // Clicking a thread plays it: a running thread follows its newest step, a finished one plays from the start.
  const select = (s: Session) => {
    if (replay?.sessionId === s.id) { stopReplay(); return; } // clicking the open thread closes it
    startReplay(s.id, 0, { live: s.status === "running" });
    if (s.status !== "running") setReplayPlaying(true);
  };

  return (
    <div className={`sidebar-threads ${replay ? "has-open" : ""}`}>
      {allIds.length > 0 && (
        <div className="sidebar-threads-toolbar">
          <button onClick={() => setHiddenAgents(allHidden ? [] : allIds)}>{allHidden ? "Show all" : "Hide all"}</button>
        </div>
      )}
      <ul className="sidebar-thread-list">
        {sessions.map((session) => {
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
              now={now}
              onSelect={() => select(session)}
            />
          );
        })}
      </ul>
    </div>
  );
}

function ThreadRow({ session, selected, agents, accent, followId, onFollow, onFocusFile, hiddenAgents, toggleAgent, now, onSelect }: {
  session: Session;
  selected: boolean;
  agents: AgentPresence[];
  accent: string;
  followId: string | null;
  onFollow: (id: string | null) => void;
  onFocusFile: (path: string) => void;
  hiddenAgents: ReadonlySet<string>;
  toggleAgent: (id: string) => void;
  now: number;
  onSelect: () => void;
}) {
  const sorted = [...agents].sort((a, b) => (a.isSubagent ? 1 : 0) - (b.isSubagent ? 1 : 0) || a.id.localeCompare(b.id));
  const running = session.status === "running";
  return (
    <li className={`sidebar-thread ${selected ? "selected" : ""}`}>
      <button className="sidebar-thread-head" onClick={onSelect} aria-pressed={selected} title={selected ? "Close this thread" : running ? "Watch this thread live" : "Replay this thread"}>
        <span className={`sidebar-thread-status ${session.status}`} aria-hidden="true" />
        <span className="sidebar-thread-title">{session.title || "Untitled thread"}</span>
        <time>{running ? "live" : ago(session.lastEventAt, now)}</time>
      </button>
      {sorted.length > 0 && (
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
      {selected && <div className="sidebar-replay-steps sidebar-thread-steps"><ReplaySteps /></div>}
    </li>
  );
}
