// Owned by the lead. The settings button in the header: for now, the map theme.
import { useEffect, useRef, useState } from "react";
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
      <button className="settings-btn" aria-label="Settings" aria-expanded={open} aria-haspopup="dialog" title="Settings" onClick={() => setOpen((o) => !o)}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 6.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8Z" /><path d="M8.6 2h2.8l.5 2.2 1.6.9 2.1-.8 1.4 2.4-1.7 1.5v1.6l1.7 1.5-1.4 2.4-2.1-.8-1.6.9-.5 2.2H8.6l-.5-2.2-1.6-.9-2.1.8L3 13.4l1.7-1.5v-1.8L3 8.6l1.4-2.4 2.1.8 1.6-.9z" /></svg>
      </button>
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
        </div>
      )}
    </div>
  );
}
