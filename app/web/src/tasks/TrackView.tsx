// Owned by the lead. Track: the selected thread as a vertical line, top to bottom in time. Each stop is a stretch of
// work in one place (a file, a website, a command-line tool, a service). A new place is a full stop; going back to an
// earlier place is a short "return" row. Your requests split it into chapters. Failed calls are red. The window on the
// right stays in view and shows what the agent saw or made at the stop you're on. Same sidebar as the map.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { TaskArtifact, TaskDetail, TaskStep } from "@contract";
import { useLive } from "../lib/live";
import { replayCursor, useNav } from "../lib/nav";
import { clockTime, stripInjected } from "../follow/format";
import { MapSidebar } from "../map/sidebar/MapSidebar";
import { LensSwitch } from "../map/LensSwitch";
import { MapStats } from "../map/MapStats";
import { TrackCounts } from "../lib/ThreadCounts";
import { StepPanel } from "../map/StepPanel";
import { AskBox } from "../ask/AskBox";
import "./track.css";

type Area = "files" | "web" | "commands" | "services";
type Stop = {
  key: string; area: Area; name: string; sub?: string;
  steps: TaskStep[]; returning: boolean; firstIndex?: number;
  say?: string;               // what the agent said just before
  made: TaskArtifact[];       // files that first appeared here
  failed: TaskStep[];
  frame?: number;             // screenshot to show (its own, or the last one before)
  action: "new" | "edit" | "read" | "search" | "run" | "web" | "tool";
};
type StopRow = { type: "stop"; id: string; stop: Stop; index: number };
type Row = { type: "chapter"; id: string; text: string; ts: string } | StopRow | { type: "bounce"; id: string; rows: StopRow[] };

const WEB = /^(navigate|computer|find|browser batch|get page text|read page|form input|javascript tool|preview start|preview screenshot|read console messages|read network requests|WebFetch|screenshot|scroll|click)$/i;
const FILES = /^(Read|Edit|Write|MultiEdit|Grep|Glob|NotebookEdit|LS)$/;
const SHELL = new Set(["cat", "ls", "mkdir", "cd", "echo", "grep", "rg", "find", "sed", "awk", "head", "tail", "wc", "cp", "mv", "rm", "sleep", "printf", "test", "touch", "chmod", "pwd", "which", "sort", "uniq", "tr", "cut", "xargs", "tee", "du", "stat", "file", "diff", "open", "kill", "pkill", "lsof", "ps", "for", "while", "if", "true", "sh", "bash", "zsh", "export", "source"]);

