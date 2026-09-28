// Owned by the lead. PROTOTYPE: a task as a journey through places, driven by scroll.
// Places are stations (websites, folders, command-line tools, services), laid out in the order the agent first went
// there, one band per kind. Scrolling moves the agent's marker along its route; what it saw rides with it.
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import type { TaskDetail, TaskStep } from "@contract";
import { clockTime } from "../follow/format";
import "./journey.css";

type Area = "web" | "services" | "files" | "commands";
type Moment = { step: TaskStep; place: string; area: Area; frame: number; prompt?: string };
type Visit = { place: string; area: Area; from: number; to: number };

const WEB = /^(navigate|computer|find|browser batch|get page text|read page|form input|javascript tool|preview start|preview screenshot|read console messages|read network requests|WebFetch|WebSearch|screenshot|scroll|click)$/i;
const FILES = /^(Read|Edit|Write|MultiEdit|Grep|Glob|NotebookEdit|LS)$/;
const BAND: Record<Area, number> = { web: 0.2, services: 0.42, files: 0.64, commands: 0.86 };
const AREA_NAME: Record<Area, string> = { web: "Web", services: "Services", files: "Files", commands: "Terminal" };
const COLOR: Record<Area, string> = { web: "#5b5bd6", services: "#b25fd6", files: "#1f9d7a", commands: "#e0673a" };
const SHELL_UTILS = new Set(["cat", "ls", "mkdir", "cd", "echo", "grep", "rg", "find", "sed", "awk", "head", "tail", "wc", "cp", "mv", "rm", "sleep", "printf", "test", "touch", "chmod", "pwd", "which", "sort", "uniq", "tr", "cut", "xargs", "tee", "du", "stat", "file", "diff", "open", "kill", "pkill", "lsof", "ps", "for", "while", "if", "true", "sh", "bash", "zsh", "export", "source"]);
const STEP_PX = 22;   // scroll distance per moment
const GAP_X = 170;    // distance between stations

function hostOf(detail = "") {
  const d = detail.replace(/^https?:\/\//, "");
  return (d.split(" · ")[0].split("/")[0] || "Website").replace(/^www\./, "");
}
function folderOf(detail = "") {
  const parts = detail.replace(/^\.\//, "").split("/").filter(Boolean);
  parts.pop(); // the file
  if (!parts.length) return "Project root";
  if (parts[0] === "~") return parts.slice(0, 3).join("/");
  return parts.slice(0, 2).join("/");
}
function programOf(detail = "") {
  const seg = detail.split(/&&|;|\|\||\|/).map((s) => s.trim()).find((s) => s && !/^cd\s/.test(s)) ?? detail;
  const w = seg.split(/\s+/).filter((x) => !/^[A-Z_][A-Z0-9_]*=/.test(x));
  const prog = (w[0] ?? "shell").split("/").pop()!.slice(0, 18) || "shell";
  return SHELL_UTILS.has(prog) ? "shell" : prog; // everyday utilities are one station, real tools get their own
}

/** A preview of the image or video a file step touched, if the task made or used it. */
function fileImage(task: TaskDetail, detail = ""): string | undefined {
  const tail = detail.replace(/^~/, "").replace(/^\.\//, "");
  if (!tail) return undefined;
  const hit = [...task.made, ...task.files].find((f) => f.src && (f.kind === "image" || f.kind === "video") && (f.path.endsWith("/" + tail) || f.path.endsWith(tail)));
  return hit?.src ? (hit.kind === "video" ? `${hit.src}&frame=1` : hit.src) : undefined;
}

function place(s: TaskStep): { area: Area; place: string } {
  if (s.tool === "WebSearch") return { area: "web", place: "Web search" };
  if (WEB.test(s.tool) || /^https?:/.test(s.detail ?? "")) return { area: "web", place: hostOf(s.detail) };
  if (FILES.test(s.tool)) return { area: "files", place: folderOf(s.detail) };
  if (s.tool === "Bash") return { area: "commands", place: programOf(s.detail) };
  return { area: "services", place: s.tool.length > 22 ? s.tool.slice(0, 21) + "…" : s.tool };
}

function useScrollIndex(scroller: RefObject<HTMLElement | null>, track: RefObject<HTMLElement | null>, count: number) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const top = (track.current?.offsetTop ?? 0);
        setI(Math.max(0, Math.min(count - 1, Math.floor((el.scrollTop - top + 40) / STEP_PX))));
      });
    };
    on();
    el.addEventListener("scroll", on, { passive: true });
    return () => { el.removeEventListener("scroll", on); cancelAnimationFrame(raf); };
  }, [scroller, track, count]);
  return i;
}

