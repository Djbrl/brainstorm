// Owned by the lead. The first visit: one card that says what you're looking at, and one choice. Nothing plays until you
// ask for it. Shown once per browser (and on the hosted demo, once per visitor).
import { useRef, useState } from "react";
import { isReplay, useLive } from "../lib/live";
import { useNav } from "../lib/nav";
import { useDialogFocus } from "../lib/useDialogFocus";
import { markWelcomed, welcomed } from "../lib/visit";
import "./welcome.css";

export function Welcome() {
  const { state } = useLive();
  const { startReplay, setReplayPlaying } = useNav();
  const [open, setOpen] = useState(() => !welcomed());
  const latest = [...state.sessions].sort((a, b) => b.lastEventAt.localeCompare(a.lastEventAt))[0];
  const close = () => { markWelcomed(); setOpen(false); };
  // The card has the keyboard while it shows: its first button has the focus, Tab stays on its buttons, Esc looks around.
  const card = useRef<HTMLDivElement>(null);
  useDialogFocus(card, close, open && !!state.map);
  if (!open || !state.map) return null;
  const watch = () => {
    close();
    if (!latest) return;
    startReplay(latest.id, 0, { mode: "play" });
    setReplayPlaying(true);
  };
  const demo = isReplay();
  return (
    <div className="welcome" role="dialog" aria-modal="true" aria-labelledby="welcome-title" tabIndex={-1} ref={card}>
      <h2 id="welcome-title">{demo ? "Agents building Rundown" : "This is your project"}</h2>
      <p>
        Each dot is a file, grouped by folder. When an agent works, it shows up here as a dot moving between the files
        it reads and changes.{demo ? " This is a recording of Claude Code agents building this app." : ""}
      </p>
      <p className="welcome-sub">Your threads are on the left. Open one to see what it touched, then its steps or its replay.</p>
      <div className="welcome-actions">
        {latest && <button className="welcome-primary" onClick={watch}>{demo ? "Watch the replay" : "Watch your latest thread"}</button>}
        <button className="welcome-quiet" onClick={close}>Look around</button>
      </div>
    </div>
  );
}
