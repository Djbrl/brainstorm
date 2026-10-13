// The tab bar under the header: your threads at work, waiting on you, or opened lately, one click (or
// one key: 1 to 9, [ and ]) from each other. Find a thread (⌘K) for the rest, this project's and your other projects'.
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useLiveSelector } from "../lib/live";
import { useNavActions, useNavState } from "../lib/nav";
import { attentionText, needsYou, yourTurn } from "../lib/attention";
import { forgetThread, openThread, rememberThread, useBarThreads, type BarThread } from "../lib/switcher";
import { MOD, useShortcut } from "./shortcuts";
import { WorkspaceMenu } from "./WorkspaceMenu";
import { LensSwitch } from "../map/LensSwitch";
import "./switch.css";

export function ThreadBar({ project, onFind, onHelp, onAllProjects }: { project: string; onFind: () => void; onHelp: () => void; onAllProjects: () => void }) {
  const { thread } = useNavState();
  const nav = useNavActions();
  const openId = thread?.sessionId ?? null;
  const root = useLiveSelector((s) => s.setup?.root ?? "");
  const tabs = useBarThreads(openId);

  // The thread you open joins the bar for the next hours.
  useEffect(() => { if (openId && root) rememberThread(root, openId); }, [openId, root]);

  // 1 to 9 open the bar's tabs; [ and ] the one before or after the open one. Tab is left alone: it moves the focus
  // from button to button, as on any page.
  const go = (to: BarThread | undefined) => { if (to && to.session.id !== openId) openThread(nav, to.session); };
  useShortcut("thread.number", (e) => { if (!e || !tabs.length) return false; go(tabs[Number(e.key) - 1]); });
  useShortcut("thread.next", (e) => {
    if (!e || !tabs.length) return false;
    const i = tabs.findIndex((t) => t.session.id === openId);
    const d = e.key === "]" ? 1 : -1;
    go(tabs[i === -1 ? (d > 0 ? 0 : tabs.length - 1) : (i + d + tabs.length) % tabs.length]);
  });

  // The tabs scroll on their own (the keys and Find a thread stay put): the open one is kept in view, and an edge fades
  // where more tabs hide.
  const strip = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ left: false, right: false });
  const measure = () => {
    const el = strip.current;
    if (el) setMore({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
  };
  useEffect(() => {
    strip.current?.querySelector(".threadbar-tab.open")?.scrollIntoView({ block: "nearest", inline: "nearest" });
    measure();
  }, [openId, tabs.length]);
  useEffect(() => { addEventListener("resize", measure); return () => removeEventListener("resize", measure); }, []);

  return (
    <div className="threadbar">
      {/* The project leads the row (the header no longer names it): a click lists your other projects to hop to. */}
      <WorkspaceMenu project={project} root={root} onAll={onAllProjects} />
      <div className={`threadbar-tabs${more.left ? " more-left" : ""}${more.right ? " more-right" : ""}`} role="tablist" aria-label="Your threads" ref={strip} onScroll={measure}
        onWheel={(e) => { const el = strip.current; if (el && Math.abs(e.deltaY) > Math.abs(e.deltaX)) el.scrollLeft += e.deltaY; }}>
        {tabs.map((t, i) => <Tab key={t.session.id} t={t} n={i + 1} open={t.session.id === openId}
          onOpen={() => openThread(nav, t.session)}
          onClose={() => { forgetThread(root, t.session.id); if (t.session.id === openId) nav.stopReplay(); }} />)}
      </div>
      <LensSwitch />
      <HelpButton onHelp={onHelp} />
      <button className="threadbar-find" onClick={onFind} title={`Find any thread, in this project or another (${MOD} K)`}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5 14 14" /></svg>
        Find a thread<kbd>{MOD === "⌘" ? "⌘K" : "Ctrl K"}</kbd>
      </button>
    </div>
  );
}

/** A click that doesn't take the focus: the keys keep working on the map, and no focus ring shows on the button. */
const keepFocus = (e: MouseEvent) => e.preventDefault();

/** The shortcuts window, one quiet "?" beside Find a thread: the keys themselves are listed there, not in the bar. */
function HelpButton({ onHelp }: { onHelp: () => void }) {
  return (
    <div className="threadbar-keys">
      <button className="threadbar-help" onMouseDown={keepFocus} onClick={onHelp} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)">?</button>
    </div>
  );
}

function Tab({ t, n, open, onOpen, onClose }: { t: BarThread; n: number; open: boolean; onOpen: () => void; onClose: () => void }) {
  const { session, attention } = t;
  const blocked = needsYou(attention), turn = yourTurn(attention);
  const running = session.status === "running";
  const say = attention && (blocked || turn) ? attentionText(attention) : null;
  const state = blocked ? "waiting" : running ? "running" : "";
  return (
    <div className={`threadbar-tab ${open ? "open" : ""}${blocked ? " needs-you" : ""}`} role="presentation">
      <button role="tab" aria-selected={open} onMouseDown={keepFocus} onClick={open ? undefined : onOpen}
        title={`${session.title || "Untitled thread"}${say ? `\n${say.line}` : attention?.state === "thinking" ? "\nThinking about its next step" : running ? "\nWorking now" : ""}\nPress ${n}`}>
        {state && <span className={`threadbar-dot ${state}`} aria-hidden="true" />}
        <span className="threadbar-title">{session.title || "Untitled thread"}</span>
        {say && <span className={`threadbar-attn ${blocked ? "blocked" : "turn"}`}>{say.badge}</span>}
      </button>
      <button className="threadbar-close" onMouseDown={keepFocus} onClick={onClose} aria-label={`Close ${session.title || "this thread"}`}
        title={running || blocked ? "Close the tab (it comes back if it needs you)" : "Close the tab"}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 5l6 6M11 5l-6 6" /></svg>
      </button>
    </div>
  );
}