const base = (p = "") => p.split("/").filter(Boolean).pop() ?? p;
const dir = (p = "") => p.split("/").slice(0, -1).join("/");
function program(cmd = "") {
  const seg = cmd.split(/&&|;|\|\||\|/).map((s) => s.trim()).find((s) => s && !/^cd\s/.test(s)) ?? cmd;
  const w = seg.split(/\s+/).filter((x) => !/^[A-Z_][A-Z0-9_]*=/.test(x));
  const p = (w[0] ?? "shell").split("/").pop() || "shell";
  return SHELL.has(p) ? "shell" : p.slice(0, 20);
}
function placeOf(s: TaskStep): { key: string; area: Area; name: string; sub?: string } {
  if (s.tool === "WebSearch") return { key: "search", area: "web", name: "Web search", sub: s.detail };
  if (WEB.test(s.tool) || /^https?:/.test(s.detail ?? "")) {
    const d = (s.detail ?? "").replace(/^https?:\/\//, "");
    const host = (d.split(" · ")[0].split("/")[0] || "Website").replace(/^www\./, "");
    return { key: `web:${host}`, area: "web", name: host, sub: d.split(" · ")[1] };
  }
  if (FILES.test(s.tool)) {
    if (s.tool === "Grep" || s.tool === "Glob") return { key: "search:files", area: "files", name: "Searched the files", sub: s.detail };
    return { key: `file:${s.detail}`, area: "files", name: base(s.detail) || "a file", sub: dir(s.detail) };
  }
  if (s.tool === "Bash") { const p = program(s.detail); return { key: `cmd:${p}`, area: "commands", name: p === "shell" ? "Terminal" : p, sub: s.label }; }
  return { key: `svc:${s.tool}`, area: "services", name: s.tool, sub: s.label };
}

function buildRows(task: TaskDetail): Row[] {
  const rows: Row[] = [];
  const firstAt = new Map<string, number>();
  const madeAt = new Map<string, TaskArtifact[]>();
  for (const a of task.made) madeAt.set(a.firstStepId, [...(madeAt.get(a.firstStepId) ?? []), a]);
  let say: string | undefined;
  let lastFrame: number | undefined;
  let cur: Stop | null = null;
  let n = 0;
  for (const b of task.beats) {
    if (b.prompt) { rows.push({ type: "chapter", id: b.id, text: b.prompt, ts: b.ts }); cur = null; say = undefined; }
    else if (b.text) say = stripInjected(b.text).split("\n").find((l) => l.trim())?.trim();
    for (const s of b.steps) {
      const p = placeOf(s);
      if (s.frame !== undefined) lastFrame = s.frame;
      if (cur && cur.key === p.key) {
        cur.steps.push(s);
      } else {
        const returning = firstAt.has(p.key);
        cur = { ...p, steps: [s], returning, firstIndex: firstAt.get(p.key), made: [], failed: [], action: "tool", ...(say ? { say } : {}) };
        say = undefined;
        if (!returning) firstAt.set(p.key, n);
        rows.push({ type: "stop", id: s.id, stop: cur, index: n++ });
      }
      if (s.failed) cur.failed.push(s);
      cur.made.push(...(madeAt.get(s.id) ?? []));
      cur.frame = s.frame ?? (p.area === "web" ? lastFrame : cur.frame);
    }
  }
  for (const r of rows) if (r.type === "stop") r.stop.action = actionOf(r.stop);
  return foldBounces(rows);
}

/** Three or more returns in a row (the agent bouncing between places it already knows) fold into one row. */
function foldBounces(rows: Row[]): Row[] {
  const out: Row[] = [];
  let run: StopRow[] = [];
  const flush = () => {
    if (run.length >= 3) out.push({ type: "bounce", id: `b:${run[0].id}`, rows: run });
    else out.push(...run);
    run = [];
  };
  for (const r of rows) {
    if (r.type === "stop" && r.stop.returning && !r.stop.failed.length && !r.stop.made.length) { run.push(r); continue; }
    flush();
    out.push(r);
  }
  flush();
  return out;
}
function actionOf(s: Stop): Stop["action"] {
  if (s.made.length) return "new";
  if (s.area === "web") return "web";
  if (s.area === "commands") return "run";
  if (s.area === "services") return "tool";
  if (s.key === "search:files") return "search";
  return s.steps.some((x) => /^(Edit|Write|MultiEdit|NotebookEdit)$/.test(x.tool)) ? "edit" : "read";
}

// ---- icons ----
const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const ICONS: Record<Stop["action"] | "return" | "error", ReactNode> = {
  new: <><path d="M4 2.5h5l3 3v8H4z" {...P} /><path d="M8 7.5v4M6 9.5h4" {...P} /></>,
  edit: <><path d="M10.2 3.3l2.5 2.5L6 12.5l-3.2.7.7-3.2z" {...P} /></>,
  read: <><path d="M1.8 8s2.3-4.2 6.2-4.2S14.2 8 14.2 8s-2.3 4.2-6.2 4.2S1.8 8 1.8 8z" {...P} /><circle cx="8" cy="8" r="1.8" {...P} /></>,
  search: <><circle cx="7" cy="7" r="3.8" {...P} /><path d="M10 10l3 3" {...P} /></>,
  run: <><path d="M3.5 5l3 3-3 3M8.5 11.5h4" {...P} /></>,
  web: <><circle cx="8" cy="8" r="5.5" {...P} /><path d="M2.5 8h11M8 2.5c1.8 2 1.8 9 0 11M8 2.5c-1.8 2-1.8 9 0 11" {...P} /></>,
  tool: <><path d="M6 2.5v3M10 2.5v3M4.5 5.5h7v2.5a3.5 3.5 0 0 1-7 0zM8 11.5v2" {...P} /></>,
  return: <><path d="M6 4L3 7l3 3" {...P} /><path d="M3 7h6.5a3.5 3.5 0 0 1 0 7H8" {...P} /></>,
  error: <><path d="M8 2.5l6 10.5H2z" {...P} /><path d="M8 7v2.6M8 11.3v.1" {...P} /></>,
};
const Icon = ({ k }: { k: keyof typeof ICONS }) => <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">{ICONS[k]}</svg>;
const VERB: Record<Stop["action"], string> = { new: "Made", edit: "Edited", read: "Read", search: "Searched", run: "Ran", web: "Browsed", tool: "Used" };

// ---- data ----
function useTask(id: string | null, live: boolean) {
  const [task, setTask] = useState<TaskDetail | null>(null);
  useEffect(() => {
    setTask(null);
    if (!id) return;
    let stop = false, retry: ReturnType<typeof setTimeout> | undefined;
    const load = () => fetch(`/api/tasks/${encodeURIComponent(id)}`).then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: TaskDetail) => !stop && setTask(d)).catch(() => { if (!stop) retry = setTimeout(load, 2000); });
    load();
    const t = live ? setInterval(load, 3000) : undefined;
    return () => { stop = true; if (t) clearInterval(t); if (retry) clearTimeout(retry); };
  }, [id, live]);
  return task;
}

