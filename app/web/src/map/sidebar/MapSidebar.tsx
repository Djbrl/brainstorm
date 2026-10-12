// Floating left sidebar on the map: [Threads | Files] tabs, collapsible to a slim tab.
// Threads lists them; an open thread shows in their place (TrackPanel: its steps, or its places on the Places lens,
// next to the map: scrolling them moves the tracer), its back arrow returning to the list (the thread stays open);
// Files is the project's folder tree, or the selected file (FileView) in its place.
// Picking a file anywhere (the map, the tree, a link, a step's file) turns the sidebar to Files and opens it there,
// unfolding the sidebar if it was folded; "All files" (or Esc) goes back to the tree. Another tab keeps it: back on
// Files, the file is still there until you let go of it.
// When it's open or folded is useSidebarFold's (wide, narrow, tablet, phone); on a phone, picking a thread folds it too,
// and picking a file opens it. On a phone the thread's sheet sits under the map, its height dragged by a grab bar
// (usePhoneSheet). T folds and unfolds it anywhere. Folded with a thread open, it's a card with the thread's state and
// the step it's on (NowCard), except on a phone.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AgentPresence, FileNode, ProjectMap } from "@contract";
import { useNavState } from "../../lib/nav";
import { ThreadsPanel } from "./ThreadsPanel";
import { TrackPanel } from "./TrackPanel";
import { FilesPanel } from "./FilesPanel";
import { FileView, FileViewBack } from "./FileView";
import { NowCard } from "./NowCard";
import { useShortcut, windowOpen } from "../../switch/shortcuts";
import "./sidebar.css";
import { readStored, writeStored } from "../../lib/store";
import { useSidebarFold } from "./useSidebarFold";
import { usePhoneSheet } from "./usePhoneSheet";

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

const loadTab = (): Tab => (readStored(TAB_KEY) === "files" ? "files" : "threads");

export function MapSidebar({ agents, accent, followId, onFollow, onFocusFile, map, file, picked, onCloseFile }: MapSidebarProps) {
  const { thread: openThread, file: fileLink } = useNavState();
  // A file link opens on Files, a thread link on the thread.
  const [tab, setTab] = useState<Tab>(() => (fileLink ? "files" : openThread ? "threads" : loadTab()));
  // Threads with a thread open: the thread, or (after its back arrow) the list.
  const [listing, setListing] = useState(false);
  const { narrow, phone, over, leaving, collapsed, setCollapsed, setOpen, setOver, setOverNow } = useSidebarFold();

  useEffect(() => writeStored(TAB_KEY, tab), [tab]); // storage blocked: the tab resets on reload
  // Opening a thread shows it under Threads; closing it, the list. On a phone the thread opens below the map, which
  // keeps the top of the screen like a video (the "pip" sheet): scroll its steps back and still see the agents work.
  const thread = openThread?.sessionId ?? null;
  const opened = useRef(false); // the first render already picked its tab
  useEffect(() => {
    if (opened.current && thread) setTab("threads");
    opened.current = true;
    setListing(false);
    if (phone) setOverNow(!!thread);
  }, [thread]);
  const shown: Tab = tab;
  const inThread = shown === "threads" && !!thread && !listing;
  // A file picked: show it here, unfolded (over the content when narrow).
  useEffect(() => {
    if (!picked) return;
    setTab("files");
    setOpen(true);
  }, [picked]);
  // The tour (map/tour/Tour.tsx) opens it on a tab, or folds it: a "rundown-sidebar" event, {open?, tab?}.
  const drive = useRef((_d: { open?: boolean; tab?: Tab }) => {});
  drive.current = (d) => {
    if (d.tab) { setTab(d.tab); setListing(false); }
    if (d.open !== undefined) setOpen(d.open);
  };
  useEffect(() => {
    const on = (e: Event) => drive.current((e as CustomEvent<{ open?: boolean; tab?: Tab }>).detail ?? {});
    addEventListener("rundown-sidebar", on);
    return () => removeEventListener("rundown-sidebar", on);
  }, []);
  // T folds or unfolds it (not while typing, nor with a window open over the map).
  useShortcut("sidebar", () => { if (windowOpen()) return false; setCollapsed(!collapsed); });
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

  // Folded on a phone: a strip along the bottom, the sheet's top peeking up (tap it, or drag it up, to open it).
  const lift = useRef<number | null>(null);
  const tabButton = thread && !phone ? <NowCard onOpen={() => setCollapsed(false)} /> : phone ? (
    <button className="sidebar-collapsed at-bottom" onClick={() => setCollapsed(false)} aria-label="Open sidebar" aria-expanded={!collapsed} title="Open sidebar (T)"
      onPointerDown={(e) => { lift.current = e.clientY; }}
      onPointerMove={(e) => { if (lift.current !== null && lift.current - e.clientY > 24) { lift.current = null; setCollapsed(false); } }}
      onPointerUp={() => { lift.current = null; }}>
      <b className="pip-bar" aria-hidden="true" />
      <span>{shown === "threads" ? "Threads" : "Files"}</span>
    </button>
  ) : (
    <button className="sidebar-collapsed" onClick={() => setCollapsed(false)} aria-label="Open sidebar" aria-expanded={!collapsed} title="Open sidebar (T)">
      <span>{shown === "threads" ? "Threads" : "Files"}</span>
      <i aria-hidden="true">›</i>
    </button>
  );

  // The phone's thread sheet: dragging its grab bar sets its height, down past its lowest folds it.
  const { sheet, top: shownTop, grab } = usePhoneSheet(() => setOver(false));

  if (collapsed) return tabButton;

  // Narrow: the folded tab stays in place under the open sheet, so the content behind it doesn't move.
  return (
    <>
    {narrow && <>{tabButton}{!pip && <button className={`sidebar-scrim${leaving ? " leaving" : ""}`} aria-label="Close sidebar" tabIndex={-1} onClick={() => setOver(false)} />}</>}
    <div ref={sheet} className={`map-sidebar${narrow ? " sidebar-overlay" : ""}${pip ? " pip" : ""}${leaving ? " leaving" : ""}`}
      style={pip ? { top: `${shownTop}%` } : undefined}>
      {pip && <div className="pip-grab" {...grab}><i aria-hidden="true" /></div>}
      <div className="sidebar-head">
        <nav className="sidebar-tabs" role="tablist" aria-label="Sidebar view">
          <button role="tab" aria-selected={shown === "threads"} onClick={() => setTab("threads")}>Threads</button>
          <button role="tab" aria-selected={shown === "files"} onClick={() => setTab("files")}>Files</button>
        </nav>
        <button className="sidebar-collapse" onClick={() => setCollapsed(true)} aria-label="Collapse sidebar" title="Collapse (T)">‹</button>
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
