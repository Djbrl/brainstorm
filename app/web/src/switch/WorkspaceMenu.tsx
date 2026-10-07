// Owner: switcher. The project's name, first in the tab bar: a click lists your other projects (the ones Claude Code and
// Codex worked in lately, the workspace picker's list) to hop to in one click, and "All projects…" for the picker.
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import type { WorkspaceSuggestion } from "@contract";
import { clock, useLiveActions } from "../lib/live";
import { useNavActions } from "../lib/nav";
import { enterProject } from "../lib/switcher";
import { relTime } from "../follow/format";

const SHOWN = 8;

export function WorkspaceMenu({ project, root, onAll }: { project: string; root: string; onAll: () => void }) {
  const nav = useNavActions();
  const { reload } = useLiveActions();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<WorkspaceSuggestion[] | null>(null);
  const [at, setAt] = useState({ top: 0, left: 0 });
  const box = useRef<HTMLButtonElement>(null), pop = useRef<HTMLDivElement>(null);

  // Asked each time it opens: the list moves with your agents.
  useEffect(() => {
    if (!open) return;
    fetch("/api/workspace/suggestions").then((r) => (r.ok ? r.json() : [])).then((l) => setList(Array.isArray(l) ? l : [])).catch(() => setList([]));
    const onDown = (e: PointerEvent) => { const t = e.target as Node; if (!box.current?.contains(t) && !pop.current?.contains(t)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(false); return; }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const items = [...(pop.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
      if (!items.length) return;
      e.preventDefault(); e.stopPropagation();
      const i = items.indexOf(document.activeElement as HTMLButtonElement);
      items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    };
    addEventListener("pointerdown", onDown);
    addEventListener("keydown", onKey, true);
    return () => { removeEventListener("pointerdown", onDown); removeEventListener("keydown", onKey, true); };
  }, [open]);

  const toggle = (e: MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setAt({ top: r.bottom + 8, left: r.left });
    setOpen((o) => !o);
  };
  const hop = (to: string) => { setOpen(false); enterProject(to, nav, reload).catch(() => {}); };
  const here = root.replace(/\/+$/, "");
  const others = (list ?? []).filter((s) => s.exists && s.root.replace(/\/+$/, "") !== here).slice(0, SHOWN);
  const now = clock();
  if (!project) return null;   // no project known yet (the server out of reach)

  return (
    <>
      <button ref={box} className="threadbar-project" onMouseDown={(e) => e.preventDefault()} onClick={toggle} aria-haspopup="menu" aria-expanded={open} title={root}>
        <span>{project}</span>
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" /></svg>
      </button>
      {/* In <body>: the header's backdrop-filter would pin a fixed child to it. */}
      {open && createPortal(
        <div className="elsewhere-pop ws-menu" role="menu" aria-label="Your projects" ref={pop} style={at}>
          {list === null ? <p className="ws-menu-note">Loading your projects…</p>
            : others.length === 0 ? <p className="ws-menu-note">No other project yet.</p>
            : others.map((s) => (
              <button key={s.root} role="menuitem" className="elsewhere-item" onClick={() => hop(s.root)} title={s.root}>
                <span className="elsewhere-text">
                  <b>{s.name}</b>
                  {s.lastActiveAt && <span>{relTime(s.lastActiveAt, now)}</span>}
                </span>
              </button>
            ))}
          <button role="menuitem" className="elsewhere-item ws-menu-all" onClick={() => { setOpen(false); onAll(); }}>All projects…</button>
        </div>,
        document.body,
      )}
    </>
  );
}
