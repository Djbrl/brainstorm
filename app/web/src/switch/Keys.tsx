// Owner: switcher. The app-wide keys: ⌘K finds a thread, ? lists every shortcut, L locks the camera, R shows reads,
// P switches between the map and Places. A key that flips something you can't see says so for a moment.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavActions, useNavState } from "../lib/nav";
import { getCameraLock, setCameraLock } from "../map/prefs";
import { Picker } from "./Picker";
import { isTyping, SHORTCUTS } from "./shortcuts";

export function Keys({ finding, setFinding }: { finding: boolean; setFinding: (v: boolean) => void }) {
  const { replay, lens, showReads } = useNavState();
  const { setShowReads, setLens } = useNavActions();
  const [help, setHelp] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastT = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const say = (s: string) => { setToast(s); clearTimeout(toastT.current); toastT.current = setTimeout(() => setToast(null), 1400); };
  const now = useRef({ replay, lens, showReads }); now.current = { replay, lens, showReads };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") { e.preventDefault(); setFinding(!finding); return; }
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || finding) return;
      const { replay, lens, showReads } = now.current;
      switch (e.key) {
        case "?": setHelp((h) => !h); break;
        case "l": case "L": { const on = !getCameraLock(); setCameraLock(on); say(on ? "Camera locked on the agent" : "Camera free"); break; }
        case "r": case "R": if (!replay) return; setShowReads(!showReads); say(showReads ? "Reads hidden" : "Showing reads"); break;
        case "p": case "P": if (!replay) return; setLens(lens === "places" ? "map" : "places"); break;
        default: return;
      }
      e.preventDefault();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [finding, setFinding, setShowReads, setLens]);

  return <>
    {finding && <Picker onClose={() => setFinding(false)} />}
    {help && <Help onClose={() => setHelp(false)} />}
    {toast && createPortal(<div className="key-toast" role="status">{toast}</div>, document.body)}
  </>;
}

function Help({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" || e.key === "?") { e.preventDefault(); e.stopPropagation(); onClose(); } };
    addEventListener("keydown", onKey, true);
    return () => removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return createPortal(
    <div className="picker-veil" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="keys-sheet" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
        <header className="settings-head">
          <h2>Keyboard shortcuts</h2>
          <button className="settings-close" aria-label="Close" onClick={onClose}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg></button>
        </header>
        <div className="keys-body">
          {SHORTCUTS.map((g) => (
            <section key={g.title}>
              <h3>{g.title}</h3>
              <dl>
                {g.keys.map((k) => (
                  <div key={k.what}><dt>{k.keys.map((x, i) => x === "…" ? <span key={i}>to</span> : <kbd key={i}>{x}</kbd>)}</dt><dd>{k.what}</dd></div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