// ---- the window: what the agent saw or made at this stop ----
function Window({ task, stop, onMap }: { task: TaskDetail; stop: Stop; onMap: () => void }) {
  const { openStep } = useNav();
  const { state } = useLive();
  // A code edit shows what it wrote (the last edit at this stop), from the full steps the app already has.
  const written = useMemo(() => {
    if (stop.area !== "files") return undefined;
    const all = state.steps[task.sessionId];
    const edit = [...stop.steps].reverse().map((t) => all?.find((x) => x.id === t.id)).find((x) => x?.diff?.after);
    return edit?.diff?.after.split("\n").slice(0, 40).join("\n");
  }, [stop, state.steps, task.sessionId]);
  const frame = stop.frame !== undefined ? task.frames[stop.frame] : undefined;
  const media = stop.made.find((a) => a.src && (a.kind === "image" || a.kind === "video"));
  const cmds = stop.area === "commands" ? stop.steps.map((s) => s.detail).filter(Boolean).slice(0, 3) : [];
  const explain = stop.steps.find((s) => s.explain)?.explain;
  const counts = new Map<string, number>();
  for (const s of stop.steps) counts.set(s.tool, (counts.get(s.tool) ?? 0) + 1);
  return (
    <div className={`trk-window ${stop.failed.length ? "failed" : ""}`}>
      <header>
        <span className={`trk-ico a-${stop.area} ${stop.failed.length ? "err" : ""}`}><Icon k={stop.failed.length ? "error" : stop.action} /></span>
        <div><b>{stop.name}</b>{stop.sub && <small>{stop.sub}</small>}</div>
        <time>{clockTime(stop.steps[0].ts)}</time>
      </header>
      <div className="trk-screen">
        {media?.kind === "video" ? <video key={media.src} src={media.src} controls muted playsInline poster={`${media.src}&frame=1`} />
          : media ? <img key={media.src} src={media.src} alt={media.name} />
          : frame ? <img key={frame.src} src={frame.src} alt={frame.caption} />
          : cmds.length ? <pre className="trk-term">{cmds.map((c) => `$ ${c}`).join("\n\n")}</pre>
          : written ? <pre className="trk-code">{written}</pre>
          : <div className="trk-blank"><Icon k={stop.action} /><span>{[...counts].map(([t, n]) => `${t}${n > 1 ? ` ×${n}` : ""}`).join(" · ")}</span></div>}
      </div>
      {stop.failed.map((s) => <p key={s.id} className="trk-error"><b>Failed:</b> {s.error || s.label}</p>)}
      {explain && <ol className="trk-explain">{explain.map((e, i) => <li key={i}>{e}</li>)}</ol>}
      {stop.say && <p className="trk-say">“{stop.say}”</p>}
      <ul className="trk-steps">{stop.steps.slice(0, 6).map((s) => <li key={s.id} className={s.failed ? "failed" : ""}><span>{s.tool}</span>{s.label}</li>)}{stop.steps.length > 6 && <li className="more">and {stop.steps.length - 6} more</li>}</ul>
      <footer>
        <button onClick={() => openStep(task.sessionId, stop.steps[0].id)} title="Its diff or output, and Ask about it">Open step</button>
        <button onClick={onMap}>Show on map</button>
      </footer>
    </div>
  );
}


