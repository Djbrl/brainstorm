// Owner: cowork. The open thread's places in the sidebar (Places view): the same rows as the step list, one per
// stretch of work in a place. A row selects its place on the map and opens its newest step in the side panel.
import type { ReactNode } from "react";
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

export function PlaceSteps() {
  const { data, selected, stepId } = usePlaces();
  if (!data) return <p className="sidebar-empty">Reading the thread…</p>;
  if (!data.events.length) return <p className="sidebar-empty">This thread stayed in the code.</p>;
  const runs = placeRuns(data.events);
  // The map resolves a page of a one-page site to the site, so match either.
  const siteOf = new Map(data.pages.map((p) => [p.id, p.site]));
  const atPlace = (place: string) => !!selected && (selected === place || selected === siteOf.get(place));
  // Light the row holding the step in the panel; if none does (a whole site picked on the map), every row of that place.
  const holder = runs.find((r) => atPlace(r.place) && !!stepId && r.stepIds.has(stepId));
  const isSel = (r: (typeof runs)[number]) => (holder ? r === holder : atPlace(r.place));
  return (
    <div className="rp-list pl-list">
      {runs.map((r) => {
        const e = r.last, cur = isSel(r), changed = r.verbs.size > 0;
        const title = placeTitle(e) === e.site ? e.site : `${e.site} · ${placeTitle(e)}`;
        return (
          <div key={r.key} className={`rp-row ${cur ? "current" : ""} ${changed ? "a-edit" : ""}`}>
            <button className="rp-row-main" onClick={() => (cur ? selectPlace(null) : selectPlace(r.place, e.stepId))}
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
