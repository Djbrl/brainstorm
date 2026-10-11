// The open thread's places in the sidebar (Places view): the Track's rows (one line, a dot), one per
// stretch of work in a place, saying what the agent did there ('Searched "…"', 'Clicked "Send"', data.ts runWords), the
// place quiet at the right; and the same way back through the thread as the Track: the row the thread is at is the
// highlighted one (its newest while it follows live), scrolling the list moves the thread there (the moment at the
// list's middle; the map's marker goes with it), and the list follows the replay. A row selects its place on the map,
// takes the thread there and opens its newest step in the side panel. Between its trips out, a row for Your computer:
// the thread back in the code (its first row too, where it starts).
import { useMemo } from "react";
import { useNavState } from "../lib/nav";
import { usePlaceRows } from "./rows";
import { displayLabel } from "../follow/format";
import { injectedLabel } from "../lib/chapters";
import { useLiveSelector } from "../lib/live";
import { LinkedLabel } from "../lib/links";
import { HOME_NAME, placesStore, runWords, usePlaces, useSelectPlace, type PlaceRun } from "./data";
import { MomentRow, useCursorScroll } from "../map/replay/moments";
import "../map/replay/replay.css"; // the row styles (.rp-list, .rp-m) it shares with the replay


export function PlaceSteps() {
  const { data, selected } = usePlaces();
  const { replay, step: stepId } = useNavState();
  const selectPlace = useSelectPlace();
  const steps = useLiveSelector((st) => (replay ? st.steps[replay.sessionId] : undefined));
  const stepById = useMemo(() => new Map((steps ?? []).map((x) => [x.id, x])), [steps]);
  const { rows, at, go } = usePlaceRows();
  const runs = rows.flatMap((r) => (r.run ? [r.run] : []));

  // Scrolling: the row at the list's middle is where the thread goes. The thread moving (playing, the card, a link):
  // the list brings its row to the middle, unless you scrolled it just now.
  const scroll = useCursorScroll<HTMLDivElement>({
    at, count: rows.length, go, user: "any", deps: [],
    rowAtCenter: (el) => {
      const rowsEl = [...el.querySelectorAll<HTMLElement>("[data-run]")];
      if (!rowsEl.length) return -1;
      if (el.scrollTop <= 4) return 0;                                                          // at the top: the first
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 4) return rowsEl.length - 1;      // at the bottom: the last
      const r = el.getBoundingClientRect(), mid = r.top + r.height / 2;
      let best = -1, d = Infinity;
      for (const row of rowsEl) { const b = row.getBoundingClientRect(), dd = Math.abs(b.top + b.height / 2 - mid); if (dd < d) { d = dd; best = Number(row.dataset.run); } }
      return best;
    },
    cursorBox: (el) => {
      const row = el.querySelector<HTMLElement>(`[data-run="${at}"]`);
      return row ? { top: row.offsetTop, height: row.offsetHeight } : null;
    },
  });

  if (!data) return <p className="sidebar-empty">Reading the thread…</p>;
  if (!data.events.length) return <p className="sidebar-empty">This thread stayed in the code.</p>;
  // The map resolves a page of a one-page site to the site, so match either.
  const siteOf = new Map(data.pages.map((p) => [p.id, p.site]));
  const atPlace = (place: string) => !!selected && (selected === place || selected === siteOf.get(place));
  // Light the row holding the step in the panel; if none does (a whole site picked on the map), every row of that place.
  const holder = runs.find((r) => atPlace(r.place) && !!stepId && r.stepIds.has(stepId));
  const isSel = (r: (typeof runs)[number]) => (holder ? r === holder : atPlace(r.place));
  /** What a stretch in a place was: its most telling event's words; else its first step's, as the Track says it. */
  const said = (r: PlaceRun) => { const w = runWords(r); if (w) return w; const st = stepById.get(r.first.stepId); return st ? injectedLabel(st) ?? displayLabel(st) : ""; };
  return (
    <div className="rp-list pl-list" ref={scroll.ref} onScroll={scroll.onScroll}>
      {rows.map((row, i) => {
        const state = i === at ? "current" : i > at ? "todo" : "done";
        const r = row.run;
        if (!r) {
          return (
            <MomentRow key={`home-${row.start}`} data-run={i} className={`rp-m pl-m pl-home ${state}`} onClick={() => go(i)}
              title={`${HOME_NAME}: ${i === 0 ? "the thread starts in the code" : "back in the code"}${row.moments > 1 ? `, ${row.moments} moments` : ""}`}
              label={i === 0 ? "Starts in the code" : "Back in the code"} aside={<small>{HOME_NAME}</small>} />
          );
        }
        const e = r.last, picked = isSel(r), tone = r.failed > 0 ? "fl" : r.verbs.size > 0 ? "edit" : "";
        const label = said(r), where = e.site;
        return (
          <MomentRow key={r.key} data-run={i} className={`rp-m pl-m ${tone} ${picked ? "current" : state}`}
            onClick={() => { if (picked) { selectPlace(null); return; } selectPlace(r.place, e.stepId); go(i); }}
            onMouseEnter={() => placesStore.set({ highlight: r.place })} onMouseLeave={() => placesStore.set({ highlight: null })}
            title={`${label}\n${where}${r.count > 1 ? ` · ${r.count} steps` : ""}`}
            label={<LinkedLabel text={label} max={40} />} failed={r.failed > 0} aside={<small>{where}</small>} />
        );
      })}
    </div>
  );
}
