// Owner: sidebar agent. Floating left sidebar on the map: [Threads | Files] tabs, collapsible to a slim tab.
// Threads lists them; an open thread shows in their place (TrackPanel: its steps, or its places on the Places lens,
// next to the map: scrolling them moves the tracer), its back arrow returning to the list (the thread stays open);
// Files is the project's folder tree, or the selected file (FileView) in its place.
// Picking a file anywhere (the map, the tree, a link, a step's file) turns the sidebar to Files and opens it there,
// unfolding the sidebar if it was folded; "All files" (or Esc) goes back to the tree. Another tab keeps it: back on
// Files, the file is still there until you let go of it.
// Below 1100px wide it starts folded and opens over the content (tap outside or ‹ to fold it); on a phone, picking a
// thread folds it too, and picking a file opens it. That narrow state isn't saved, so the desktop's folded-or-not
// choice stays as it was. Folding the sheet slides it away (it leaves, then unmounts). On a phone the thread's sheet
// under the map has a grab bar: drag it to set its height (until the page reloads), down past its lowest to fold it.
// On a tablet-sized window, the open sheet and a step's panel take turns (one opening closes the other).
// On a wide window it's open: ‹ or T folds it for now, not for next time (it used to be saved,
// and a fold left from a small window kept it folded on a wide one). T folds and unfolds it anywhere. Folded with a thread open, it's a card with the thread's
// state and the step it's on (NowCard), except on a phone.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { AgentPresence, FileNode, ProjectMap } from "@contract";
import { useNav } from "../../lib/nav";
import { ThreadsPanel } from "./ThreadsPanel";
import { TrackPanel } from "./TrackPanel";
import { FilesPanel } from "./FilesPanel";
import { FileView, FileViewBack } from "./FileView";
import { NowCard } from "./NowCard";
import { isTyping } from "../../switch/shortcuts";
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
/** The fold that used to be saved: forgotten, so a wide window opens with the sidebar open. */
function forgetCollapsed() {
  try { localStorage.removeItem(COLLAPSED_KEY); } catch { /* storage blocked: nothing saved anyway */ }
}

/** Whether a media query matches, kept up to date as the window resizes. */
function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (on) => { const m = matchMedia(query); m.addEventListener("change", on); return () => m.removeEventListener("change", on); },
    () => matchMedia(query).matches,
  );
}
export const NARROW = "(max-width: 1100px)";
const LEAVE_MS = 220;                 // the sheet sliding away as it folds (sidebar.css)
// Where its top may go, within a thumb's reach: no higher than a quarter of the map (and 96 px, under the map's top
// controls), no lower than 170 px above the bottom (a few steps and the grab bar stay in view); dragged 6% past that, it folds.
const PIP_MIN = 25, PIP_MAX = 72, TOP_PX = 96, BOTTOM_PX = 170, FOLD_PAST = 6;
const pipRange = (h: number) => ({ lo: Math.max(PIP_MIN, (TOP_PX / Math.max(1, h)) * 100), hi: Math.max(PIP_MIN + 5, Math.min(PIP_MAX, ((h - BOTTOM_PX) / Math.max(1, h)) * 100)) });
const PIP_START = 50;   // each page load starts the sheet at the middle (its height isn't remembered)
const PHONE = "(max-width: 600px)";

