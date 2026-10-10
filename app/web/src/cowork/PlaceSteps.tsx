// Owner: cowork. The open thread's places in the sidebar (Places view): the same rows as the step list, one per
// stretch of work in a place, and the same way back through the thread as the Track: the row the thread is at is the
// highlighted one (its newest while it follows live), scrolling the list moves the thread there (the moment at the
// list's middle; the map's marker goes with it), and the list follows the replay. A row selects its place on the map,
// takes the thread there and opens its newest step in the side panel.
import { useEffect, useRef, type ReactNode } from "react";
import { useNavActions, useNavState, useReplayCursor } from "../lib/nav";
import { useThread } from "../lib/thread";
import type { CoworkArea } from "@contract";
import { timeIn } from "../follow/format";
import { VERB_NAME, placeRuns, placeTitle, placesStore, selectPlace, usePlaces } from "./data";
import "../map/replay/replay.css"; // the row styles (.rp-list, .rp-row) it shares with the replay

const ICON: Record<CoworkArea, ReactNode> = {
  web: <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="6" /><path d="M2 8h12M8 2c1.7 1.7 2.5 3.7 2.5 6S9.7 12.3 8 14M8 2C6.3 3.7 5.5 5.7 5.5 8s.8 4.3 2.5 6" /></svg>,
  local: <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="3" width="12" height="8.5" rx="1.5" /><path d="M5.5 14h5M8 11.5V14" /></svg>,
  services: <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4.5 12.5h7a3 3 0 0 0 .3-6A4 4 0 0 0 4.2 7a2.8 2.8 0 0 0 .3 5.5Z" /></svg>,
  apps: <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="2.5" width="12" height="11" rx="1.5" /><path d="M2 5.5h12" /></svg>,
};

const USER_MS = 400;   // the list stops following the thread this long after you scroll it (as the Track's does)

export function PlaceSteps() {
  const { data, selected, stepId } = usePlaces();
  const { replay } = useNavState();
  const thread = useThread(replay?.sessionId ?? null, replay?.detail ?? "light");
  const index = useReplayCursor((c) => c.index);
  const { setReplayIndex, setReplayPlaying, setThreadMode } = useNavActions();
  const runs = data ? placeRuns(data.events) : [];
  // Each row's moment in the thread (its newest step's), and the row the thread is at.
  const beatOf = (r: (typeof runs)[number]) => thread?.stepBeat.get(r.last.stepId) ?? thread?.stepBeat.get(r.first.stepId);
  let at = -1;
  if (replay?.live) at = runs.length - 1;
  else for (let i = 0; i < runs.length; i++) { const b = beatOf(runs[i]); if (b !== undefined && b <= index) at = i; }
  const go = (i: number) => {
    const b = runs[i] ? beatOf(runs[i]) : undefined;
    if (b === undefined) return;
    if (replay?.mode === "footprint") setThreadMode("steps");
    setReplayPlaying(false);
    setReplayIndex(b);
  };
  const goRef = useRef(go); goRef.current = go;
  const atRef = useRef(at); atRef.current = at;

  // Scrolling: the row at the list's middle is where the thread goes. The thread moving (playing, the card, a link):
  // the list brings its row to the middle, unless you scrolled it just now.
  const list = useRef<HTMLDivElement>(null), userAt = useRef(0), raf = useRef(0);
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const mark = () => { userAt.current = performance.now(); };
    const onScroll = () => {
      if (performance.now() - userAt.current > USER_MS) return;   // a scroll the list made itself
      cancelAnimationFrame(raf.current);
      raf.current = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect(), mid = r.top + r.height / 2;
        let best = -1, d = Infinity;
        el.querySelectorAll<HTMLElement>("[data-run]").forEach((row) => {
          const b = row.getBoundingClientRect(), dd = Math.abs(b.top + b.height / 2 - mid);
          if (dd < d) { d = dd; best = Number(row.dataset.run); }
        });
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 4) best = Number(el.querySelector<HTMLElement>("[data-run]:last-of-type")?.dataset.run ?? best);
        if (best >= 0 && best !== atRef.current) goRef.current(best);
      });
    };
    el.addEventListener("wheel", mark, { passive: true });
    el.addEventListener("touchmove", mark, { passive: true });
    el.addEventListener("pointerdown", mark);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => { el.removeEventListener("wheel", mark); el.removeEventListener("touchmove", mark); el.removeEventListener("pointerdown", mark); el.removeEventListener("scroll", onScroll); };
  }, [!!data]);
  useEffect(() => {
    const el = list.current, row = el?.querySelector<HTMLElement>(`[data-run="${at}"]`);
    if (!el || !row || performance.now() - userAt.current < USER_MS) return;
    el.scrollTo({ top: row.offsetTop - el.clientHeight / 2 + row.offsetHeight / 2, behavior: "smooth" });
  }, [at]);

  if (!data) return <p className="sidebar-empty">Reading the thread…</p>;
  if (!data.events.length) return <p className="sidebar-empty">This thread stayed in the code.</p>;
  // The map resolves a page of a one-page site to the site, so match either.
  const siteOf = new Map(data.pages.map((p) => [p.id, p.site]));
  const atPlace = (place: string) => !!selected && (selected === place || selected === siteOf.get(place));
  // Light the row holding the step in the panel; if none does (a whole site picked on the map), every row of that place.
  const holder = runs.find((r) => atPlace(r.place) && !!stepId && r.stepIds.has(stepId));
  const isSel = (r: (typeof runs)[number]) => (holder ? r === holder : atPlace(r.place));
  return (
    <div className="rp-list pl-list" ref={list}>
      {runs.map((r, i) => {
        const e = r.last, cur = isSel(r) || i === at, changed = r.verbs.size > 0;
        const title = placeTitle(e) === e.site ? e.site : `${e.site} · ${placeTitle(e)}`;
        return (
          <div key={r.key} data-run={i} className={`rp-row ${cur ? "current" : ""} ${i > at ? "todo" : ""} ${changed ? "a-edit" : ""}`}>
            <button className="rp-row-main" onClick={() => { if (isSel(r)) { selectPlace(null); return; } selectPlace(r.place, e.stepId); go(i); }}
              onMouseEnter={() => placesStore.set({ highlight: r.place })} onMouseLeave={() => placesStore.set({ highlight: null })}>
              <span className="rp-glyph" aria-hidden="true">{ICON[e.area]}</span>
              <span className="rp-row-text">
                <span className="rp-row-label">{title}</span>
                <span className="rp-row-meta">
                  <time>{timeIn(r.first.ts)}</time>
                  {changed && <span className="pl-verbs">{[...r.verbs].map(([v, n]) => `${VERB_NAME[v].toLowerCase()}${n > 1 ? ` ×${n}` : ""}`).join(", ")}</span>}
                  {!changed && r.count > 1 && <span>{r.count} steps</span>}
                  {r.failed > 0 && <span className="rp-fail-dot" aria-label={`${r.failed} failed`} />}
                </span>
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
