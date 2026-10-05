// Owned by the lead. The settings button in the header: for now, the map theme.
import { useEffect, useRef, useState } from "react";
import { useNotifyPref } from "../lib/attention";
import { isReplay } from "../lib/live";
import { setTheme, THEMES, useTheme } from "../lib/theme";
import "./settings.css";

export function SettingsButton() {
  const [open, setOpen] = useState(false);
  const theme = useTheme();
  const box = useRef<HTMLDivElement>(null);

  // Close on a click outside or Esc (Esc closes the menu only, it doesn't also step back out of a thread).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); setOpen(false); } };
    addEventListener("pointerdown", onDown);
    addEventListener("keydown", onKey, true);
    return () => { removeEventListener("pointerdown", onDown); removeEventListener("keydown", onKey, true); };
  }, [open]);

  return (
    <div className="settings" ref={box}>
      <button className="ws-chip settings-btn" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((o) => !o)}>Settings</button>
      {open && (
        <div className="settings-pop" role="dialog" aria-label="Settings">
          <h3>Map theme</h3>
          <div className="theme-list" role="radiogroup" aria-label="Map theme">
            {THEMES.map((t) => (
              <button key={t.id} role="radio" aria-checked={theme === t.id} className={`theme-opt ${theme === t.id ? "on" : ""}`} onClick={() => setTheme(t.id)}>
                <span className={`theme-swatch sw-${t.id}`} aria-hidden="true" />
                <span className="theme-text"><b>{t.name}</b><small>{t.note}</small></span>
              </button>
            ))}
          </div>
          <NotifySetting />
        </div>
      )}
    </div>
  );
}

/** Desktop notifications when a thread needs you (attention). Local app only: a replay has no live agents. */
function NotifySetting() {
  const { on, toggle, supported } = useNotifyPref();
  if (!supported || isReplay()) return null;
  const blocked = typeof Notification !== "undefined" && Notification.permission === "denied";
  return (
    <>
      <h3>Notifications</h3>
      <label className="notify-opt">
        <input type="checkbox" checked={on} disabled={blocked} onChange={toggle} />
        <span><b>Tell me when an agent needs me</b><small>{blocked ? "Blocked in this browser's site settings" : "A permission, a question, a plan to approve, or a finished turn, while this tab is in the background"}</small></span>
      </label>
    </>
  );
}