export function MapSidebar({ agents, accent, followId, onFollow, onFocusFile, map, file, picked, onCloseFile }: MapSidebarProps) {
  const { replay, file: fileLink, step: openStep, closeStep } = useNav();
  // A file link opens on Files, a thread link on the thread.
  const [tab, setTab] = useState<Tab>(() => (fileLink ? "files" : replay ? "threads" : loadTab()));
  // Threads with a thread open: the thread, or (after its back arrow) the list.
  const [listing, setListing] = useState(false);
  const [folded, setFolded] = useState(false); // wide: folded by hand, for now
  const narrow = useMedia(NARROW), phone = useMedia(PHONE);
  const [over, setOverNow] = useState(false); // narrow: open over the content, never saved
  // Folding the open sheet by hand: it slides away first (.leaving), then goes.
  const [leaving, setLeaving] = useState(false);
  const leaveT = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const setOver = (on: boolean) => {
    clearTimeout(leaveT.current);
    if (on || !over || matchMedia("(prefers-reduced-motion: reduce)").matches) { setLeaving(false); setOverNow(on); return; }
    setLeaving(true);
    leaveT.current = setTimeout(() => { setLeaving(false); setOverNow(false); }, LEAVE_MS);
  };
  useEffect(() => () => clearTimeout(leaveT.current), []);
  const collapsed = narrow ? !over : folded;
  const setCollapsed = (c: boolean) => (narrow ? setOver(!c) : setFolded(c));

  useEffect(() => { try { localStorage.setItem(TAB_KEY, tab); } catch { /* storage blocked: tab resets on reload */ } }, [tab]);
  useEffect(forgetCollapsed, []);
  // Back to a wide window: the sidebar opens again.
  useEffect(() => { if (!narrow) setFolded(false); }, [narrow]);
  // Opening a thread shows it under Threads; closing it, the list. On a phone the thread opens below the map, which
  // keeps the top of the screen like a video (the "pip" sheet): scroll its steps back and still see the agents work.
  const thread = replay?.sessionId ?? null;
  const opened = useRef(false); // the first render already picked its tab
  useEffect(() => {
    if (opened.current && thread) setTab("threads");
    opened.current = true;
    setListing(false);
    if (phone) setOverNow(!!thread);
  }, [thread]);
  const shown: Tab = tab;
  const inThread = shown === "threads" && !!thread && !listing;
  useEffect(() => { if (!narrow) setOverNow(false); }, [narrow]);
  // A file picked: show it here, unfolded (over the content when narrow).
  useEffect(() => {
    if (!picked) return;
    setTab("files");
    if (narrow) setOver(true); else setFolded(false);
  }, [picked]);
  // A tablet-sized window has no room for the open sheet and a step's panel side by side (it used to slide over the
  // step, or leave the map no room): a step opening folds the sheet, the sheet opening closes the step (its row is still
  // the highlighted one, a tap opens it again). A phone shows the step in the sheet's place (map.css).
  const tablet = narrow && !phone;
  useEffect(() => { if (tablet && openStep && over) setOver(false); }, [openStep]);
  useEffect(() => { if (tablet && over && openStep) closeStep(); }, [over]);
  // Esc folds the open sheet first (before the app's Esc steps back out of a thread).
  useEffect(() => {
    if (!over) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOver(false); } };
    addEventListener("keydown", esc, true);
    return () => removeEventListener("keydown", esc, true);
  }, [over]);
  // T folds or unfolds it (not while typing, nor with a window open over the map).
  const toggle = useRef(() => {}); toggle.current = () => setCollapsed(!collapsed);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== "t" && e.key !== "T") || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (document.querySelector('[aria-modal="true"], .lightbox')) return;
      e.preventDefault();
      toggle.current();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
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

  // The phone's thread sheet: its top, as a share of the map's height, set by dragging its grab bar (for this page: a
  // reload starts it at the middle again); the player rides on its edge (sidebar.css --pip-top).
  const [pipTop, setPipTop] = useState(PIP_START);
  const sheet = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { (sheet.current?.closest(".map-wrap") as HTMLElement | null)?.style.setProperty("--pip-top", `${shownTop}%`); });
  const drag = useRef<{ from: number } | null>(null);
  const wrapBox = () => sheet.current?.closest(".map-wrap")?.getBoundingClientRect();
  const toPct = (y: number) => { const w = wrapBox(); return w ? ((y - w.top) / Math.max(1, w.height)) * 100 : pipTop; };
  const range = () => pipRange(wrapBox()?.height ?? 600);
  const clampPip = (v: number) => { const r = range(); return Math.max(r.lo, Math.min(r.hi, v)); };
  const grab = pip ? (
    <div className="pip-grab" role="separator" aria-orientation="horizontal" aria-label="Drag to resize the thread's sheet" tabIndex={0}
      aria-valuemin={PIP_MIN} aria-valuemax={PIP_MAX} aria-valuenow={Math.round(pipTop)}
      onPointerDown={(e) => { try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* a pointer that's gone */ } drag.current = { from: pipTop }; }}
      onPointerMove={(e) => { if (drag.current) { const r = range(); setPipTop(Math.max(r.lo, Math.min(r.hi + FOLD_PAST, toPct(e.clientY)))); } }}
      onPointerUp={(e) => {
        const d = drag.current; drag.current = null;
        if (!d) return;
        const v = toPct(e.clientY);
        if (v > range().hi + FOLD_PAST * 0.6) { setPipTop(d.from); setOver(false); return; }   // dragged past the lowest: fold
        setPipTop(clampPip(v));
      }}
      onPointerCancel={() => { if (drag.current) { setPipTop(drag.current.from); drag.current = null; } }}
      onKeyDown={(e) => {
        const d = e.key === "ArrowUp" ? -5 : e.key === "ArrowDown" ? 5 : 0;
        if (!d) return;
        e.preventDefault();
        setPipTop(clampPip(pipTop + d));
      }}>
      <i aria-hidden="true" />
    </div>
  ) : null;

  // While dragging it follows the finger (a little past the lowest, to fold); at rest, within reach on this screen.
  const shownTop = drag.current ? pipTop : clampPip(pipTop);

  if (collapsed) return tabButton;

  // Narrow: the folded tab stays in place under the open sheet, so the content behind it doesn't move.
  return (
    <>
    {narrow && <>{tabButton}{!pip && <button className={`sidebar-scrim${leaving ? " leaving" : ""}`} aria-label="Close sidebar" tabIndex={-1} onClick={() => setOver(false)} />}</>}
    <div ref={sheet} className={`map-sidebar${narrow ? " sidebar-overlay" : ""}${pip ? " pip" : ""}${leaving ? " leaving" : ""}`}
      style={pip ? { top: `${shownTop}%` } : undefined}>
      {grab}
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
