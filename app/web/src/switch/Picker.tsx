// Owner: switcher. Find a thread (⌘K): every thread of this project, newest first, and below them the threads at work in
// your other projects. Type to narrow, ↑ ↓ to choose, Enter to open. A thread elsewhere switches the project first.
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ElsewhereThread, Session } from "@contract";
import { useLiveActions, useLiveSelector, clock } from "../lib/live";
import { useNavActions, useNavState } from "../lib/nav";
import { attentionText, needsYou, yourTurn } from "../lib/attention";
import { isCodex } from "../lib/harness";
import { relTime } from "../follow/format";
import { jumpElsewhere, openThread, useElsewhere } from "../lib/switcher";
import { elsewhereWord } from "./Elsewhere";

type Item = { kind: "here"; s: Session } | { kind: "else"; t: ElsewhereThread };

export function Picker({ onClose }: { onClose: () => void }) {
  const sessions = useLiveSelector((s) => s.sessions);
  const attention = useLiveSelector((s) => s.attention);
  const elsewhere = useElsewhere();
  const { replay } = useNavState();
  const nav = useNavActions();
  const { reload } = useLiveActions();
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  const now = clock();

  const items = useMemo<Item[]>(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const hit = (...texts: (string | undefined)[]) => { const t = texts.join(" ").toLowerCase(); return words.every((w) => t.includes(w)); };
    const here = [...sessions]
      .sort((a, b) => (a.status === "running" ? 0 : 1) - (b.status === "running" ? 0 : 1) || b.lastEventAt.localeCompare(a.lastEventAt))
      .filter((s) => hit(s.title, isCodex(s) ? "codex" : ""))
      .slice(0, words.length ? 50 : 12)
      .map((s): Item => ({ kind: "here", s }));
    const away = elsewhere.filter((t) => hit(t.title, t.project, t.harness === "codex" ? "codex" : "")).map((t): Item => ({ kind: "else", t }));
    return [...here, ...away];
  }, [q, sessions, elsewhere]);

  useEffect(() => { setAt(0); }, [q]);
  useEffect(() => { list.current?.querySelector<HTMLElement>(`[data-i="${at}"]`)?.scrollIntoView({ block: "nearest" }); }, [at]);

  const choose = (it: Item | undefined) => {
    if (!it) return;
    onClose();
    if (it.kind === "here") { if (it.s.id !== replay?.sessionId) openThread(nav, it.s); }
    else jumpElsewhere(it.t, nav, reload).catch(() => {});
  };

  // Esc closes the window only (capture: before the shell's Esc steps back out of a thread).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); } };
    addEventListener("keydown", onKey, true);
    return () => removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const firstElse = items.findIndex((x) => x.kind === "else");
  return createPortal(
    <div className="picker-veil" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="picker" role="dialog" aria-modal="true" aria-label="Find a thread">
        <input autoFocus className="picker-input" placeholder="Find a thread" value={q} aria-controls="picker-list"
          aria-activedescendant={items.length ? `picker-${at}` : undefined}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setAt((i) => Math.min(items.length - 1, i + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setAt((i) => Math.max(0, i - 1)); }
            else if (e.key === "Enter") { e.preventDefault(); choose(items[at]); }
          }} />
        <ul className="picker-list" id="picker-list" role="listbox" ref={list}>
          {items.length === 0 && <li className="picker-empty">No thread matches “{q}”.</li>}
          {items.map((it, i) => (
            <li key={it.kind === "here" ? it.s.id : `x${it.t.sessionId}`} role="presentation">
              {i === firstElse && <h3 className="picker-head">In your other projects</h3>}
              <button id={`picker-${i}`} data-i={i} role="option" aria-selected={i === at} className={`picker-item ${i === at ? "on" : ""}`}
                onPointerMove={() => setAt(i)} onClick={() => choose(it)}>
                {it.kind === "here" ? <HereRow s={it.s} open={it.s.id === replay?.sessionId} a={attention[it.s.id]} now={now} /> : <ElseRow t={it.t} />}
              </button>
            </li>
          ))}
        </ul>
        <footer className="picker-foot"><span><kbd>↑</kbd><kbd>↓</kbd> choose</span><span><kbd>↵</kbd> open</span><span><kbd>Esc</kbd> close</span></footer>
      </div>
    </div>,
    document.body,
  );
}

function HereRow({ s, open, a, now }: { s: Session; open: boolean; a: Parameters<typeof needsYou>[0]; now: number }) {
  const blocked = needsYou(a), turn = yourTurn(a);
  const running = s.status === "running";
  return <>
    <span className={`threadbar-dot ${blocked ? "waiting" : running ? "running" : ""}`} aria-hidden="true" />
    <span className="picker-title">{s.title || "Untitled thread"}</span>
    {isCodex(s) && <span className="threadbar-harness">Codex</span>}
    {a && (blocked || turn) && <span className={`threadbar-attn ${blocked ? "blocked" : "turn"}`}>{attentionText(a).badge}</span>}
    <span className="picker-meta">{open ? "Open" : running ? "Working" : relTime(s.lastEventAt, now)}</span>
  </>;
}

function ElseRow({ t }: { t: ElsewhereThread }) {
  return <>
    <span className={`threadbar-dot ${t.state === "needs-you" ? "waiting" : t.state === "working" ? "running" : ""}`} aria-hidden="true" />
    <span className="picker-title">{t.title || "Untitled thread"}</span>
    {t.harness === "codex" && <span className="threadbar-harness">Codex</span>}
    <span className="picker-meta"><b>{t.project}</b> · {elsewhereWord(t.state)}</span>
  </>;
}
