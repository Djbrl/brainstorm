// Owned by the lead. The first-run tour: a card that points at one part of the screen at a time (the threads, a thread's
// steps, one step, the files, the map with an example agent, the Readmap, the keys) and says what it is, with Skip,
// Back and Next on every step (Esc skips, ← → go back and on). It drives the app itself: it opens the newest thread,
// one of its steps, the Files tab, and closes them again. The extras stay hidden until their step (tour.css), and
// after it they're as Settings has them. Once per install (lib/tour.ts); Settings and the shortcuts list start it again.
// The usage-stats question is its last step. A step with nothing to show (no thread yet, no Readmap on a phone) is left out.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AgentPresence, FileNode, Step } from "@contract";
import { useLive } from "../../lib/live";
import { END, useNav } from "../../lib/nav";
import { PRIVACY_URL, useUsageSetting } from "../../lib/usage";
import { TOUR_AGENT, tourStore, useTour, type TourStep } from "../../lib/tour";
import { getReadmap } from "../prefs";
import "./tour.css";

type Card = { title: string; body: string; anchor?: string };

const PHONE = "(max-width: 600px)";
const WALK_MS = 1500;    // the example agent's pace

export function Tour() {
  const step = useTour((t) => t.step);
  const { state, loadSteps } = useLive();
  const nav = useNav();
  const usage = useUsageSetting();
  useEffect(() => { tourStore.load(); }, []);

  const latest = useMemo(() => [...state.sessions].sort((a, b) => b.lastEventAt.localeCompare(a.lastEventAt))[0], [state.sessions]);
  const steps = latest ? state.steps[latest.id] : undefined;
  useEffect(() => { if (step && latest && !steps) loadSteps(latest.id); }, [step, latest?.id, !!steps]);
  // The step to open: its newest edit, else its newest call.
  const shown: Step | undefined = useMemo(() => {
    const all = steps ?? [];
    return [...all].reverse().find((s) => s.kind === "edit") ?? [...all].reverse().find((s) => s.kind === "tool_call");
  }, [steps]);
  const asks = !!usage.status && !usage.status.asked && !usage.status.locked && usage.status.sends;

  // The steps this install gets, in order.
  const order: TourStep[] = useMemo(() => {
    const phone = matchMedia(PHONE).matches;
    const shownEl = (sel: string) => ((document.querySelector(sel) as HTMLElement | null)?.offsetWidth ?? 0) > 0;
    const o: TourStep[] = ["hello", "threads"];
    if (latest) o.push("steps");
    if (latest && shown) o.push("step");
    o.push("files", "map");
    if (!phone && getReadmap()) o.push("readmap");   // the Readmap on, as it is unless turned off (none on a phone)
    if (shownEl(".threadbar-keys")) o.push("keys");   // the key hints fit the thread bar (a wide enough window)
    o.push(asks ? "stats" : "end");
    return o;
  }, [!!latest, !!shown, asks]);
  const at = step ? order.indexOf(step) : -1;
  const go = (d: number) => {
    const i = Math.max(0, Math.min(order.length - 1, at + d));
    if (at + d >= order.length) return finish();
    tourStore.go(order[i]);
  };
  const finish = () => {
    window.dispatchEvent(new CustomEvent("rundown-sidebar", { detail: { tab: "threads" } }));
    tourStore.finish();
  };

  // ---- what each step does to the app ----
  const navRef = useRef(nav); navRef.current = nav;
  useEffect(() => {
    if (!step) return;
    // Opening or closing a thread mounts the map view again, its sidebar too: said again once the new one is there.
    const n = navRef.current, sidebar = (detail: { open?: boolean; tab?: "threads" | "files" }) => {
      const send = () => window.dispatchEvent(new CustomEvent("rundown-sidebar", { detail }));
      send(); timers.push(setTimeout(send, 150), setTimeout(send, 500));
    };
    const timers: ReturnType<typeof setTimeout>[] = [];
    const narrow = matchMedia("(max-width: 1100px)").matches;
    switch (step) {
      case "hello": n.closeStep(); if (n.replay) n.stopReplay(); if (n.lens !== "map") n.setLens("map"); break;
      case "threads": n.closeStep(); if (n.replay) n.stopReplay(); sidebar({ open: true, tab: "threads" }); break;
      case "steps": if (latest && n.replay?.sessionId !== latest.id) n.startReplay(latest.id, END); n.closeStep(); sidebar({ open: true, tab: "threads" }); break;
      case "step": if (latest && shown) n.openStep(latest.id, shown.id); break;
      case "files": n.closeStep(); sidebar({ open: true, tab: "files" }); break;
      case "map": n.closeStep(); if (n.replay) n.stopReplay(); sidebar({ tab: "threads", ...(narrow ? { open: false } : {}) }); break;
      default: break;
    }
    return () => timers.forEach(clearTimeout);
  }, [step]);

  // ---- the example agent, on the map step: reads one file, edits two, again and again ----
  const files = state.map?.files;
  useEffect(() => {
    if (step !== "map" || !files?.length) { if (tourStore.get().agent) tourStore.setAgent(null); return; }
    const walk = pickWalk(files);
    if (!walk) return;
    const [a, b, c] = walk;
    const plan: { file: string; action: string }[] = [{ file: a, action: "edit" }, { file: b, action: "read" }, { file: c, action: "edit" }, { file: b, action: "edit" }];
    let i = 0, trail: AgentPresence["trail"] = [];
    const tick = () => {
      if (i % (plan.length + 1) === plan.length) { trail = []; i++; return; }   // a pause, then from the top
      const m = plan[i % (plan.length + 1)], ts = new Date().toISOString();
      trail = [...trail, { ...m, ts }].slice(-12);
      tourStore.setAgent({ id: TOUR_AGENT, sessionId: TOUR_AGENT, name: "Example agent", isSubagent: false, file: m.file, action: m.action, ts, active: true, trail });
      i++;
    };
    tick();
    const t = setInterval(tick, WALK_MS);
    return () => { clearInterval(t); tourStore.setAgent(null); };
  }, [step, files]);

  // ---- keys: Esc skips, ← → go back and on ----
  const goRef = useRef(go); goRef.current = go;
  const finishRef = useRef(finish); finishRef.current = finish;
  useEffect(() => {
    if (!step) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); finishRef.current(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); e.stopImmediatePropagation(); goRef.current(1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); e.stopImmediatePropagation(); goRef.current(-1); }
    };
    addEventListener("keydown", onKey, true);
    return () => removeEventListener("keydown", onKey, true);
  }, [!!step]);

  if (!step) return null;
  const card = cardFor(step, { threads: state.sessions.length, title: latest?.title });
  const last = at === order.length - 1;
  return (
    <TourCard key={step} card={card} index={at} count={order.length}
      actions={step === "stats" ? (
        <>
          <a className="tour-link" href={PRIVACY_URL} target="_blank" rel="noopener">What's sent</a>
          <button className="tour-quiet" onClick={() => { usage.set(false); finish(); }}>Don't share</button>
          <button className="tour-primary" onClick={() => { usage.set(true); finish(); }}>Share stats</button>
        </>
      ) : (
        <>
          {!last && <button className="tour-skip" onClick={finish}>Skip the tour</button>}
          {at > 0 && !last && <button className="tour-quiet" onClick={() => go(-1)}>Back</button>}
          <button className="tour-primary" onClick={() => (last ? finish() : go(1))}>{step === "hello" ? "Show me" : last ? "Done" : "Next"}</button>
        </>
      )} />
  );
}

