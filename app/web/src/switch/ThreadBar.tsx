// Owner: switcher. The tab bar under the header: your threads at work, waiting on you, or opened lately, one click (or
// one key: 1 to 9, [ and ]) from each other. Find a thread (⌘K) for the rest, this project's and your other projects'.
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useLiveSelector } from "../lib/live";
import { useNavActions, useNavState, useReplayCursor } from "../lib/nav";
import { setCameraLock, useCameraLock } from "../map/prefs";
import { attentionText, needsYou, yourTurn } from "../lib/attention";
import { forgetThread, openThread, rememberThread, useBarThreads, type BarThread } from "../lib/switcher";
import { isTyping, MOD } from "./shortcuts";
import "./switch.css";

export function ThreadBar({ onFind, onHelp }: { onFind: () => void; onHelp: () => void }) {
  const { replay } = useNavState();
  const nav = useNavActions();
  const openId = replay?.sessionId ?? null;
  const root = useLiveSelector((s) => s.setup?.root ?? "");
  const tabs = useBarThreads(openId);

  // The thread you open joins the bar for the next hours.
  useEffect(() => { if (openId && root) rememberThread(root, openId); }, [openId, root]);

  // 1 to 9 open the bar's tabs; [ and ] the one before or after the open one.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || !tabs.length) return;
      let to: BarThread | undefined;
      if (/^[1-9]$/.test(e.key)) to = tabs[Number(e.key) - 1];
      else if (e.key === "[" || e.key === "]") {
        const i = tabs.findIndex((t) => t.session.id === openId);
        const d = e.key === "]" ? 1 : -1;
        to = tabs[i === -1 ? (d > 0 ? 0 : tabs.length - 1) : (i + d + tabs.length) % tabs.length];
      } else return;
      e.preventDefault();
      if (to && to.session.id !== openId) openThread(nav, to.session);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [tabs, openId, nav]);

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
      <div className={`threadbar-tabs${more.left ? " more-left" : ""}${more.right ? " more-right" : ""}`} role="tablist" aria-label="Your threads" ref={strip} onScroll={measure}
        onWheel={(e) => { const el = strip.current; if (el && Math.abs(e.deltaY) > Math.abs(e.deltaX)) el.scrollLeft += e.deltaY; }}>
        {tabs.map((t, i) => <Tab key={t.session.id} t={t} n={i + 1} open={t.session.id === openId}
          onOpen={() => openThread(nav, t.session)}
          onClose={() => { forgetThread(root, t.session.id); if (t.session.id === openId) nav.stopReplay(); }} />)}
      </div>
      <KeyHints open={!!openId} onHelp={onHelp} />
      <button className="threadbar-find" onClick={onFind} title={`Find any thread, in this project or another (${MOD} K)`}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5 14 14" /></svg>
        Find a thread<kbd>{MOD === "⌘" ? "⌘K" : "Ctrl K"}</kbd>
      </button>
    </div>
  );
}

/** A click that doesn't take the focus: the keys keep working on the map, and no focus ring shows on the button. */
const keepFocus = (e: MouseEvent) => e.preventDefault();
/** The key's own handler (the map's camera, the replay), as if pressed. */
const press = (key: string) => dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));

/**
 * The keys people use most, said quietly beside Find a thread, and clickable: play, center and the camera lock with a
 * thread open, and ? for the rest.
 */
function KeyHints({ open, onHelp }: { open: boolean; onHelp: () => void }) {
  const playing = useReplayCursor((c) => c.playing);
  const lock = useCameraLock();
  return (
    <div className="threadbar-keys" aria-label="Keyboard shortcuts">
      {open && <button className="threadbar-key-extra" onMouseDown={keepFocus} onClick={() => press(" ")} title={playing ? "Pause (Space)" : "Play from the step you're on (Space)"}><kbd>Space</kbd>{playing ? "Pause" : "Play"}</button>}
      {open && <button className="threadbar-key-extra" onMouseDown={keepFocus} onClick={() => press("c")} title="Center the camera on the agent (C)"><kbd>C</kbd>Center</button>}
      {open && <button className="threadbar-key-extra" role="switch" aria-checked={lock} onMouseDown={keepFocus} onClick={() => setCameraLock(!lock)}
        title={lock ? "The camera keeps the agent centred. Click to move the map freely (L)" : "Keep the agent centred as it moves (L)"}><kbd>L</kbd>{lock ? "Free camera" : "Lock camera"}</button>}
      <button onMouseDown={keepFocus} onClick={onHelp} title="Every keyboard shortcut"><kbd>?</kbd>Shortcuts</button>
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
