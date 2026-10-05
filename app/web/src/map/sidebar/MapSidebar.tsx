// Owner: sidebar agent. Floating left sidebar on the map: [Threads | Files] tabs, collapsible to a slim tab.
// Below 1100px wide it starts folded and opens over the content (tap outside or ‹ to fold it); on a phone, picking a
// thread or a file folds it too. That narrow state isn't saved, so the desktop's folded-or-not choice stays as it was.
import { useEffect, useState, useSyncExternalStore } from "react";
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

/** Whether a media query matches, kept up to date as the window resizes. */
function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (on) => { const m = matchMedia(query); m.addEventListener("change", on); return () => m.removeEventListener("change", on); },
    () => matchMedia(query).matches,
  );
}
export const NARROW = "(max-width: 1100px)";
const PHONE = "(max-width: 600px)";

export function MapSidebar({ agents, accent, followId, onFollow, onFocusFile, map }: MapSidebarProps) {
  const { replay } = useNav();
  const [tab, setTab] = useState<Tab>(loadTab);
  const [folded, setFolded] = useState<boolean>(loadCollapsed); // the desktop choice, saved
  const narrow = useMedia(NARROW), phone = useMedia(PHONE);
  const [over, setOver] = useState(false); // narrow: open over the content, never saved
  const collapsed = narrow ? !over : folded;
  const setCollapsed = (c: boolean) => (narrow ? setOver(!c) : setFolded(c));

  useEffect(() => { try { localStorage.setItem(TAB_KEY, tab); } catch { /* storage blocked: tab resets on reload */ } }, [tab]);
  useEffect(() => { try { localStorage.setItem(COLLAPSED_KEY, folded ? "1" : "0"); } catch { /* storage blocked */ } }, [folded]);
  // Opening a thread shows the Threads tab, where it is highlighted; on a phone the sheet folds away to show it.
  useEffect(() => { if (replay?.sessionId) setTab("threads"); if (phone) setOver(false); }, [replay?.sessionId]);
  useEffect(() => { if (!narrow) setOver(false); }, [narrow]);
  // Esc folds the open sheet first (before the app's Esc steps back out of a thread).
  useEffect(() => {
    if (!over) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOver(false); } };
    addEventListener("keydown", esc, true);
    return () => removeEventListener("keydown", esc, true);
  }, [over]);
  const fold = <T,>(f: (x: T) => void) => (x: T) => { if (phone) setOver(false); f(x); };

  const tabButton = (
    <button className="sidebar-collapsed" onClick={() => setCollapsed(false)} aria-label="Open sidebar" aria-expanded={!collapsed}>
      <span>{tab === "threads" ? "Threads" : "Files"}</span>
      <i aria-hidden="true">›</i>
    </button>
  );

  if (collapsed) return tabButton;

  // Narrow: the folded tab stays in place under the open sheet, so the content behind it doesn't move.
  return (
    <>
    {narrow && <>{tabButton}<button className="sidebar-scrim" aria-label="Close sidebar" tabIndex={-1} onClick={() => setOver(false)} /></>}
    <div className={`map-sidebar${narrow ? " sidebar-overlay" : ""}`}>
      <div className="sidebar-head">
        <nav className="sidebar-tabs" role="tablist" aria-label="Sidebar view">
          <button role="tab" aria-selected={tab === "threads"} onClick={() => setTab("threads")}>Threads</button>
          <button role="tab" aria-selected={tab === "files"} onClick={() => setTab("files")}>Files</button>
        </nav>
        <button className="sidebar-collapse" onClick={() => setCollapsed(true)} aria-label="Collapse sidebar" title="Collapse">‹</button>
      </div>
      <div className="sidebar-body">
        {tab === "threads" ? (
          <ThreadsPanel agents={agents} accent={accent} followId={followId} onFollow={fold(onFollow)} onFocusFile={fold(onFocusFile)} />
        ) : (
          <FilesPanel map={map} onFocusFile={fold(onFocusFile)} />
        )}
      </div>
    </div>
    </>
  );
}
