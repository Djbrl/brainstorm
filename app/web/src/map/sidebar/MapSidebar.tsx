// Owner: sidebar agent. Floating left sidebar on the map: [Threads | Files] tabs, collapsible to a slim tab.
// Threads lists them; an open thread shows in their place (TrackPanel: its steps, or its places on the Places lens,
// next to the map: scrolling them moves the tracer), its back arrow returning to the list (the thread stays open);
// Files is the project's folder tree, or the selected file (FileView) in its place.
// Picking a file anywhere (the map, the tree, a link, a step's file) turns the sidebar to Files and opens it there,
// unfolding the sidebar if it was folded; "All files" (or Esc) goes back to the tree. Another tab keeps it: back on
// Files, the file is still there until you let go of it.
// Below 1100px wide it starts folded and opens over the content (tap outside or ‹ to fold it); on a phone, picking a
// thread folds it too, and picking a file opens it. That narrow state isn't saved, so the desktop's folded-or-not
// choice stays as it was.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { AgentPresence, FileNode, ProjectMap } from "@contract";
import { useNav } from "../../lib/nav";
import { ThreadsPanel } from "./ThreadsPanel";
import { TrackPanel } from "./TrackPanel";
import { FilesPanel } from "./FilesPanel";
import { FileView, FileViewBack } from "./FileView";
import "./sidebar.css";

export type MapSidebarProps = {
  /** All live agents, including hidden ones (so they can be shown again). */
  agents: AgentPresence[];
  accent: string;
  followId: string | null;
  onFollow: (id: string | null) => void;
  /** Center the map on a file and select it (its details then show here). */
  onFocusFile: (path: string) => void;
  map: ProjectMap | null;
  /** The selected file, shown in the Files tab in place of the tree. */
  file?: FileNode;
  /** Goes up every time a file is picked (the same one again too): the sidebar turns to Files and unfolds. */
  picked?: number;
  /** Let go of the selected file (back to the tree). */
  onCloseFile?: () => void;
};

type Tab = "threads" | "files";
const TAB_KEY = "rundown-sidebar-tab";
const COLLAPSED_KEY = "rundown-sidebar-collapsed";

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

export function MapSidebar({ agents, accent, followId, onFollow, onFocusFile, map, file, picked, onCloseFile }: MapSidebarProps) {
  const { replay, file: fileLink } = useNav();
  // A file link opens on Files, a thread link on the thread.
  const [tab, setTab] = useState<Tab>(() => (fileLink ? "files" : replay ? "threads" : loadTab()));
  // Threads with a thread open: the thread, or (after its back arrow) the list.
  const [listing, setListing] = useState(false);
  const [folded, setFolded] = useState<boolean>(loadCollapsed); // the desktop choice, saved
  const narrow = useMedia(NARROW), phone = useMedia(PHONE);
  const [over, setOver] = useState(false); // narrow: open over the content, never saved
  const collapsed = narrow ? !over : folded;
  const setCollapsed = (c: boolean) => (narrow ? setOver(!c) : setFolded(c));

  useEffect(() => { try { localStorage.setItem(TAB_KEY, tab); } catch { /* storage blocked: tab resets on reload */ } }, [tab]);
  useEffect(() => { try { localStorage.setItem(COLLAPSED_KEY, folded ? "1" : "0"); } catch { /* storage blocked */ } }, [folded]);
  // Opening a thread shows it under Threads; closing it, the list. On a phone the thread opens below the map, which
  // keeps the top of the screen like a video (the "pip" sheet): scroll its steps back and still see the agents work.
  const thread = replay?.sessionId ?? null;
  const opened = useRef(false); // the first render already picked its tab
  useEffect(() => {
    if (opened.current && thread) setTab("threads");
    opened.current = true;
    setListing(false);
    if (phone) setOver(!!thread);
  }, [thread]);
  const shown: Tab = tab;
  const inThread = shown === "threads" && !!thread && !listing;
  useEffect(() => { if (!narrow) setOver(false); }, [narrow]);
  // A file picked: show it here, unfolded (over the content when narrow).
  useEffect(() => {
    if (!picked) return;
    setTab("files");
    if (narrow) setOver(true); else setFolded(false);
  }, [picked]);
  // Esc folds the open sheet first (before the app's Esc steps back out of a thread).
  useEffect(() => {
    if (!over) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOver(false); } };
    addEventListener("keydown", esc, true);
    return () => removeEventListener("keydown", esc, true);
  }, [over]);
  // On a phone, following an agent folds the sheet to show the map. A file opens here instead (see above).
  const fold = <T,>(f: (x: T) => void) => (x: T) => { if (phone) setOver(false); f(x); };

  // Every view shares the scrolling body: the tree keeps its place while a file or another tab shows, the rest open at
  // their top.
  const body = useRef<HTMLDivElement>(null);
  const viewing = shown === "files" && file ? file.path : null;
  const view = viewing ? `file:${viewing}` : inThread ? "thread" : shown; // "files" is the tree
  const pip = phone && over && inThread && !viewing;
  const viewRef = useRef(view); viewRef.current = view;
  const treeTop = useRef(0), lastView = useRef(view);
  useLayoutEffect(() => {
    const el = body.current, prev = lastView.current;
    lastView.current = view;
    if (el && prev !== view) el.scrollTop = view === "files" ? treeTop.current : 0;
  });
  const onScroll = () => { if (viewRef.current === "files" && body.current) treeTop.current = body.current.scrollTop; };

  const tabButton = (
    <button className="sidebar-collapsed" onClick={() => setCollapsed(false)} aria-label="Open sidebar" aria-expanded={!collapsed}>
      <span>{shown === "threads" ? "Threads" : "Files"}</span>
      <i aria-hidden="true">›</i>
    </button>
  );

  if (collapsed) return tabButton;

  // Narrow: the folded tab stays in place under the open sheet, so the content behind it doesn't move.
  return (
    <>
    {narrow && <>{tabButton}{!pip && <button className="sidebar-scrim" aria-label="Close sidebar" tabIndex={-1} onClick={() => setOver(false)} />}</>}
    <div className={`map-sidebar${narrow ? " sidebar-overlay" : ""}${pip ? " pip" : ""}`}>
      <div className="sidebar-head">
        <nav className="sidebar-tabs" role="tablist" aria-label="Sidebar view">
          <button role="tab" aria-selected={shown === "threads"} onClick={() => setTab("threads")}>Threads</button>
          <button role="tab" aria-selected={shown === "files"} onClick={() => setTab("files")}>Files</button>
        </nav>
        <button className="sidebar-collapse" onClick={() => setCollapsed(true)} aria-label="Collapse sidebar" title="Collapse">‹</button>
      </div>
      {viewing && <FileViewBack onBack={() => onCloseFile?.()} />}
      <div className="sidebar-body" ref={body} onScroll={onScroll}>
        {inThread ? (
          <TrackPanel onBack={() => setListing(true)} />
        ) : shown === "threads" ? (
          <ThreadsPanel agents={agents} accent={accent} followId={followId} onFollow={fold(onFollow)} onFocusFile={onFocusFile} onShowThread={() => setListing(false)} />
        ) : viewing && file ? (
          <FileView file={file} root={map?.root ?? ""} edges={map?.edges ?? []} onFocus={onFocusFile} />
        ) : null}
        {/* The tree stays (hidden) under an open file and the other tabs, so it comes back as it was: search, open folders. */}
        <FilesPanel map={map} onFocusFile={onFocusFile} hidden={view !== "files"} />
      </div>
    </div>
    </>
  );
}
