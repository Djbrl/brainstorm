// Owner: sidebar agent. Floating left sidebar on the map: [Threads | Track | Files] tabs, collapsible to a slim tab.
// Threads lists them; Track is the open thread's steps (its places, on the Places lens), next to the map: scrolling it
// moves the tracer; Files is the project's folder tree.
// Below 1100px wide it starts folded and opens over the content (tap outside or ‹ to fold it); on a phone, picking a
// thread or a file folds it too. That narrow state isn't saved, so the desktop's folded-or-not choice stays as it was.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { AgentPresence, ProjectMap } from "@contract";
import { useNav } from "../../lib/nav";
import { ThreadsPanel } from "./ThreadsPanel";
import { TrackPanel } from "./TrackPanel";
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

type Tab = "threads" | "track" | "files";
const TAB_KEY = "brainstorm-sidebar-tab";
const COLLAPSED_KEY = "brainstorm-sidebar-collapsed";

function loadTab(): Tab {
  try { const t = localStorage.getItem(TAB_KEY); return t === "track" || t === "files" ? t : "threads"; } catch { return "threads"; }
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
  const [tab, setTab] = useState<Tab>(() => (replay ? "track" : loadTab())); // a thread link opens on its Track
  const [folded, setFolded] = useState<boolean>(loadCollapsed); // the desktop choice, saved
  const narrow = useMedia(NARROW), phone = useMedia(PHONE);
  const [over, setOver] = useState(false); // narrow: open over the content, never saved
  const collapsed = narrow ? !over : folded;
  const setCollapsed = (c: boolean) => (narrow ? setOver(!c) : setFolded(c));

  useEffect(() => { try { localStorage.setItem(TAB_KEY, tab); } catch { /* storage blocked: tab resets on reload */ } }, [tab]);
  useEffect(() => { try { localStorage.setItem(COLLAPSED_KEY, folded ? "1" : "0"); } catch { /* storage blocked */ } }, [folded]);
  // Opening a thread shows its Track; closing it, the threads. On a phone the sheet folds away to show the map.
  const thread = replay?.sessionId ?? null;
  const opened = useRef(false); // the first render already picked its tab
  useEffect(() => {
    if (opened.current) setTab((t) => (thread ? "track" : t === "track" ? "threads" : t));
    opened.current = true;
    if (phone) setOver(false);
  }, [thread]);
  const shown: Tab = !thread && tab === "track" ? "threads" : tab;
  useEffect(() => { if (!narrow) setOver(false); }, [narrow]);
  // Esc folds the open sheet first (before the app's Esc steps back out of a thread).
  useEffect(() => {
    if (!over) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOver(false); } };
    addEventListener("keydown", esc, true);
    return () => removeEventListener("keydown", esc, true);
  }, [over]);
  // Picking a file opens its panel on the right: the sheet folds at any narrow width so the panel can be seen.
  const fold = <T,>(f: (x: T) => void, always = false) => (x: T) => { if (phone || always) setOver(false); f(x); };

  const tabButton = (
    <button className="sidebar-collapsed" onClick={() => setCollapsed(false)} aria-label="Open sidebar" aria-expanded={!collapsed}>
      <span>{shown === "threads" ? "Threads" : shown === "track" ? "Track" : "Files"}</span>
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
          <button role="tab" aria-selected={shown === "threads"} onClick={() => setTab("threads")}>Threads</button>
          <button role="tab" aria-selected={shown === "track"} onClick={() => setTab("track")} disabled={!thread} title={thread ? undefined : "Open a thread to see its steps"}>Track</button>
          <button role="tab" aria-selected={shown === "files"} onClick={() => setTab("files")}>Files</button>
        </nav>
        <button className="sidebar-collapse" onClick={() => setCollapsed(true)} aria-label="Collapse sidebar" title="Collapse">‹</button>
      </div>
      <div className="sidebar-body">
        {shown === "threads" ? (
          <ThreadsPanel agents={agents} accent={accent} followId={followId} onFollow={fold(onFollow)} onFocusFile={fold(onFocusFile, true)} />
        ) : shown === "track" ? (
          <TrackPanel />
        ) : (
          <FilesPanel map={map} onFocusFile={fold(onFocusFile, true)} />
        )}
      </div>
    </div>
    </>
  );
}
