// Owner: C. Pick a workspace, then a loading checklist while Brainstorm reads the code and connects to Claude Code.
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { SetupStatus, SetupStep, WorkspaceSuggestion } from "@contract";
import { clock, useLive } from "../lib/live";
import { relTime } from "../follow/format";
import "./setup.css";

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;
const nameOf = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

async function getSuggestions(): Promise<WorkspaceSuggestion[]> {
  const r = await fetch("/api/workspace/suggestions");
  if (!r.ok) return [];
  const d = await r.json();
  return Array.isArray(d) ? d : [];
}

async function openWorkspace(root: string): Promise<SetupStatus> {
  const r = await fetch("/api/workspace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ root }) });
  if (!r.ok) {
    let msg = `Couldn't open that folder (${r.status}).`;
    try { const b = await r.json(); msg = (Array.isArray(b.message) ? b.message.join(" ") : b.message) || b.error || msg; } catch { /* keep default */ }
    throw new Error(msg);
  }
  return r.json();
}

async function getStatus(): Promise<SetupStatus | null> {
  try { const r = await fetch("/api/workspace"); return r.ok ? r.json() : null; } catch { return null; }
}

/* ---------- Pick ---------- */

function Pick({ onOpened, onCancel }: { onOpened: (s: SetupStatus, root: string) => void; onCancel?: () => void }) {
  const [list, setList] = useState<WorkspaceSuggestion[] | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const now = clock();

  useEffect(() => { getSuggestions().then(setList).catch(() => setList([])); }, []);
  useEffect(() => { inputRef.current?.focus(); }, []);
  // The rows come in once, when the list first loads, not again on every keystroke of a filter.
  const [intro, setIntro] = useState(true);
  useEffect(() => { if (!list) return; const t = setTimeout(() => setIntro(false), 900); return () => clearTimeout(t); }, [list]);

  // One field: type to filter the projects, or paste a folder path to open any folder.
  const q = query.trim();
  const isPath = /^(\/|~|[A-Za-z]:\\)/.test(q);
  const shown = !list ? null : !q ? list
    : isPath ? list.filter((s) => s.root.toLowerCase().startsWith(q.toLowerCase()))   // projects under the path typed so far
    : list.filter((s) => `${s.name} ${s.root}`.toLowerCase().includes(q.toLowerCase()));

  const open = async (root: string) => {
    const r = root.trim();
    if (!r || busy) return;
    setBusy(r); setError(null);
    try { onOpened(await openWorkspace(r), r); }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn't open that folder."); setBusy(null); }
  };
  const submit = () => {
    if (isPath) return open(q);
    const first = shown?.find((s) => s.exists);
    if (first) open(first.root);
  };

  const items = () => [...(listRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const all = items(), i = all.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === "ArrowDown" ? i + 1 : i - 1;
    if (next < 0) inputRef.current?.focus();
    else all[Math.min(all.length - 1, next)]?.focus();
  };

  return (
    <div className="su-col su-pick">
      {onCancel && <button className="su-back" onClick={onCancel}><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M10 3.5L5.5 8l4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>Back</button>}
      <h1 className="su-title">Pick a workspace</h1>
      <p className="su-lede">Brainstorm maps the code in a folder and follows the Claude Code agents working in it, live.</p>

      <form className="su-find" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <svg className="su-find-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="4.8" stroke="currentColor" strokeWidth="1.6" /><path d="M10.6 10.6L14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        <input ref={inputRef} className="su-input" value={query} placeholder="Find a project, or paste a folder path" spellCheck={false} autoComplete="off" aria-label="Find a project, or paste a folder path"
          onChange={(e) => { setQuery(e.target.value); setError(null); }}
          onKeyDown={(e) => { if (e.key === "ArrowDown") { e.preventDefault(); items()[0]?.focus(); } }} />
        {isPath && <button className="su-btn" type="submit" disabled={!!busy}>{busy === q ? <span className="su-spin light" /> : "Open"}</button>}
      </form>
      {error && <p className="su-error" role="alert">{error}</p>}

      {shown === null ? (
        <div className="su-list">{[0, 1, 2, 3].map((i) => <div key={i} className="su-skel" style={{ animationDelay: `${i * 90}ms` }}><span /><span /></div>)}</div>
      ) : shown.length > 0 ? (
        <div className={`su-list ${intro ? "intro" : ""}`} ref={listRef} onKeyDown={onListKey} role="listbox" aria-label="Claude Code projects on this computer">
          {shown.map((s, i) => (
            <button key={s.root} className={`su-ws ${s.exists ? "" : "gone"} ${busy === s.root ? "busy" : ""}`} disabled={!s.exists || !!busy} onClick={() => open(s.root)} style={{ animationDelay: `${Math.min(i, 10) * 35}ms` }} role="option" aria-selected={false}>
              <span className="su-ws-main">
                <span className="su-ws-name">{s.name || nameOf(s.root)}</span>
                <span className="su-ws-path">{s.root}</span>
              </span>
              <span className="su-ws-meta">
                {!s.exists ? "folder not found" : <>{plural(s.sessions, "thread")}{s.lastActiveAt && <><br />{relTime(s.lastActiveAt, now)}</>}</>}
              </span>
              <span className="su-ws-go">{busy === s.root ? <span className="su-spin" /> : <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 3.5L10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="su-none">{isPath ? "Press Enter to open this folder." : list?.length ? `No project matches “${q}”. Paste its folder path to open it.` : "No Claude Code projects found on this computer yet. Paste a folder path above."}</p>
      )}
      {shown && shown.length > 0 && <p className="su-count">{q ? `${shown.length} of ${list!.length} projects` : plural(list!.length, "project")} with Claude Code threads</p>}
    </div>
  );
}

/* ---------- Loading ---------- */

function StateGlyph({ state }: { state: SetupStep["state"] }) {
  return (
    <span className={`su-glyph ${state}`}>
      {state === "running" ? <span className="su-spin" />
        : state === "done" ? <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path className="su-draw" d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        : state === "warn" ? <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 4v5M8 11.8v.2" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
        : state === "error" ? <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M5 5l6 6M11 5l-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
        : <span className="su-pend" />}
    </span>
  );
}

function Loading({ status, root, onDone, onBack }: { status: SetupStatus | null; root: string; onDone: () => void; onBack: () => void }) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const ready = !!status?.ready;
  const steps = status?.steps ?? [];
  const summaries = steps.find((s) => s.id === "summaries");
  const failed = steps.some((s) => s.state === "error") && !ready;

  useEffect(() => { if (ready) btnRef.current?.focus(); }, [ready]);

  return (
    <div className="su-col">
      <h1 className="su-title su-name">{status?.name || nameOf(root)}</h1>
      <p className="su-lede su-path-shown">{status?.root || root}</p>

      <ol className="su-steps">
        {steps.length === 0 && <li className="su-step"><StateGlyph state="running" /><div className="su-step-body"><div className="su-step-label">Getting started</div></div></li>}
        {steps.map((s, i) => {
          const pct = s.total ? Math.min(100, Math.round(((s.done ?? 0) / s.total) * 100)) : null;
          return (
            <li key={s.id} className={`su-step ${s.state}`} style={{ animationDelay: `${i * 90}ms` }}>
              <StateGlyph state={s.state} />
              <div className="su-step-body">
                <div className="su-step-top">
                  <span className="su-step-label">{s.label}</span>
                  {s.total ? <span className="su-step-count">{s.done ?? 0} / {s.total}</span> : null}
                </div>
                {pct !== null && <div className="su-prog"><span style={{ width: `${pct}%` }} /></div>}
                {s.detail && <div className={`su-step-detail ${s.state === "warn" || s.state === "error" ? "hint" : ""}`}>{s.detail}</div>}
              </div>
            </li>
          );
        })}
      </ol>

      <div className="su-actions">
        <button ref={btnRef} className="su-btn big" disabled={!ready} onClick={onDone}>
          {ready ? "Open Brainstorm" : <><span className="su-spin light" />Getting ready</>}
        </button>
        <button className="su-link" onClick={onBack}>{failed ? "Pick another folder" : "Choose a different folder"}</button>
      </div>
      {ready && summaries && summaries.state === "running" && (
        <p className="su-note">File summaries keep filling in in the background. The map gets richer as they land.</p>
      )}
    </div>
  );
}

/* ---------- Screen ---------- */

export function SetupView({ onDone, onCancel }: { onDone: () => void; onCancel?: () => void }) {
  const { state } = useLive();
  const [phase, setPhase] = useState<"pick" | "loading">("pick");
  const [root, setRoot] = useState("");
  const [status, setStatus] = useState<SetupStatus | null>(null);

  // While loading: poll, and also take live ws updates for the same workspace.
  useEffect(() => {
    if (phase !== "loading") return;
    let alive = true;
    const t = setInterval(() => { getStatus().then((s) => { if (alive && s) setStatus(s); }); }, 700);
    return () => { alive = false; clearInterval(t); };
  }, [phase]);
  useEffect(() => { if (phase === "loading" && state.setup?.root && state.setup.root === status?.root) setStatus(state.setup); }, [state.setup, phase, status?.root]);

  return (
    <div className="su-root">
      <div className="su-wordmark">Brainstorm</div>
      {phase === "pick" ? (
        <Pick onCancel={onCancel} onOpened={(s, r) => { setStatus(s); setRoot(r); setPhase("loading"); }} />
      ) : (
        <Loading status={status} root={root} onDone={onDone} onBack={() => { setPhase("pick"); setStatus(null); }} />
      )}
    </div>
  );
}
