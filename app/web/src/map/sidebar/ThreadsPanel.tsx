// Owner: sidebar agent. Threads tab: the list of threads, nothing more. Clicking one opens it on the map, and the sidebar
// turns to its Track tab (its steps; a running one follows live). Clicking the open thread again closes it. The thread's
// summary is the line above the sidebar (MapStats); Replay, Live and Share are in the Map's footer (ReplayBar's Dock).
// Under the open thread: what it waits on you for, if it's blocked, and its agents folded into one row (follow, show/hide).
// The eye in the title row shows or hides all its agents.
import { useEffect, useState } from "react";
import type { AgentPresence, Session } from "@contract";
import { clock, useLive } from "../../lib/live";
import { END, useNav } from "../../lib/nav";
import { track } from "../../lib/usage";
import { relTime } from "../../follow/format";
import { agentColor, baseName, initial, shortName, verbIng } from "../agents";
import { isCodex } from "../../lib/harness";
import { attentionText, needsYou, yourTurn } from "../../lib/attention";

function useTick(ms: number) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
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
    return <p className="sidebar-empty">No agent threads yet. Start Claude Code or Codex in this project.</p>;
  }

  // Clicking a thread opens it at the end, on the lens you're on, and a running one keeps following its newest step.
  const select = (s: Session) => {
    if (replay?.sessionId === s.id) { stopReplay(); return; } // clicking the open thread closes it
    const running = s.status === "running";
    startReplay(s.id, running ? 0 : END, { live: running });
    track("th");
  };
  // The most recent few; the rest behind "Show all" (the open thread always shows).
  const SHORT = 5;
  const shown = all || sessions.length <= SHORT + 1 ? sessions : sessions.filter((x, i) => i < SHORT || x.id === replay?.sessionId);

  return (
    <div className="sidebar-threads">
      <ul className="sidebar-thread-list">
        {shown.map((session) => (
          <ThreadRow
            key={session.id}
            session={session}
            selected={replay?.sessionId === session.id}
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
        ))}
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
  const [agentsOpen, setAgentsOpen] = useState(false);
  useEffect(() => { if (!selected) setAgentsOpen(false); }, [selected]);
  const ids = sorted.map((a) => a.id);
  const allHidden = ids.length > 0 && ids.every((id) => hiddenAgents.has(id));
  const toggleAll = () => setHiddenAgents(allHidden ? [...hiddenAgents].filter((id) => !ids.includes(id)) : [...hiddenAgents, ...ids]);
  const working = sorted.filter((a) => a.active).length;
  const attention = useLive().state.attention[session.id];
  const blocked = needsYou(attention), turn = yourTurn(attention);
  const say = attention && (blocked || turn) ? attentionText(attention) : null;
  return (
    <li className={`sidebar-thread ${selected ? "selected" : ""}${blocked ? " needs-you" : ""}`}>
      <div className="sidebar-thread-headrow">
        <button className="sidebar-thread-head" onClick={onSelect} aria-pressed={selected} title={selected ? "Close this thread" : running ? "Open this thread and follow it live" : "Open this thread"}>
          <span className={`sidebar-thread-status ${session.status}${blocked ? " waiting" : ""}`} aria-hidden="true" />
          <span className="sidebar-thread-title">{session.title || "Untitled thread"}</span>
          {isCodex(session) && <span className="sidebar-thread-harness" title="This thread ran in Codex">Codex</span>}
          {say
            ? <span className={`sidebar-thread-attn ${blocked ? "blocked" : "turn"}`} title={`${say.line}${attention?.detail ? `\n${attention.detail}` : ""}`}>{say.badge}</span>
            : tree && <span className="sidebar-thread-tree" title={session.cwd}>{tree}</span>}
          <time>{running ? "live" : relTime(session.lastEventAt, now)}</time>
        </button>
        {ids.length > 0 && (
          <button className="sidebar-agent-eye" onClick={toggleAll} aria-label={allHidden ? "Show this thread's agents on the map" : "Hide this thread's agents from the map"} title={allHidden ? "Show its agents" : "Hide its agents"}>
            <EyeIcon off={allHidden} />
          </button>
        )}
      </div>
      {selected && blocked && say && <p className="sidebar-thread-note blocked" title={attention?.detail}>{say.line}</p>}
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
                <button className="sidebar-agent-main" onClick={() => onFollow(following ? null : a.id)} title={following ? "Stop following" : "Follow this agent on the map"}>
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
    </li>
  );
}