export function TaskJourney({ task, scroller }: { task: TaskDetail; scroller: RefObject<HTMLElement | null> }) {
  const track = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1000, h: 460 });

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Moments (every call), visits (runs of moments at one place) and stations (places, by first visit).
  const { moments, visits, stations, visitOf } = useMemo(() => {
    const moments: Moment[] = [];
    let frame = -1;
    let prompt: string | undefined;
    for (const b of task.beats) {
      if (b.prompt) prompt = b.prompt;
      for (const s of b.steps) {
        if (s.frame !== undefined) frame = s.frame;
        moments.push({ step: s, ...place(s), frame, prompt });
      }
    }
    const visits: Visit[] = [];
    const visitOf: number[] = [];
    moments.forEach((m, i) => {
      const last = visits[visits.length - 1];
      if (last && last.place === m.place && last.area === m.area) last.to = i;
      else visits.push({ place: m.place, area: m.area, from: i, to: i });
      visitOf[i] = visits.length - 1;
    });
    const stations = new Map<string, { key: string; place: string; area: Area; x: number; order: number; visits: number }>();
    for (const v of visits) {
      const key = `${v.area}|${v.place}`;
      const s = stations.get(key);
      if (s) s.visits++;
      else stations.set(key, { key, place: v.place, area: v.area, x: 90 + stations.size * GAP_X, order: stations.size, visits: 1 });
    }
    return { moments, visits, stations, visitOf };
  }, [task]);

  const i = useScrollIndex(scroller, track, moments.length);
  const m = moments[i];
  if (!m) return <p className="tk-empty pad">This task has no steps to follow.</p>;

  const yOf = (area: Area, order: number) => size.h * BAND[area] + (order % 2 ? 16 : -16);
  const pos = (v: Visit) => { const s = stations.get(`${v.area}|${v.place}`)!; return { x: s.x, y: yOf(s.area, s.order) }; };
  const vi = visitOf[i];
  const here = pos(visits[vi]);
  const camX = here.x - size.w * 0.38;

  // Trail: the last 12 hops, older ones fainter; the next 6, dashed.
  const trail = visits.slice(Math.max(0, vi - 12), vi + 1).map(pos);
  const ahead = visits.slice(vi, vi + 7).map(pos);
  const curve = (pts: { x: number; y: number }[]) => pts.map((p, k) => {
    if (!k) return `M${p.x} ${p.y}`;
    const q = pts[k - 1], mx = (q.x + p.x) / 2;
    return `C${mx} ${q.y} ${mx} ${p.y} ${p.x} ${p.y}`;
  }).join(" ");

  const visited = new Set(visits.slice(0, vi + 1).map((v) => `${v.area}|${v.place}`));
  const frameSrc = m.frame >= 0 ? task.frames[m.frame]?.src : undefined;
  const madeNow = task.made.find((a) => a.firstStepId === m.step.id || a.stepId === m.step.id);
  const madeSoFar = task.made.filter((a) => a.exists && a.firstTs <= m.step.ts).sort((a, b) => b.firstTs.localeCompare(a.firstTs));
  const progress = moments.length > 1 ? i / (moments.length - 1) : 1;

  // What rides with the marker: the page it sees, the file it made, or the command it runs.
  let bubble: ReactNode;
  if (m.area === "web" && frameSrc) bubble = <img src={frameSrc} alt="" />;
  else if (madeNow?.src && (madeNow.kind === "image" || madeNow.kind === "video")) bubble = <img src={madeNow.kind === "video" ? `${madeNow.src}&frame=1` : madeNow.src} alt="" />;
  else if (m.area === "commands") bubble = <pre className="tj-term">$ {m.step.detail}{m.step.explain ? `\n\n${m.step.explain.slice(0, 3).join("\n")}` : ""}</pre>;
  else if (m.area === "files" && fileImage(task, m.step.detail)) bubble = <img src={fileImage(task, m.step.detail)} alt="" className="contain" />;
  else if (m.area === "files") bubble = <div className="tj-file"><b>{(m.step.detail ?? "").split("/").pop()}</b><span>{m.step.tool === "Read" ? "reading" : m.step.tool === "Grep" || m.step.tool === "Glob" ? "searching" : "writing"}</span></div>;
  else if (frameSrc) bubble = <img src={frameSrc} alt="" />;
  else bubble = <div className="tj-file"><b>{m.step.tool}</b><span>{m.place}</span></div>;
  const bx = Math.min(Math.max(here.x - camX - 130, 12), size.w - 272);
  const above = here.y > size.h * 0.5;

  return (
    <div className="tj">
      <div className="tj-sticky">
        <div className="tj-top">
          <div className="tj-request">{m.prompt ? <><span>You asked</span>{m.prompt}</> : <span>Start</span>}</div>
          <div className="tj-progress"><i style={{ width: `${progress * 100}%` }} /></div>
        </div>
        <div className="tj-stage" ref={stage}>
          <div className="tj-bands">{(Object.keys(BAND) as Area[]).map((a) => <span key={a} style={{ top: `${BAND[a] * 100}%`, color: COLOR[a] }}>{AREA_NAME[a]}</span>)}</div>
          <svg width={size.w} height={size.h}>
            <g className="tj-cam" style={{ transform: `translateX(${-camX}px)` }}>
              <path d={curve(ahead)} className="tj-ahead" />
              {trail.slice(1).map((p, k) => <path key={k} d={curve([trail[k], p])} className="tj-trail" stroke={COLOR[m.area]} style={{ opacity: 0.12 + 0.6 * ((k + 1) / trail.length) }} />)}
              {[...stations.values()].map((s) => {
                const y = yOf(s.area, s.order), on = s.key === `${m.area}|${m.place}`;
                if (s.x < camX - 200 || s.x > camX + size.w + 200) return null;
                return (
                  <g key={s.key} className={`tj-station ${visited.has(s.key) ? "seen" : ""} ${on ? "on" : ""}`} transform={`translate(${s.x} ${y})`}>
                    <circle r={on ? 11 : 7 + Math.min(4, s.visits / 3)} fill={visited.has(s.key) ? COLOR[s.area] : "#fff"} stroke={COLOR[s.area]} />
                    <text y={s.order % 2 ? 26 : -18} textAnchor="middle">{s.place}</text>
                  </g>
                );
              })}
              <g className="tj-marker" style={{ transform: `translate(${here.x}px, ${here.y}px)` }}>
                <circle r="17" className="tj-halo" stroke={COLOR[m.area]} />
                <circle r="6" fill="#1d1d1f" />
              </g>
            </g>
          </svg>
          <div className={`tj-bubble ${above ? "above" : "below"}`} style={{ left: bx, top: above ? here.y - 176 : here.y + 28 }}>{bubble}</div>
        </div>
        <div className="tj-caption">
          <div><b>{m.step.label}</b><span style={{ color: COLOR[m.area] }}>{AREA_NAME[m.area]} · {m.place}</span></div>
          <span className="tj-time">{clockTime(m.step.ts)} · step {i + 1} of {moments.length}</span>
        </div>
        <div className="tj-made">
          <span>Made so far</span>
          {madeSoFar.length === 0 && <em>nothing yet</em>}
          {madeSoFar.slice(0, 10).map((a) => (
            <span key={a.path} className={`tj-chip ${a.path === madeNow?.path ? "new" : ""}`} title={a.path}>
              {a.src && (a.kind === "image" || a.kind === "video") ? <img src={a.kind === "video" ? `${a.src}&frame=1` : a.src} alt="" /> : null}{a.name}
            </span>
          ))}
          {madeSoFar.length > 10 && <em>+{madeSoFar.length - 10}</em>}
        </div>
      </div>
      <div ref={track} style={{ height: moments.length * STEP_PX }} aria-hidden />
    </div>
  );
}
