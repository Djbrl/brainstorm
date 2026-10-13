// The app-wide keys: ⌘K finds a thread, ? lists every shortcut, M shows or hides the
// Readmap (on the map), P switches between the map and Places. (Reads show or hide in Settings.)
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { tourStore } from "../lib/tour";
import { useNavActions, useNavState } from "../lib/nav";
import { getReadmap, setReadmap } from "../map/prefs";
import { Picker } from "./Picker";
import { useDialogFocus } from "../lib/useDialogFocus";
import { SHORTCUTS, useShortcut } from "./shortcuts";

export function Keys({ finding, setFinding, help, setHelp }: {
  finding: boolean; setFinding: (v: boolean) => void;
  help: boolean; setHelp: (v: boolean | ((h: boolean) => boolean)) => void;
}) {
  const { thread, lens } = useNavState();
  const { setLens } = useNavActions();

  useShortcut("find", (e) => { if (e?.defaultPrevented) return false; e?.preventDefault(); setFinding(!finding); });
  // The single keys wait while Find a thread is open.
  useShortcut("help", () => { if (finding) return false; setHelp((h) => !h); });
  useShortcut("readmap", () => { if (finding || lens !== "map") return false; setReadmap(!getReadmap()); });
  useShortcut("lens", () => { if (finding || !thread) return false; setLens(lens === "places" ? "map" : "places"); });

  return <>
    {finding && <Picker onClose={() => setFinding(false)} />}
    {help && <Help onClose={() => setHelp(false)} />}
  </>;
}

function Help({ onClose }: { onClose: () => void }) {
  // The window has the keyboard while open (Esc closes it, Tab stays in it); ? closes it too.
  const sheet = useRef<HTMLDivElement>(null);
  useDialogFocus(sheet, onClose);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "?") { e.preventDefault(); e.stopPropagation(); onClose(); } };
    addEventListener("keydown", onKey, true);
    return () => removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return createPortal(
    <div className="picker-veil" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="keys-sheet" role="dialog" aria-modal="true" aria-labelledby="keys-title" tabIndex={-1} ref={sheet}>
        <header className="settings-head">
          <h2 id="keys-title">Keyboard shortcuts</h2>
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
        <p className="keys-tour">New here? <button onClick={() => { onClose(); tourStore.start(); }}>Take the tour</button></p>
      </div>
    </div>,
    document.body,
  );
}