function ReturnRow({ r, cur, goTo }: { r: StopRow; cur: number; goTo: (i: number) => void }) {
  return (
    <li key={r.id} data-stop={r.index} className={`trk-return ${r.index === cur ? "on" : ""} ${r.stop.failed.length ? "failed" : ""}`} onClick={() => goTo(r.index)}>
      <i className="trk-dot" /><Icon k={r.stop.failed.length ? "error" : "return"} /><span>Back to <b>{r.stop.name}</b>{r.stop.failed.length ? " · failed" : ""}</span>
      {r.stop.firstIndex !== undefined && <button onClick={(e) => { e.stopPropagation(); goTo(r.stop.firstIndex!); }} title="Go to the first visit">first visit</button>}
    </li>
  );
}

/** Ask about the whole thread, from its Track. Folded until you want it. */
function ThreadAsk({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [sessionId]);
  if (!open) return <button className="trk-ask-open" onClick={() => setOpen(true)}>Ask about this thread</button>;
  return (
    <div className="trk-ask">
      <AskBox context={{ sessionId }} placeholder="What did this thread do, and why?" suggestions={["What did it change, and why?", "What's left to do?", "What went wrong?"]} />
    </div>
  );
}

// ---- the view ----
export function TrackView() {
  const { state } = useLive();
  const { replay, setLens, startReplay, setReplayLive, step: openStepId, showStep } = useNav();
  const session = state.sessions.find((s) => s.id === replay?.sessionId);
  const running = session?.status === "running";
  const task = useTask(replay?.sessionId ?? null, session?.status === "running");
  const rows = useMemo(() => (task ? buildRows(task) : []), [task]);
  const stops = useMemo(() => rows.flatMap((r) => (r.type === "stop" ? [r] : r.type === "bounce" ? r.rows : [])), [rows]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const scroller = useRef<HTMLDivElement>(null);
  const [cur, setCur] = useState(0);
  const landed = useRef<string | null>(null);

  // Which stop is at the reading line (40% down).
  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const line = el.getBoundingClientRect().top + el.clientHeight * 0.4;
    let best = 0;
    el.querySelectorAll<HTMLElement>("[data-stop]").forEach((n) => { if (n.getBoundingClientRect().top <= line) best = Number(n.dataset.stop); });
    setCur(best);
    // Scrolling up stops following a running thread; scrolling back to the bottom follows it again.
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (replay?.live && fromBottom > 240) setReplayLive(false);
    else if (replay && !replay.live && running && fromBottom < 60) setReplayLive(true);
  }, [replay, running, setReplayLive]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let raf = 0;
    const on = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(measure); };
    el.addEventListener("scroll", on, { passive: true });
    return () => { el.removeEventListener("scroll", on); cancelAnimationFrame(raf); };
  }, [measure]);

  const goTo = useCallback((i: number, smooth = true) => {
    const el = scroller.current, n = el?.querySelector<HTMLElement>(`[data-stop="${i}"]`);
    // Positions relative to the scrolling area (offsetTop would be relative to the line).
    if (el && n) el.scrollTo({ top: n.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - el.clientHeight * 0.4 + 10, behavior: smooth ? "smooth" : "auto" });
    setCur(i);
  }, []);

  // Land once per thread: on the step the map replay was on, or at the newest stop when following live.
  useEffect(() => {
    if (!task || !stops.length || landed.current === task.sessionId) return;
    landed.current = task.sessionId;
    // The map's cursor can be on any step (a result, a message): land on the last stop that started at or before it.
    const at = replay?.atStep ?? replayCursor.stepId;
    const atTs = at ? state.steps[task.sessionId]?.find((s) => s.id === at)?.ts : undefined;
    let i = at ? stops.findIndex((r) => r.stop.steps.some((s) => s.id === at)) : -1;
    if (i < 0 && atTs) stops.forEach((r, k) => { if (r.stop.steps[0].ts <= atTs) i = k; });
    setTimeout(() => goTo(replay?.live || i < 0 ? (replay?.live ? stops.length - 1 : 0) : i, false), 0);
  }, [task, stops, replay?.atStep, replay?.live, goTo, state.steps]);
  // Live: new stops keep the track at the bottom.
  useEffect(() => { if (replay?.live && stops.length) setTimeout(() => goTo(stops.length - 1, false), 0); }, [replay?.live, stops.length, goTo]);

  const current = stops[Math.min(cur, stops.length - 1)]?.stop;
  useEffect(() => { if (current) replayCursor.stepId = current.steps[0].id; }, [current]);
  // An open step follows the track as you scroll it: it shows the stop you're on.
  const openRef = useRef(openStepId); openRef.current = openStepId;
  useEffect(() => {
    const id = openRef.current;
    if (current && id && !current.steps.some((s) => s.id === id)) showStep(current.steps[0].id);
  }, [current, showStep]);

  const sidebar = <MapSidebar agents={Object.values(state.agents)} accent="#5b5bd6" followId={null} onFollow={() => setLens("map")} onFocusFile={() => setLens("map")} map={state.map} />;
  if (!replay) {
    return <div className="trk-wrap">{sidebar}<MapStats /><LensSwitch /><div className="trk-empty"><h2>Pick a thread</h2><p>Choose a thread in the sidebar to see its track: every place the agent went, in order, with what it saw and made.</p></div></div>;
  }
  const errors = stops.reduce((n, r) => n + r.stop.failed.length, 0);
  return (
    <div className="trk-wrap">
      {sidebar}
      <MapStats />
      <LensSwitch />
      <StepPanel />
      <div className="trk-scroll" ref={scroller}>
        {!task ? <p className="trk-loading">Loading the thread…</p> : (
          <div className="trk-cols">
            <div className="trk-main">
              <header className="trk-head">
                <h1>{task.goal || session?.title || "Untitled thread"}</h1>
                <TrackCounts sessionId={task.sessionId} failed={errors} screenshots={task.counts.frames} />
                <ThreadAsk sessionId={task.sessionId} />
              </header>
              <ol className="trk-line">
                {rows.map((r) => r.type === "chapter" ? (
                  <li key={r.id} className="trk-chapter"><span>You</span><p>{r.text}</p></li>
                ) : r.type === "bounce" && !open.has(r.id) ? (
                  <li key={r.id} data-stop={r.rows[0].index} className={`trk-return trk-bounce ${r.rows.some((x) => x.index === cur) ? "on" : ""}`} onClick={() => setOpen((o) => new Set(o).add(r.id))} title="Show each step">
                    <i className="trk-dot" /><Icon k="return" /><span>Back and forth between <b>{[...new Set(r.rows.map((x) => x.stop.name))].slice(0, 3).join(", ")}</b>{new Set(r.rows.map((x) => x.stop.name)).size > 3 ? "…" : ""}</span><em>{r.rows.length}</em>
                  </li>
                ) : r.type === "bounce" ? (
                  r.rows.map((x) => <ReturnRow key={x.id} r={x} cur={cur} goTo={goTo} />)
                ) : r.stop.returning ? (
                  <ReturnRow key={r.id} r={r} cur={cur} goTo={goTo} />                ) : (
                  <li key={r.id} data-stop={r.index} className={`trk-stop a-${r.stop.area} ${r.index === cur ? "on" : ""} ${r.stop.failed.length ? "failed" : ""} ${r.stop.made.length ? "made" : ""}`} onClick={() => goTo(r.index)}>
                    <i className="trk-dot" />
                    <span className={`trk-ico a-${r.stop.area} ${r.stop.failed.length ? "err" : ""}`}><Icon k={r.stop.failed.length ? "error" : r.stop.action} /></span>
                    <div className="trk-body">
                      <b>{r.stop.name}</b>
                      <small>{r.stop.failed.length ? `${r.stop.failed.length} failed · ` : ""}{VERB[r.stop.action]}{r.stop.steps.length > 1 ? ` · ${r.stop.steps.length} steps` : ""}{r.stop.sub && r.stop.area !== "commands" ? ` · ${r.stop.sub}` : ""}</small>
                      {r.stop.made.length > 0 && <div className="trk-made">{r.stop.made.slice(0, 4).map((a) => <span key={a.path}>{a.src && a.kind === "image" ? <img src={a.src} alt="" /> : null}{a.name}</span>)}</div>}
                    </div>
                    {r.stop.frame !== undefined && r.stop.area === "web" && <img className="trk-thumb" src={task.frames[r.stop.frame]?.src} alt="" loading="lazy" />}
                  </li>
                ))}
                {session?.status === "running" && <li className="trk-working"><i className="trk-dot" />Working…</li>}
              </ol>
            </div>
            <aside className="trk-side">
              {current && <Window task={task} stop={current} onMap={() => { startReplay(task.sessionId, current.steps[0].id, { live: false }); setLens("map"); }} />}
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
