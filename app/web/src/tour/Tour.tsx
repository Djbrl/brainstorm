// Owned by the lead. Welcome card + 5-step spotlight tour. Shown only in the hosted replay (recorded demo).
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNav, type View } from "../lib/nav";
import "./tour.css";

const SEEN_KEY = "brainstorm-tour-seen";
// (The preview lives on its own domain, so its "seen" flag is separate.)
const REPO = "https://github.com/Djbrl/brainstorm";

type Step = { target?: string; view?: View; title: string; body: string };
const PREVIEW_STEPS: Step[] = [
  { target: '[data-tour="tab-map"]', view: "map", title: "Live agents", body: "Each agent is a marker on the file it is working on. It glides to the next file and leaves a trail. A failed step flashes red. These are real moves, recorded while agents built Brainstorm." },
  { target: ".map-sidebar", view: "map", title: "Threads", body: "Click a thread to replay it on the map, step by step. Its steps fill the sidebar; click one to jump there." },
  { target: '[data-tour="tab-follow"]', view: "follow", title: "Follow", body: "Every step of a session as a timeline. Click an edit to see its diff." },
  { title: "Watch your own agents", body: "Brainstorm is a Claude Code plugin. Install it from github.com/Djbrl/brainstorm and run /brainstorm:open." },
];

const STEPS: Step[] = [
  { target: ".fl-sessions", view: "follow", title: "Sessions", body: "Every Claude Code session and subagent on the machine, live." },
  { target: ".fl-timeline", view: "follow", title: "Follow", body: "Each agent step with a short AI label (NVIDIA Nemotron on Brev). Click an edit to see its diff, or ask why it happened." },
  { target: '[data-tour="tab-map"]', title: "Map", body: "Modules and imports. Color = how recently agents changed it. Pulse = an agent editing right now." },
  { target: '[data-tour="tab-failures"]', title: "Failures", body: "Recurring tool-call errors grouped and ranked, with the evidence steps." },
  { title: "Run it on your own agents", body: "github.com/Djbrl/brainstorm (README has setup)." },
];

function seen(): boolean {
  try { return localStorage.getItem(SEEN_KEY) === "1"; } catch { return false; }
}
function markSeen() {
  try { localStorage.setItem(SEEN_KEY, "1"); } catch { /* storage blocked: the card simply shows again next time */ }
}

type Rect = { top: number; left: number; width: number; height: number };

export function Tour({ openSignal, preview = false }: { openSignal: number; preview?: boolean }) {
  const steps = preview ? PREVIEW_STEPS : STEPS;
  const { setView } = useNav();
  const [mode, setMode] = useState<"welcome" | "tour" | null>(() => (seen() ? null : "welcome"));
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const primary = useRef<HTMLButtonElement>(null);

  // "?" in the header reopens the tour.
  useEffect(() => { if (openSignal > 0) { setI(0); setMode("welcome"); } }, [openSignal]);

  const close = useCallback(() => { markSeen(); setMode(null); }, []);
  const step = steps[i];

  // Switch to the view the step needs, then measure its target.
  useEffect(() => { if (mode === "tour" && step.view) setView(step.view); }, [mode, i, step.view, setView]);
  useLayoutEffect(() => {
    if (mode !== "tour" || !step.target) { setRect(null); return; }
    let raf = 0;
    const measure = () => {
      const el = document.querySelector(step.target!);
      if (!el) { setRect(null); return; }
      const r = el.getBoundingClientRect();
      const pad = 6, vw = window.innerWidth, vh = window.innerHeight;
      const top = Math.max(4, r.top - pad), left = Math.max(4, r.left - pad);
      setRect({ top, left, width: Math.min(vw - 4, r.right + pad) - left, height: Math.min(vh - 4, r.bottom + pad) - top });
    };
    raf = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", measure); };
  }, [mode, i, step.target]);

  useEffect(() => { primary.current?.focus(); }, [mode, i]);

  useEffect(() => {
    if (!mode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (mode === "tour" && e.key === "ArrowRight" && i < steps.length - 1) setI(i + 1);
      else if (mode === "tour" && e.key === "ArrowLeft" && i > 0) setI(i - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, i, close]);

  if (!mode) return null;

  if (mode === "welcome") {
    return (
      <div className="tour-scrim" onClick={close}>
        <div className="tour-card tour-welcome" role="dialog" aria-modal="true" aria-labelledby="tour-title" onClick={(e) => e.stopPropagation()}>
          <h2 id="tour-title">Welcome to Brainstorm</h2>
          {preview
            ? <p>A live map of your agents. You're watching a recording: Claude Code agents building Brainstorm itself, played back step by step. Install the plugin to watch your own.</p>
            : <p>A live map of your code and of the AI agents writing it. You're watching a recording of Brainstorm following its own build, live during the GOMYCODE × NVIDIA hackathon on 27 Sep 2026.</p>}
          <div className="tour-actions">
            <button className="tour-ghost" onClick={close}>Skip</button>
            <button ref={primary} className="tour-primary" onClick={() => { setI(0); setMode("tour"); }}>Take the tour</button>
          </div>
        </div>
      </div>
    );
  }

  const last = i === steps.length - 1;
  // Tooltip placement: below, else above, else beside, else inside the target. Always kept on screen.
  let tipStyle: React.CSSProperties = {};
  if (rect) {
    const vw = window.innerWidth, vh = window.innerHeight, w = Math.min(360, vw - 24), h = 220;
    const clampX = (x: number) => Math.min(Math.max(12, x), vw - 12 - w);
    const clampY = (y: number) => Math.min(Math.max(12, y), vh - 12 - h);
    const below = rect.top + rect.height + 12;
    if (below + h < vh) tipStyle = { top: below, left: clampX(rect.left) };
    else if (rect.top - 12 - h > 0) tipStyle = { top: rect.top - 12 - h, left: clampX(rect.left) };
    else if (rect.left + rect.width + 12 + w < vw) tipStyle = { top: clampY(rect.top + 24), left: rect.left + rect.width + 12 };
    else tipStyle = { top: clampY(rect.top + 24), left: clampX(rect.left + 24) };
  }

  return (
    <div className="tour-layer">
      {rect
        ? <div className="tour-spot" style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }} />
        : <div className="tour-scrim" />}
      <div className={`tour-card tour-tip ${rect ? "" : "tour-center"}`} style={tipStyle} role="dialog" aria-modal="true" aria-labelledby="tour-step-title">
        <div className="tour-count">{i + 1} of {steps.length}</div>
        <h2 id="tour-step-title">{step.title}</h2>
        <p>{step.body}</p>
        {last && <a className="tour-repo" href={REPO} target="_blank" rel="noreferrer">Open the repo on GitHub</a>}
        <div className="tour-actions">
          <button className="tour-ghost" onClick={close}>Skip</button>
          {i > 0 && <button className="tour-ghost" onClick={() => setI(i - 1)}>Back</button>}
          <button ref={primary} className="tour-primary" onClick={() => (last ? close() : setI(i + 1))}>{last ? "Done" : "Next"}</button>
        </div>
      </div>
    </div>
  );
}