function cardFor(step: TourStep, { threads, title }: { threads: number; title?: string }): Card {
  switch (step) {
    case "hello": return { title: "Welcome to Rundown", body: "Rundown shows what your coding agents do in this project, live, on a map of your files. Here's a quick look around: about a minute." };
    case "threads": return { title: "Your threads", anchor: ".map-sidebar", body: threads
      ? "Each Claude Code or Codex session in this project is a thread, newest first. A blue dot means it's working right now."
      : "Each Claude Code or Codex session in this project will be a thread here, newest first, as soon as an agent works in it." };
    case "steps": return { title: "Every step it took", anchor: ".map-sidebar", body: `This is ${title ? `"${title}"` : "your newest thread"}: what the agent read, changed and ran, in order. Scroll back through it and the map follows.` };
    case "step": return { title: "One step, up close", anchor: ".map-panel.open", body: "Click a step to see exactly what happened: the change it made, or what a command printed. You can ask about it too." };
    case "files": return { title: "Your files", anchor: ".map-sidebar", body: "Files is your project as a folder tree. Pick a file to see what it does, what uses it, and which agents worked on it." };
    case "map": return { title: "The map", body: "The same files, as dots grouped in folders. An agent at work is a dot that moves to each file it changes, leaving a trail, with a dotted line to the files it reads. This one is an example." };
    case "readmap": return { title: "The Readmap", anchor: ".readmap", body: "Agents often read files far from where they work. The Readmap follows what they read, up close, so you don't have to look for it. M hides or shows it." };
    case "keys": return { title: "Shortcuts", anchor: ".threadbar-keys", body: "Space plays a thread back, T shows or hides the sidebar, M the Readmap. ? lists them all." };
    case "stats": return { title: "One last question", body: "Can Rundown send anonymous usage stats, once a day? Counts only (how much you used it), its version, your OS and country. Never code, paths, prompts or names. You can change this in Settings." };
    case "end": return { title: "You're all set", body: "That's the tour. You can take it again any time from Settings." };
  }
}

