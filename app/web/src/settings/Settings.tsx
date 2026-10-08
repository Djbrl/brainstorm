// Owned by the lead. The settings button in the header, and the settings window it opens: centred, over a veil, its
// own scroll (the header's backdrop-filter would pin a fixed child to the header, so the window lives in <body>).
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNotifyPref } from "../lib/attention";
import { isReplay } from "../lib/live";
import { setTheme, THEMES, useTheme } from "../lib/theme";
import { setShowFile, setStepWindow, STEP_WINDOWS, useShowFile, useStepWindow } from "../map/prefs";
import { useNavActions, useNavState } from "../lib/nav";
import { setFoldOn, useFoldOn } from "../map/fold";
import { EDITORS, setEditor, useEditor } from "../lib/editor";
import { useUsageSetting } from "../lib/usage";
import { useDialogFocus } from "../lib/useDialogFocus";
import "./settings.css";

export function SettingsButton() {
  const [open, setOpen] = useState(false);
  const theme = useTheme();
  const box = useRef<HTMLDivElement>(null), pop = useRef<HTMLDivElement>(null);

  // Close on a click outside or Esc (Esc closes the window only, it doesn't also step back out of a thread). While open,
  // the window has the keyboard (lib/useDialogFocus.ts).
  useEffect(() => {
    if (!open) return;
    const inside = (t: Node) => !!box.current?.contains(t) || !!pop.current?.contains(t);
    const onDown = (e: PointerEvent) => { if (!inside(e.target as Node)) setOpen(false); };
    addEventListener("pointerdown", onDown);
    return () => removeEventListener("pointerdown", onDown);
  }, [open]);
  useDialogFocus(pop, () => setOpen(false), open);

  return (
    <div className="settings" ref={box}>
      <button className="ws-chip settings-btn" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((o) => !o)}>Settings</button>
      {open && createPortal(
        <div className="settings-pop" role="dialog" aria-modal="true" aria-labelledby="settings-title" tabIndex={-1} ref={pop}>
          <header className="settings-head">
            <h2 id="settings-title">Settings</h2>
            <button className="settings-close" aria-label="Close settings" onClick={() => setOpen(false)}>
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
            </button>
          </header>
          <div className="settings-body">
            <section className="set-sec wide">
              <h3>Map theme</h3>
              <div className="theme-list theme-grid" role="radiogroup" aria-label="Map theme">
                {THEMES.map((t) => (
                  <button key={t.id} role="radio" aria-checked={theme === t.id} className={`theme-opt ${theme === t.id ? "on" : ""}`} onClick={() => setTheme(t.id)}>
                    <span className={`theme-swatch sw-${t.id}`} aria-hidden="true" />
                    <span className="theme-text"><b>{t.name}</b><small>{t.note}</small></span>
                  </button>
                ))}
              </div>
            </section>
            <WindowSetting />
            <FollowSetting />
            <EditorSetting />
            <FoldSetting />
            <NotifySetting />
            <UsageSetting />
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

/** How much of an open thread the map lights up and names (map/prefs.ts; the focus is in map/replay/layer.ts). */
function WindowSetting() {
  const win = useStepWindow();
  return (
    <section className="set-sec">
      <h3>On the map, show</h3>
      <div className="theme-list view-list" role="radiogroup" aria-label="On the map, show">
        {STEP_WINDOWS.map((w) => (
          <button key={w.id} role="radio" aria-checked={win === w.id} className={`theme-opt view-opt ${win === w.id ? "on" : ""}`} onClick={() => setStepWindow(w.id)}>
            <span className="theme-text"><b>{w.name}</b></span>
          </button>
        ))}
      </div>
    </section>
  );
}

/** While you follow or replay a thread: the file window (replay/Peek.tsx) and lines to the files it reads (R). */
function FollowSetting() {
  const file = useShowFile();
  const { showReads } = useNavState();
  const { setShowReads } = useNavActions();
  return (
    <section className="set-sec">
      <h3>While you follow a thread</h3>
      <label className="notify-opt">
        <input type="checkbox" checked={file} onChange={() => setShowFile(!file)} />
        <span><b>Show the file it works on</b><small>A small window with the file the agent is reading or writing</small></span>
      </label>
      <label className="notify-opt">
        <input type="checkbox" checked={showReads} onChange={() => setShowReads(!showReads)} />
        <span><b>Show reads</b><small>A line to each file the agent reads, as it reads it (R)</small></span>
      </label>
    </section>
  );
}

/** Folders as one circle until zoomed into (map/fold.ts). */
function FoldSetting() {
  const on = useFoldOn();
  return (
    <section className="set-sec">
      <h3>Folders</h3>
      <label className="notify-opt">
        <input type="checkbox" checked={on} onChange={() => setFoldOn(!on)} />
        <span><b>Group files into folders</b><small>A folder shows as one circle until you zoom in or click it, or an agent works in it</small></span>
      </label>
    </section>
  );
}

/** Where a step's file opens (lib/editor.ts). */
function EditorSetting() {
  const editor = useEditor();
  return (
    <section className="set-sec">
      <h3>Open files in</h3>
      <div className="theme-list view-list" role="radiogroup" aria-label="Open files in">
        {EDITORS.map((e) => (
          <button key={e.id} role="radio" aria-checked={editor === e.id} className={`theme-opt view-opt ${editor === e.id ? "on" : ""}`} onClick={() => setEditor(e.id)}>
            <span className="theme-text"><b>{e.name}</b></span>
          </button>
        ))}
      </div>
    </section>
  );
}

/** Desktop notifications when a thread needs you (attention). Local app only: a replay has no live agents. */
function NotifySetting() {
  const { on, toggle, supported } = useNotifyPref();
  if (!supported || isReplay()) return null;
  const blocked = typeof Notification !== "undefined" && Notification.permission === "denied";
  return (
    <section className="set-sec">
      <h3>Notifications</h3>
      <label className="notify-opt">
        <input type="checkbox" checked={on} disabled={blocked} onChange={toggle} />
        <span><b>Tell me when an agent needs me</b><small>{blocked ? "Blocked in this browser's site settings" : "A permission, a question, a plan to approve, or a finished turn, while this tab is in the background"}</small></span>
      </label>
    </section>
  );
}

/** Anonymous usage stats (lib/usage.ts, server usage/usage.service.ts): on by default, one click turns them off. */
function UsageSetting() {
  const { status, toggle } = useUsageSetting();
  if (!status || isReplay()) return null;
  const note = status.locked ? `Off: ${status.locked}`
    : !status.sends ? "Nothing is sent from a development build"
    : "Once a day: how much you used Rundown (counts only), its version, your OS and country. Never code, paths, prompts or names.";
  return (
    <section className="set-sec">
      <h3>Usage stats</h3>
      <label className="notify-opt">
        <input type="checkbox" checked={status.enabled} disabled={!!status.locked} onChange={toggle} />
        <span><b>Share anonymous usage stats</b><small>{note}</small></span>
      </label>
      <a className="usage-more" href="https://github.com/Djbrl/brainstorm#usage-stats" target="_blank" rel="noopener">Exactly what's sent</a>
    </section>
  );
}
