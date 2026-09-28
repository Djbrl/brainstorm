// Owned by the lead. Tasks: any agent session as a story. The goal, a filmstrip of what the agent saw,
// how it did it, what it made, and where it got things. A storyboard, not a graph: a task is a sequence.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TaskArtifact, TaskBeat, TaskDetail, TaskFileKind, TaskFrame, TaskListItem, TaskSourceFile, TaskStep } from "@contract";
import { useNav } from "../lib/nav";
import { clockTime, relTime, stripInjected } from "../follow/format";
import "./tasks.css";

const KIND_NAME: Record<TaskListItem["kind"], string> = { code: "Code", web: "Web", media: "Media", docs: "Writing", mixed: "Other" };
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

function duration(a: string, b: string) {
  const m = Math.round((Date.parse(b) - Date.parse(a)) / 60000);
  if (!Number.isFinite(m) || m < 1) return "under a minute";
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ""}`.trim();
}
function bytes(n?: number) {
  if (n === undefined) return "";
  return n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`;
}
const shortPath = (p: string, cwd: string) => (cwd && p.startsWith(cwd + "/") ? p.slice(cwd.length + 1) : p.replace(/^\/Users\/[^/]+/, "~"));

function useTasks() {
  const [list, setList] = useState<TaskListItem[] | null>(null);
  useEffect(() => {
    let stop = false;
    const load = () => fetch("/api/tasks").then((r) => (r.ok ? r.json() : Promise.reject(r.status))).then((d: TaskListItem[]) => !stop && setList(d)).catch(() => {});
    load();
    const t = setInterval(load, 10_000);
    return () => { stop = true; clearInterval(t); };
  }, []);
  return list;
}