/** Three files of one folder for the example agent: the folder worked on most lately that holds at least three. */
function pickWalk(files: FileNode[]): [string, string, string] | null {
  const by = new Map<string, FileNode[]>();
  for (const f of files) { const d = f.path.slice(0, f.path.lastIndexOf("/")); (by.get(d) ?? by.set(d, []).get(d)!).push(f); }
  let best: FileNode[] | null = null, bestAt = "";
  for (const fs of by.values()) {
    if (fs.length < 3) continue;
    const at = fs.reduce((m, f) => (f.lastChangedAt && f.lastChangedAt > m ? f.lastChangedAt : m), "");
    if (!best || at > bestAt) { best = fs; bestAt = at; }
  }
  if (!best) return files.length >= 3 ? [files[0].path, files[1].path, files[2].path] : null;
  const top = [...best].sort((a, b) => b.lines - a.lines).slice(0, 3);
  return [top[0].path, top[1].path, top[2].path];
}

/** The card, beside what it points at (with a ring around that), or in the middle when it points at nothing. */
function TourCard({ card, index, count, actions }: { card: Card; index: number; count: number; actions: React.ReactNode }) {
  const el = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<DOMRect | null>(null);
  // Where the anchor is, again while things slide in (a sheet opening, the panel): a few times a second, and on resize.
  useEffect(() => {
    if (!card.anchor) { setBox(null); return; }
    const measure = () => {
      const a = document.querySelector(card.anchor!);
      const r = a?.getBoundingClientRect();
      setBox((was) => (r && r.width > 0 ? (was && Math.abs(was.x - r.x) + Math.abs(was.y - r.y) + Math.abs(was.width - r.width) + Math.abs(was.height - r.height) < 1 ? was : r) : null));
    };
    measure();
    const t = setInterval(measure, 250);
    addEventListener("resize", measure);
    return () => { clearInterval(t); removeEventListener("resize", measure); };
  }, [card.anchor]);
  // The card's own place: beside the anchor where there's room (right, left, below, above), else at the bottom middle.
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const c = el.current?.getBoundingClientRect();
    if (!c) return;
    const W = innerWidth, H = innerHeight, gap = 16, m = 12;
    if (matchMedia(PHONE).matches) { setPos({ left: m, top: 118 }); return; }
    if (!box) { setPos({ left: (W - c.width) / 2, top: Math.max(m, H - c.height - 96) }); return; }
    const clampY = (y: number) => Math.max(m + 64, Math.min(H - c.height - m, y));
    const clampX = (x: number) => Math.max(m, Math.min(W - c.width - m, x));
    if (box.right + gap + c.width <= W - m) setPos({ left: box.right + gap, top: clampY(box.top + 24) });
    else if (box.left - gap - c.width >= m) setPos({ left: box.left - gap - c.width, top: clampY(box.top + 24) });
    else if (box.bottom + gap + c.height <= H - m) setPos({ left: clampX(box.left), top: box.bottom + gap });
    else if (box.top - gap - c.height >= m) setPos({ left: clampX(box.left), top: box.top - gap - c.height });
    else setPos({ left: (W - c.width) / 2, top: H - c.height - m });
  }, [box, card]);
  // The keyboard: the main button has the focus.
  useEffect(() => { el.current?.querySelector<HTMLButtonElement>(".tour-primary")?.focus({ preventScroll: true }); }, [card]);
  return (
    <>
      {box && <Ring box={box} />}
      <div className="tour-card" ref={el} role="dialog" aria-modal="false" aria-labelledby="tour-title" aria-describedby="tour-body"
        style={pos ? { left: pos.left, top: pos.top } : { visibility: "hidden" }}>
        <h2 id="tour-title">{card.title}</h2>
        <p id="tour-body">{card.body}</p>
        <div className="tour-foot">
          <span className="tour-dots" role="img" aria-label={`Step ${index + 1} of ${count}`}>
            {Array.from({ length: count }, (_, i) => <i key={i} className={i === index ? "on" : i < index ? "done" : ""} />)}
          </span>
          <div className="tour-actions">{actions}</div>
        </div>
      </div>
    </>
  );
}

/** The ring around the anchor, kept inside the window (a panel at the right edge would take half of it off screen). */
function Ring({ box }: { box: DOMRect }) {
  const m = 3, l = Math.max(m, box.left - 6), t = Math.max(m, box.top - 6);
  const r = Math.min(innerWidth - m, box.right + 6), b = Math.min(innerHeight - m, box.bottom + 6);
  return <div className="tour-ring" aria-hidden="true" style={{ left: l, top: t, width: r - l, height: b - t }} />;
}
