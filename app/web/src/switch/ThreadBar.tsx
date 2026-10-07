// Owner: switcher. The tab bar under the header: your threads at work, waiting on you, or opened lately, one click (or
// one key: 1 to 9, [ and ]) from each other. Find a thread (⌘K) for the rest, this project's and your other projects'.
import { useEffect } from "react";
import { useLiveSelector } from "../lib/live";
import { useNavActions, useNavState, useReplayCursor } from "../lib/nav";
import { useCameraLock } from "../map/prefs";
import { attentionText, needsYou, yourTurn } from "../lib/attention";
import { isCodex } from "../lib/harness";
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

  if (!tabs.length) return null;
  return (
    <div className="threadbar" role="tablist" aria-label="Your threads">
      {tabs.map((t, i) => <Tab key={t.session.id} t={t} n={i + 1} open={t.session.id === openId}
        onOpen={() => openThread(nav, t.session)}
        onClose={() => { forgetThread(root, t.session.id); if (t.session.id === openId) nav.stopReplay(); }} />)}
      <KeyHints open={!!openId} onHelp={onHelp} />
      <button className="threadbar-find" onClick={onFind} title={`Find any thread, in this project or another (${MOD} K)`}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5 14 14" /></svg>
        Find a thread<kbd>{MOD === "⌘" ? "⌘K" : "Ctrl K"}</kbd>
      </button>
    </div>
  );
}

/** The keys people use most, said quietly beside Find a thread: play and the camera lock with a thread open, and ? for the rest. */
function KeyHints({ open, onHelp }: { open: boolean; onHelp: () => void }) {
  const playing = useReplayCursor((c) => c.playing);
  const lock = useCameraLock();
  return (
    <div className="threadbar-keys" aria-label="Keyboard shortcuts">
      {open && <span><kbd>Space</kbd>{playing ? "Pause" : "Play"}</span>}
      {open && <span><kbd>C</kbd>Center</span>}
      {open && <span><kbd>L</kbd>{lock ? "Free camera" : "Lock camera"}</span>}
      <button onClick={onHelp} title="Every keyboard shortcut"><kbd>?</kbd>Shortcuts</button>
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
      <button role="tab" aria-selected={open} onClick={open ? undefined : onOpen}
        title={`${session.title || "Untitled thread"}${say ? `\n${say.line}` : running ? "\nWorking now" : ""}\nPress ${n}`}>
        <span className={`threadbar-dot ${state}`} aria-hidden="true" />
        <span className="threadbar-title">{session.title || "Untitled thread"}</span>
        {isCodex(session) && <span className="threadbar-harness">Codex</span>}
        {say && <span className={`threadbar-attn ${blocked ? "blocked" : "turn"}`}>{say.badge}</span>}
      </button>
      {!t.pinned && (
        <button className="threadbar-close" onClick={onClose} aria-label={`Remove ${session.title || "this thread"} from the bar`} title="Remove from the bar">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 5l6 6M11 5l-6 6" /></svg>
        </button>
      )}
    </div>
  );
}
