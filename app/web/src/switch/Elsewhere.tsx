// Owner: switcher. In the header, only when it's true: agents at work in your other projects ("1 agent in skindiff"),
// amber when one waits on you. A click lists them; picking one switches to its project and opens the thread.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ElsewhereThread } from "@contract";
import { useLiveActions } from "../lib/live";
import { useNavActions } from "../lib/nav";
import { jumpElsewhere, useElsewhere } from "../lib/switcher";

export const elsewhereWord = (s: ElsewhereThread["state"]) => (s === "needs-you" ? "Needs you" : s === "your-turn" ? "Your turn" : "Working");

export function Elsewhere() {
  const list = useElsewhere();
  const nav = useNavActions();
  const { reload } = useLiveActions();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null), pop = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState({ top: 0, right: 0 });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { const t = e.target as Node; if (!box.current?.contains(t) && !pop.current?.contains(t)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(false); } };
    addEventListener("pointerdown", onDown);
    addEventListener("keydown", onKey, true);
    return () => { removeEventListener("pointerdown", onDown); removeEventListener("keydown", onKey, true); };
  }, [open]);
  useEffect(() => { if (!list.length) setOpen(false); }, [list.length]);

  if (!list.length) return null;
  const waiting = list.some((t) => t.state === "needs-you");
  const projects = [...new Set(list.map((t) => t.project))];
  const n = list.length;
  const label = `${n} agent${n > 1 ? "s" : ""} in ${projects.length === 1 ? projects[0] : `${projects.length} other projects`}`;
  return (
    <div className="elsewhere" ref={box}>
      <button className={`ws-chip elsewhere-btn ${waiting ? "waiting" : ""}`} aria-expanded={open} aria-haspopup="true" onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setAt({ top: r.bottom + 10, right: innerWidth - r.right });
          setOpen((o) => !o);
        }}
        title={waiting ? "An agent in another project is waiting on you" : "Agents at work in your other projects"}>
        <span className={`threadbar-dot ${waiting ? "waiting" : "running"}`} aria-hidden="true" />
        <span className="elsewhere-long">{label}</span><span className="elsewhere-short" aria-label={label}>{n}</span>
      </button>
      {/* In <body>: the header's backdrop-filter would pin a fixed child to the header. */}
      {open && createPortal(
        <div className="elsewhere-pop" role="menu" aria-label="Agents in your other projects" ref={pop} style={at}>
          {list.map((t) => (
            <button key={t.sessionId} role="menuitem" className="elsewhere-item" onClick={() => { setOpen(false); jumpElsewhere(t, nav, reload).catch(() => {}); }}
              title={`Switch to ${t.project} and open this thread`}>
              <span className={`threadbar-dot ${t.state === "needs-you" ? "waiting" : t.state === "working" ? "running" : ""}`} aria-hidden="true" />
              <span className="elsewhere-text">
                <b>{t.project}</b>
                <span>{t.title || "Untitled thread"}{t.harness === "codex" ? " · Codex" : ""}</span>
              </span>
              <span className={`elsewhere-state ${t.state}`}>{elsewhereWord(t.state)}</span>
            </button>
          ))}
          <p className="elsewhere-note">Opening one switches Rundown to its project.</p>
        </div>,
        document.body,
      )}
    </div>
  );
}
