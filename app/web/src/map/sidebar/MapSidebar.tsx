// Owner: sidebar agent. Floating left sidebar on the map: [Threads | Files] tabs, collapsible to a slim tab.
import { useEffect, useState } from "react";
import type { AgentPresence, ProjectMap } from "@contract";
import { useNav } from "../../lib/nav";
import { ThreadsPanel } from "./ThreadsPanel";
import { FilesPanel } from "./FilesPanel";
import "./sidebar.css";

export type MapSidebarProps = {
  /** All live agents, including hidden ones (so they can be shown again). */
  agents: AgentPresence[];
  accent: string;
  followId: string | null;
  onFollow: (id: string | null) => void;
  /** Center the map on a file and open its panel. */
  onFocusFile: (path: string) => void;
  map: ProjectMap | null;
};

type Tab = "threads" | "files";
const TAB_KEY = "brainstorm-sidebar-tab";
const COLLAPSED_KEY = "brainstorm-sidebar-collapsed";

function loadTab(): Tab {
  try { return localStorage.getItem(TAB_KEY) === "files" ? "files" : "threads"; } catch { return "threads"; }
}
function loadCollapsed(): boolean {
  try { return localStorage.getItem(COLLAPSED_KEY) === "1"; } catch { return false; }
}

export function MapSidebar({ agents, accent, followId, onFollow, onFocusFile, map }: MapSidebarProps) {
  const { replay } = useNav();
  const [tab, setTab] = useState<Tab>(loadTab);
  const [collapsed, setCollapsed] = useState<boolean>(loadCollapsed);

  useEffect(() => { try { localStorage.setItem(TAB_KEY, tab); } catch { /* storage blocked: tab resets on reload */ } }, [tab]);
  useEffect(() => { try { localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0"); } catch { /* storage blocked */ } }, [collapsed]);
  // A new replay opens the Threads tab, where its step list lives.
  useEffect(() => { if (replay?.sessionId) setTab("threads"); }, [replay?.sessionId]);

  if (collapsed) {
    return (
      <button className="sidebar-collapsed" onClick={() => setCollapsed(false)} aria-label="Open sidebar">
        <span>{tab === "threads" ? "Threads" : "Files"}</span>
        <i aria-hidden="true">›</i>
      </button>
    );
  }

  return (
    <div className="map-sidebar">
      <div className="sidebar-head">
        <nav className="sidebar-tabs" role="tablist" aria-label="Sidebar view">
          <button role="tab" aria-selected={tab === "threads"} onClick={() => setTab("threads")}>Threads</button>
          <button role="tab" aria-selected={tab === "files"} onClick={() => setTab("files")}>Files</button>
        </nav>
        <button className="sidebar-collapse" onClick={() => setCollapsed(true)} aria-label="Collapse sidebar" title="Collapse">‹</button>
      </div>
      <div className="sidebar-body">
        {tab === "threads" ? (
          <ThreadsPanel agents={agents} accent={accent} followId={followId} onFollow={onFollow} onFocusFile={onFocusFile} />
        ) : (
          <FilesPanel map={map} onFocusFile={onFocusFile} />
        )}
      </div>
    </div>
  );
}
