// Owner: sidebar agent. Threads tab: the list of threads, nothing more. Clicking one opens it on the map, and the sidebar
// shows it in the list's place (its steps; a running one follows live), with a back arrow to the list.
// The list comes in sections: Claude Code, Codex, and the threads of other projects that touched this one.
// Under the open thread: what it waits on you for, if it's blocked, and its agents, each on its row (follow, show/hide).
// The eye in the title row shows or hides all its agents.
import { useEffect, useState } from "react";
import type { AgentPresence, Session } from "@contract";
import { clock, useLive } from "../../lib/live";
import { END, useNav } from "../../lib/nav";
import { track } from "../../lib/usage";
import { relTime } from "../../follow/format";
import { agentColor, baseName, initial, shortName, verbIng } from "../agents";
import { harnessName, harnessOf } from "../../lib/harness";
import { visitorHome } from "../../lib/islands";
import { attentionText, needsYou, yourTurn } from "../../lib/attention";

const FOLDED_KEY = "rundown-folded-sections";

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

export function ThreadsPanel({ agents, accent, followId, onFollow, onFocusFile, onShowThread }: {
  agents: AgentPresence[];
  accent: string;
  followId: string | null;
  onFollow: (id: string | null) => void;
  onFocusFile: (path: string) => void;
  /** The open thread clicked again: show it (the sidebar had gone back to the list). */
  onShowThread?: () => void;
}) {
  useTick(5000);
  const now = clock();
  const { state } = useLive();
  const { replay, hiddenAgents, toggleAgent, setHiddenAgents, startReplay, stopReplay } = useNav();
  const [all, setAll] = useState(false);
  // Sections you folded, remembered in this browser.
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => { try { return new Set(JSON.parse(localStorage.getItem(FOLDED_KEY) ?? "[]") as string[]); } catch { return new Set(); } });
  const toggleGroup = (key: string) => setClosed((c) => {
    const n = new Set(c); if (n.has(key)) n.delete(key); else n.add(key);
    try { localStorage.setItem(FOLDED_KEY, JSON.stringify([...n])); } catch { /* folded for this visit only */ }
    return n;
  });

  const sessions = [...state.sessions].sort((a, b) => {
    const running = (a.status === "running" ? 0 : 1) - (b.status === "running" ? 0 : 1);
    return running !== 0 ? running : b.lastEventAt.localeCompare(a.lastEventAt);
  });

  if (sessions.length === 0) {
    return <p className="sidebar-empty">No agent threads yet. Start Claude Code or Codex in this project.</p>;
  }

  // Clicking a thread opens it at the end, on the lens you're on, and a running one keeps following its newest step.
  const select = (s: Session) => {
    if (replay?.sessionId === s.id) { onShowThread?.(); return; } // the open thread: back to it
    const running = s.status === "running";
    startReplay(s.id, running ? 0 : END, { live: running });
    track("th");
  };
  // In sections: this project's threads by harness (Claude Code, then Codex), then the threads of other projects that
  // touched this one, by project. A section's heading folds it. Each shows its most recent few; the rest behind
  // "Show all" (the open thread always shows).
  const sections = new Map<string, { key: string; title: string; list: Session[] }>();
  const add = (key: string, title: string, s: Session) => (sections.get(key) ?? sections.set(key, { key, title, list: [] }).get(key)!).list.push(s);
  for (const k of ["claude", "codex"]) sections.set(k, { key: k, title: harnessName(k as "claude" | "codex"), list: [] });
  for (const x of sessions) {
    const home = visitorHome(x.cwd, state.map);
    if (home) { const name = home.slice(home.lastIndexOf("/") + 1); add(`p:${home}`, `From ${name}`, x); }
    else add(harnessOf(x), "", x);
  }
  const groups = [...sections.values()].filter((g) => g.list.length);
  const SHORT = 5;
  const cut = (list: Session[]) => (all || list.length <= SHORT + 1 ? list : list.filter((x, i) => i < SHORT || x.id === replay?.sessionId));
  const hidden = groups.reduce((n, g) => n + (closed.has(g.key) ? 0 : g.list.length - cut(g.list).length), 0);

  const row = (session: Session) => (
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
  );
  return (
    <div className="sidebar-threads">
      {groups.map((g) => {
        const shut = closed.has(g.key);
        // Folded: only the open thread stays, so you still see where you are.
        const list = shut ? g.list.filter((x) => x.id === replay?.sessionId) : cut(g.list);
        return (
          <section key={g.key} className={`sidebar-thread-group${shut ? " shut" : ""}`}>
            <h3>
              <button onClick={() => toggleGroup(g.key)} aria-expanded={!shut}>
                <i className="sidebar-tree-caret" aria-hidden="true">›</i>{g.title}
              </button>
            </h3>
            {list.length > 0 && <ul className="sidebar-thread-list">{list.map(row)}</ul>}
          </section>
        );
      })}
      {hidden > 0 && <button className="sidebar-more" onClick={() => setAll(true)}>Show all {sessions.length} threads</button>}
      {all && groups.some((g) => g.list.length > SHORT + 1) && <button className="sidebar-more" onClick={() => setAll(false)}>Show fewer</button>}
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
  const ids = sorted.map((a) => a.id);
  const allHidden = ids.length > 0 && ids.every((id) => hiddenAgents.has(id));
  const toggleAll = () => setHiddenAgents(allHidden ? [...hiddenAgents].filter((id) => !ids.includes(id)) : [...hiddenAgents, ...ids]);
  const attention = useLive().state.attention[session.id];
  const blocked = needsYou(attention), turn = yourTurn(attention);
  const say = attention && (blocked || turn) ? attentionText(attention) : null;
  return (
    <li className={`sidebar-thread ${selected ? "selected" : ""}${blocked ? " needs-you" : ""}`}>
      <div className="sidebar-thread-headrow">
        <button className="sidebar-thread-head" onClick={onSelect} aria-pressed={selected} title={selected ? "Close this thread" : running ? "Open this thread and follow it live" : "Open this thread"}>
          <span className={`sidebar-thread-status ${session.status}${blocked ? " waiting" : ""}`} aria-hidden="true" />
          <span className="sidebar-thread-title">{session.title || "Untitled thread"}</span>
          {say && <span className={`sidebar-thread-attn ${blocked ? "blocked" : "turn"}`} title={`${say.line}${attention?.detail ? `\n${attention.detail}` : ""}`}>{say.badge}</span>}
          <time>{running ? "live" : relTime(session.lastEventAt, now)}</time>
        </button>
        {ids.length > 0 && (
          <button className="sidebar-agent-eye" onClick={toggleAll} aria-label={allHidden ? "Show this thread's agents on the map" : "Hide this thread's agents from the map"} title={allHidden ? "Show its agents" : "Hide its agents"}>
            <EyeIcon off={allHidden} />
          </button>
        )}
      </div>
      {selected && blocked && say && <p className="sidebar-thread-note blocked" title={attention?.detail}>{say.line}</p>}
      {sorted.length > 0 && selected && (
        <ul className="sidebar-thread-agents">
          {sorted.map((a) => {
            const following = followId === a.id;
            const hidden = hiddenAgents.has(a.id);
            const name = a.isSubagent ? shortName(a, 22) : "Main agent";
            return (
              <li key={a.id} className={`${following ? "following" : ""} ${hidden ? "hidden-agent" : ""}`}>
                <button className="sidebar-agent-main" onClick={() => onFollow(following ? null : a.id)} title={following ? "Stop following" : a.file ? "Follow this agent on the map, and see only its steps" : "See only its steps (it hasn't touched a file on the map yet)"}>
                  <i className="sidebar-agent-avatar" style={{ background: agentColor(a, accent) }}>{initial(a)}</i>
                  <span className="sidebar-agent-text">
                    <span className="sidebar-agent-name">{name}</span>
                    <span className="sidebar-agent-doing">
                      {a.away && a.active ? a.away : <>
                        {a.active ? verbIng(a.action) : a.file ? "Stopped at" : "Stopped"}
                        {a.file && (
                          <>
                            {" "}
                            <span role="button" tabIndex={0} className="sidebar-agent-file" onClick={(e) => { e.stopPropagation(); onFocusFile(a.file!); }}
                              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onFocusFile(a.file!); } }}>{baseName(a.file)}</span>
                          </>
                        )}
                      </>}
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