function useTask(id: string | null, live: boolean) {
  const [task, setTask] = useState<TaskDetail | null>(null);
  useEffect(() => {
    setTask(null);
    if (!id) return;
    let stop = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    // Retries until it loads (the server may be restarting), then refreshes every 3 s while the task is live.
    const load = () => fetch(`/api/tasks/${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: TaskDetail) => !stop && setTask(d))
      .catch(() => { if (!stop) retry = setTimeout(load, 2000); });
    load();
    const t = live ? setInterval(load, 3000) : undefined;
    return () => { stop = true; if (t) clearInterval(t); if (retry) clearTimeout(retry); };
  }, [id, live]);
  return task;
}

// ---- filmstrip player: the agent's screenshots, in order ----

function Player({ task, at, setAt, follow, setFollow }: { task: TaskDetail; at: number; setAt: (i: number) => void; follow: boolean; setFollow: (v: boolean) => void }) {
  const frames = task.frames;
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const strip = useRef<HTMLDivElement>(null);
  const f = frames[at];

  useEffect(() => {
    if (!playing) return;
    if (at >= frames.length - 1) { setPlaying(false); return; }
    const t = setTimeout(() => setAt(at + 1), 1100 / speed);
    return () => clearTimeout(t);
  }, [playing, at, speed, frames.length, setAt]);

  useEffect(() => { strip.current?.querySelector<HTMLElement>(`[data-i="${at}"]`)?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" }); }, [at]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, [contenteditable]")) return;
      if (e.key === "ArrowRight") { setFollow(false); setAt(Math.min(frames.length - 1, at + 1)); e.preventDefault(); }
      else if (e.key === "ArrowLeft") { setFollow(false); setAt(Math.max(0, at - 1)); e.preventDefault(); }
      else if (e.key === " " && !(e.target as HTMLElement)?.closest("button")) { setPlaying((p) => !p); e.preventDefault(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [at, frames.length, setAt, setFollow]);

  if (!f) return null;
  return (
    <section className="tk-player" aria-label="What the agent saw">
      <div className="tk-stage">
        <img key={f.src} src={f.src} alt={f.caption} />
        {task.live && follow && at === frames.length - 1 && <span className="tk-live-badge">Live</span>}
      </div>
      <div className="tk-caption">
        <div className="tk-cap-main">
          <strong>{f.caption}</strong>
          {f.page && <span>{f.page}</span>}
        </div>
        <div className="tk-controls">
          <button onClick={() => { setFollow(false); setAt(Math.max(0, at - 1)); }} disabled={at === 0} aria-label="Previous frame">‹</button>
          <button className="tk-play" onClick={() => { setFollow(false); if (at >= frames.length - 1) setAt(0); setPlaying(!playing); }} aria-label={playing ? "Pause" : "Play"}>{playing ? "❚❚" : "▶"}</button>
          <button onClick={() => { setFollow(false); setAt(Math.min(frames.length - 1, at + 1)); }} disabled={at === frames.length - 1} aria-label="Next frame">›</button>
          <button className="tk-speed" onClick={() => setSpeed(speed === 1 ? 2 : speed === 2 ? 4 : 1)} title="Playback speed">{speed}×</button>
          <span className="tk-count">{at + 1} / {frames.length} · {clockTime(f.ts)}</span>
          {task.live && <label className="tk-follow"><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Follow live</label>}
        </div>
      </div>
      <div className="tk-strip" ref={strip}>
        {frames.map((fr, i) => (
          <button key={`${fr.stepId}/${fr.idx}`} data-i={i} className={i === at ? "on" : ""} onClick={() => { setFollow(false); setPlaying(false); setAt(i); }} title={`${clockTime(fr.ts)} · ${fr.caption}`}>
            <img src={fr.src} alt="" loading="lazy" />
          </button>
        ))}
      </div>
    </section>
  );
}

// ---- how it did it ----

function StepRow({ s, sessionId, current, onFrame }: { s: TaskStep; sessionId: string; current: boolean; onFrame: (i: number) => void }) {
  const [open, setOpen] = useState(false);
  const { openStep } = useNav();
  return (
    <li className={`tk-step ${s.failed ? "failed" : ""} ${current ? "current" : ""} ${s.subagent ? "sub" : ""}`}>
      <div className="tk-step-line">
        <span className="tk-tool">{s.tool}</span>
        <span className="tk-label">{s.label}</span>
        {s.failed && <span className="tk-failed">failed</span>}
        {s.frame !== undefined && <button className="tk-cam" onClick={() => onFrame(s.frame!)} title="Show what the agent saw">◉</button>}
      </div>
      {s.detail && <button className={`tk-detail ${open ? "open" : ""}`} onClick={() => setOpen(!open)} title="Show the whole step">{s.detail}</button>}
      {s.explain && (
        <details className="tk-explain">
          <summary>How this command works</summary>
          <ol>{s.explain.map((e, i) => <li key={i}>{e}</li>)}</ol>
        </details>
      )}
      {open && <button className="tk-open-follow" onClick={() => openStep(sessionId, s.id)}>Open in Follow</button>}
    </li>
  );
}

function Beat({ b, sessionId, currentCall, onFrame }: { b: TaskBeat; sessionId: string; currentCall?: string; onFrame: (i: number) => void }) {
  const [all, setAll] = useState(false);
  const [long, setLong] = useState(false);
  const { openStep } = useNav();
  const shown = all ? b.steps : b.steps.slice(0, 6);
  const hasCurrent = !!currentCall && b.steps.some((s) => s.id === currentCall);
  useEffect(() => { if (hasCurrent && !all && !shown.some((s) => s.id === currentCall)) setAll(true); }, [hasCurrent, all, shown, currentCall]);
  const text = stripInjected(b.text ?? "");
  return (
    <li className={`tk-beat ${b.prompt ? "prompt" : ""}`}>
      {b.prompt ? (
        <div className="tk-you"><span>You</span><p>{b.prompt}</p></div>
      ) : text ? (
        <p className={`tk-say ${long ? "open" : ""}`} onClick={() => setLong(!long)}>{text}</p>
      ) : null}
      {b.steps.length > 0 && (
        <ul className="tk-steps">
          {shown.map((s) => (
            <Fragment key={s.id}>
              <StepRow s={s} sessionId={sessionId} current={s.id === currentCall} onFrame={onFrame} />
            </Fragment>
          ))}
          {b.steps.length > shown.length && <li><button className="tk-more" onClick={() => setAll(true)}>Show {b.steps.length - shown.length} more steps</button></li>}
        </ul>
      )}
      {b.prompt && b.id !== "start" && <button className="tk-open-follow subtle" onClick={() => openStep(sessionId, b.id)}>Open in Follow</button>}
    </li>
  );
}

// ---- what it made, where it got things ----

const ICON: Record<TaskFileKind, string> = { image: "▣", video: "▶", audio: "♪", pdf: "PDF", doc: "¶", data: "{ }", code: "</>", other: "·" };

function Thumb({ kind, src }: { kind: TaskFileKind; src?: string }) {
  const [broken, setBroken] = useState(false);
  if (src && !broken && kind === "image") return <img className="tk-thumb" src={src} alt="" loading="lazy" onError={() => setBroken(true)} />;
  if (src && !broken && kind === "video") return <img className="tk-thumb" src={`${src}&frame=1`} alt="" loading="lazy" onError={() => setBroken(true)} />;
  return <span className={`tk-thumb icon k-${kind}`}>{ICON[kind]}</span>;
}

type Previewable = { name: string; kind: TaskFileKind; src?: string; path: string };

function Lightbox({ item, onClose }: { item: Previewable; onClose: () => void }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    if ((item.kind === "doc" || item.kind === "data" || item.kind === "code") && item.src) fetch(item.src).then((r) => r.text()).then((t) => setText(t.slice(0, 40_000))).catch(() => setText("Couldn't read this file."));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [item, onClose]);
  return (
    <div className="tk-lightbox" role="dialog" aria-label={item.name} onClick={onClose}>
      <div className="tk-lb-body" onClick={(e) => e.stopPropagation()}>
        <header><strong>{item.name}</strong><span>{item.path.replace(/^\/Users\/[^/]+/, "~")}</span><button onClick={onClose} aria-label="Close">×</button></header>
        {item.kind === "image" && <img src={item.src} alt={item.name} />}
        {item.kind === "video" && <video src={item.src} controls autoPlay muted playsInline />}
        {item.kind === "audio" && <audio src={item.src} controls autoPlay />}
        {item.kind === "pdf" && <iframe src={item.src} title={item.name} />}
        {(item.kind === "doc" || item.kind === "data" || item.kind === "code") && <pre>{text ?? "Loading…"}</pre>}
      </div>
    </div>
  );
}

const FILTERS: { id: string; label: string; kinds: TaskFileKind[] }[] = [
  { id: "all", label: "All", kinds: [] },
  { id: "media", label: "Media", kinds: ["image", "video", "audio"] },
  { id: "docs", label: "Writing", kinds: ["doc", "pdf"] },
  { id: "code", label: "Code", kinds: ["code"] },
  { id: "data", label: "Data", kinds: ["data", "other"] },
];

function Made({ task, onOpen }: { task: TaskDetail; onOpen: (p: Previewable) => void }) {
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.id, f.kinds.length ? task.made.filter((a) => f.kinds.includes(a.kind)).length : task.made.length])), [task.made]);
  const [filter, setFilter] = useState(() => (counts.media ? "media" : counts.docs ? "docs" : "all"));
  const shown = task.made.filter((a) => filter === "all" || FILTERS.find((f) => f.id === filter)!.kinds.includes(a.kind)).slice(0, 80);
  if (!task.made.length) return <p className="tk-empty">Nothing saved to a file.</p>;
  return (
    <>
      <div className="tk-filters">
        {FILTERS.filter((f) => f.id === "all" || counts[f.id]).map((f) => (
          <button key={f.id} className={filter === f.id ? "on" : ""} onClick={() => setFilter(f.id)}>{f.label} <span>{counts[f.id]}</span></button>
        ))}
      </div>
      <ul className="tk-files">
        {shown.map((a: TaskArtifact) => (
          <li key={a.path} className={a.exists ? "" : "gone"}>
            <button onClick={() => a.src && onOpen(a)} disabled={!a.src} title={a.src ? "Preview" : a.exists ? "No preview for this kind of file" : "This file doesn't exist anymore"}>
              <Thumb kind={a.kind} src={a.src} />
              <span className="tk-file-name">{a.name}<small>{shortPath(a.path, task.cwd).replace(/\/?[^/]*$/, "") || "."}</small></span>
              <span className="tk-file-meta">{a.exists ? bytes(a.bytes) : "gone"}<small>{a.edits > 1 ? `${a.via} · ${a.edits}×` : a.via}</small></span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function Sources({ task, onOpen }: { task: TaskDetail; onOpen: (p: Previewable) => void }) {
  if (!task.web.length && !task.files.length) return <p className="tk-empty">No websites or outside files.</p>;
  return (
    <>
      {task.web.map((s) => (
        <div className="tk-site" key={s.site}>
          <div className="tk-site-head"><span className="tk-favicon">{s.site === "Web search" ? "⌕" : s.site.replace(/^www\./, "")[0]?.toUpperCase()}</span><strong>{s.site}</strong><span>{plural(s.visits, "visit")}</span></div>
          <ul>
            {s.searches.map((q) => <li key={q} className="tk-search">Searched “{q}”</li>)}
            {s.pages.slice(0, 8).map((p) => (
              <li key={p.page}><a href={p.url} target="_blank" rel="noreferrer noopener">{p.title || p.page.replace(s.site, "") || "/"}</a>{p.visits > 1 && <small>×{p.visits}</small>}</li>
            ))}
            {s.pages.length > 8 && <li className="tk-muted">and {plural(s.pages.length - 8, "more page")}</li>}
          </ul>
        </div>
      ))}
      {task.files.length > 0 && (
        <div className="tk-site">
          <div className="tk-site-head"><span className="tk-favicon">⌂</span><strong>Files it used</strong><span>{task.files.length}</span></div>
          <ul className="tk-files compact">
            {task.files.slice(0, 20).map((f: TaskSourceFile) => (
              <li key={f.path} className={f.exists ? "" : "gone"}>
                <button onClick={() => f.src && onOpen(f)} disabled={!f.src}><Thumb kind={f.kind} src={f.src} /><span className="tk-file-name">{f.name}<small>{shortPath(f.path, task.cwd)}</small></span></button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

// ---- the view ----

function TaskStory({ task }: { task: TaskDetail }) {
  const { openStep } = useNav();
  const [at, setAt] = useState(Math.max(0, task.frames.length - 1));
  const [follow, setFollow] = useState(task.live);
  const [preview, setPreview] = useState<Previewable | null>(null);
  const frame: TaskFrame | undefined = task.frames[at];

  useEffect(() => { setAt(Math.max(0, task.frames.length - 1)); setFollow(task.live); }, [task.sessionId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (follow) setAt(Math.max(0, task.frames.length - 1)); }, [follow, task.frames.length]);
  const jump = useCallback((i: number) => { setFollow(false); setAt(i); document.querySelector(".tk-player")?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, []);

  const agentBeats = task.beats.filter((b) => !b.prompt && (b.text || b.steps.length));
  return (
    <div className="tk-story">
      <header className="tk-head">
        <h1>{task.goal || "Untitled task"}</h1>
        <p className="tk-sub">
          {task.live ? <span className="tk-live"><i />Working now</span> : <>{relTime(task.lastAt)}</>}
          <span className="sep">·</span>{duration(task.startedAt, task.lastAt)}
          <span className="sep">·</span>{plural(task.counts.steps, "step")}
          {task.prompts.length > 1 && <><span className="sep">·</span>{plural(task.prompts.length, "request")}</>}
          <button className="tk-link" onClick={() => openStep(task.sessionId, task.beats[0]?.id ?? "")}>Open in Follow</button>
        </p>
      </header>

      {task.frames.length > 0
        ? <Player task={task} at={at} setAt={setAt} follow={follow} setFollow={setFollow} />
        : <p className="tk-noframes">No screenshots in this task: its tools didn't take any. Browser and computer-use work shows up here as a filmstrip.</p>}

      <div className="tk-columns">
        <section className="tk-how">
          <h2>How it did it</h2>
          <p className="tk-hint">{plural(agentBeats.length, "stretch")} of work, in the agent's words. ◉ shows what it saw.</p>
          <ol className="tk-beats">
            {task.beats.map((b) => <Beat key={b.id} b={b} sessionId={task.sessionId} currentCall={frame?.callId} onFrame={jump} />)}
          </ol>
        </section>
        <aside className="tk-side">
          <section>
            <h2>What it made</h2>
            <Made task={task} onOpen={setPreview} />
          </section>
          {task.outside.length > 0 && (
            <section>
              <h2>Outside this computer</h2>
              <ul className="tk-outside">
                {task.outside.slice(-30).reverse().map((o, i) => (
                  <li key={`${o.stepId}${i}`}><strong className={`v-${o.verb}`}>{o.verb}</strong><span>{o.what}</span><small>{o.site} · {clockTime(o.ts)}{o.confidence === "likely" ? " · likely" : ""}</small></li>
                ))}
              </ul>
            </section>
          )}
          <section>
            <h2>Where it got things</h2>
            <Sources task={task} onOpen={setPreview} />
          </section>
        </aside>
      </div>
      {preview && <Lightbox item={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

export function TasksView() {
  const list = useTasks();
  const [selected, setSelected] = useState<string | null>(() => new URLSearchParams(location.search).get("task"));
  const current = list?.find((t) => t.sessionId === selected) ?? null;
  const task = useTask(selected, !!current?.live);

  useEffect(() => { if (!selected && list?.length) setSelected(list[0].sessionId); }, [list, selected]);
  useEffect(() => {
    const u = new URL(location.href);
    if (selected) u.searchParams.set("task", selected); else u.searchParams.delete("task");
    history.replaceState(null, "", u);
    return () => { const v = new URL(location.href); v.searchParams.delete("task"); history.replaceState(null, "", v); };
  }, [selected]);

  return (
    <div className="tk-root">
      <nav className="tk-list" aria-label="Tasks">
        <div className="tk-list-head"><h2>Tasks</h2><p>Everything your agents did, as stories you can replay.</p></div>
        {!list && <p className="tk-empty pad">Loading…</p>}
        {list?.length === 0 && <p className="tk-empty pad">No agent sessions in this workspace yet.</p>}
        <ul>
          {list?.map((t) => (
            <li key={t.sessionId}>
              <button className={t.sessionId === selected ? "on" : ""} onClick={() => setSelected(t.sessionId)}>
                <span className="tk-goal">{t.live && <i className="tk-dot" />}{t.goal}</span>
                <span className="tk-meta">{relTime(t.lastAt)}<span className="sep">·</span>{KIND_NAME[t.kind]}{t.counts.frames > 0 && <><span className="sep">·</span>{plural(t.counts.frames, "frame")}</>}{t.counts.made > 0 && <><span className="sep">·</span>{t.counts.made} made</>}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <main className="tk-main">
        {task ? <TaskStory task={task} /> : selected ? <p className="tk-empty pad">Loading the task…</p> : null}
      </main>
    </div>
  );
}
