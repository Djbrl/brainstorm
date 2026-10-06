// Owner: cowork. Places: where the open thread went outside the code. The same screen as the Map (full-screen map,
// threads sidebar, no legend: the places read without one); the open thread's panel in the sidebar lists its places (PlaceSteps).
// Clicking a place opens its step in the side panel, the same step view as on the Map and the Track (and the same link: …/places/step/<id>).
import { useEffect, useMemo, useRef } from "react";
import type { CoworkArea } from "@contract";
import { useLive } from "../lib/live";
import { useNav } from "../lib/nav";
import { MapSidebar } from "../map/sidebar/MapSidebar";
import { MapStats } from "../map/MapStats";
import { LensSwitch } from "../map/LensSwitch";
import { AREAS, eventsAt, placeOfStep, placeTitle, placesStore, selectPlace, useCowork, usePlaces } from "./data";
import { StepDetail } from "../follow/StepDetail";
import { pairResults } from "../follow/format";
import { WorldMap } from "./WorldMap";
import "../map/map.css";
import "../follow/follow.css";
import "./cowork.css";

const ALL = new Set<CoworkArea>(AREAS);

export function PlacesView() {
  const { state } = useLive();
  const { replay, setLens, step: navStep, openStep, closeStep } = useNav();
  const session = state.sessions.find((s) => s.id === replay?.sessionId);
  const { data } = useCowork(replay?.sessionId ?? null, session?.status === "running", state.connected); // a recording is "connected" once loaded
  const { selected, stepId, highlight } = usePlaces();

  // The step in the panel is the app's open step, so its link, Back and Esc work as everywhere else. Two one-way
  // syncs: a pick in Places (a place, a row, ‹ ›) opens its step in the app; the app's step (a link, Back, Esc) shows
  // in Places without echoing back. They used to be two effects that each undid the other on a link to a step
  // (…/places/step/<id>), until React gave up ("Maximum update depth exceeded").
  const fromApp = useRef(false);
  const mirror = (p: Parameters<typeof placesStore.set>[0]) => { fromApp.current = true; try { placesStore.set(p); } finally { fromApp.current = false; } };
  const navRef = useRef({ replay, openStep, closeStep });
  navRef.current = { replay, openStep, closeStep };
  useEffect(() => {
    let last = placesStore.get().stepId;
    return placesStore.subscribe(() => {
      const id = placesStore.get().stepId;
      if (id === last) return;
      last = id;
      const { replay: r, openStep: open, closeStep: close } = navRef.current;
      if (fromApp.current || !r) return;
      if (id) open(r.sessionId, id); else close();
    });
  }, []);
  useEffect(() => { mirror({ data, selected: null, stepId: null, highlight: null }); }, [replay?.sessionId, !!data]);
  useEffect(() => { if (data) placesStore.set({ data }); }, [data]);
  useEffect(() => () => mirror({ data: null, selected: null, stepId: null, highlight: null }), []);
  // The app's step into Places, with its place picked if the one picked doesn't hold it (a link opens on its place).
  useEffect(() => {
    const p = placesStore.get();
    if (!navStep) { if (p.stepId) mirror({ stepId: null }); return; }
    const holds = !!p.data && !!p.selected && eventsAt(p.data, p.selected).some((e) => e.stepId === navStep);
    const place = p.data && !holds ? placeOfStep(p.data, navStep) : null;
    if (navStep !== p.stepId || place) mirror({ stepId: navStep, ...(place ? { selected: place } : {}) });
  }, [navStep, !!data]);

  // The step in the panel, its result, and the other steps in the same place (to step through them).
  const steps = replay ? state.steps[replay.sessionId] : undefined;
  const results = useMemo(() => pairResults(steps ?? []), [steps]);
  const step = stepId ? steps?.find((s) => s.id === stepId) : undefined;
  const here = data && selected ? [...new Set(eventsAt(data, selected).map((e) => e.stepId))] : [];
  const pos = stepId ? here.indexOf(stepId) : -1;
  const place = data && selected ? eventsAt(data, selected).find((e) => e.stepId === stepId) : undefined;

  return (
    <div className="map-wrap cw-wrap">
      {data && data.events.length > 0 && (
        <WorldMap key={replay?.sessionId} data={data} areas={ALL} selected={selected} highlight={highlight} leftInset={380} rightInset={step ? 440 : 0}
          onSelect={(id) => selectPlace(id)} />
      )}
      <MapSidebar agents={Object.values(state.agents)} accent="#2563eb" followId={null} onFollow={() => setLens("map")} onFocusFile={() => setLens("map")} map={state.map} />
      <MapStats />
      <LensSwitch />
      {!replay && <p className="cw-note">Pick a thread to see where it went outside the code.</p>}
      <div className={`map-panel pl-panel ${step ? "open" : ""}`} aria-hidden={!step}>
        {step && (
          <>
            {here.length > 1 && (
              <div className="pl-panel-nav">
                <span>{place ? placeTitle(place) : ""}</span>
                <span className="pl-panel-count">{pos + 1} of {here.length} here</span>
                <button onClick={() => pos > 0 && placesStore.set({ stepId: here[pos - 1] })} disabled={pos <= 0} aria-label="Previous step here">‹</button>
                <button onClick={() => pos < here.length - 1 && placesStore.set({ stepId: here[pos + 1] })} disabled={pos >= here.length - 1} aria-label="Next step here">›</button>
              </div>
            )}
            <StepDetail step={step} result={results.get(step.id)} onClose={() => selectPlace(null)} />
          </>
        )}
      </div>
    </div>
  );
}
