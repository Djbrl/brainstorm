// Owner: cowork. Places: where the open thread went outside the code. The same screen as the Map (full-screen map,
// threads sidebar, legend at the bottom); the open thread's panel in the sidebar lists its places (PlaceSteps).
// Clicking a place opens its step in the side panel, the same step view as in Follow.
import { useEffect, useMemo } from "react";
import type { CoworkArea } from "@contract";
import { useLive } from "../lib/live";
import { useNav } from "../lib/nav";
import { MapSidebar } from "../map/sidebar/MapSidebar";
import { MapStats } from "../map/MapStats";
import { LensSwitch } from "../map/LensSwitch";
import { AREAS, AREA_NAME, eventsAt, placeTitle, placesStore, selectPlace, useCowork, usePlaces } from "./data";
import { StepDetail } from "../follow/StepDetail";
import { pairResults } from "../follow/format";
import { AREA_COLOR, WorldMap } from "./WorldMap";
import "../map/map.css";
import "../follow/follow.css";
import "./cowork.css";

const ALL = new Set<CoworkArea>(AREAS);

export function PlacesView() {
  const { state } = useLive();
  const { replay, setLens } = useNav();
  const session = state.sessions.find((s) => s.id === replay?.sessionId);
  const { data } = useCowork(replay?.sessionId ?? null, session?.status === "running", state.connected); // a recording is "connected" once loaded
  const { selected, stepId, highlight } = usePlaces();
  useEffect(() => { placesStore.set({ data, selected: null, stepId: null, highlight: null }); }, [replay?.sessionId, !!data]);
  useEffect(() => { if (data) placesStore.set({ data }); }, [data]);
  useEffect(() => () => placesStore.set({ data: null, selected: null, stepId: null, highlight: null }), []);

  // The step in the panel, its result, and the other steps in the same place (to step through them).
  const steps = replay ? state.steps[replay.sessionId] : undefined;
  const results = useMemo(() => pairResults(steps ?? []), [steps]);
  const step = stepId ? steps?.find((s) => s.id === stepId) : undefined;
  const here = data && selected ? [...new Set(eventsAt(data, selected).map((e) => e.stepId))] : [];
  const pos = stepId ? here.indexOf(stepId) : -1;
  const place = data && selected ? eventsAt(data, selected).find((e) => e.stepId === stepId) : undefined;

  const used = data ? AREAS.filter((a) => data.areas[a] > 0) : [];
  return (
    <div className="map-wrap cw-wrap">
      {data && data.events.length > 0 && (
        <WorldMap key={replay?.sessionId} data={data} areas={ALL} selected={selected} highlight={highlight} leftInset={380} rightInset={step ? 440 : 0}
          onSelect={(id) => selectPlace(id)} />
      )}
      <MapSidebar agents={Object.values(state.agents)} accent="#5b5bd6" followId={null} onFollow={() => setLens("map")} onFocusFile={() => setLens("map")} map={state.map} />
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
      {used.length > 0 && (
        <div className="map-legend" aria-label="Legend">
          {used.map((a) => <span key={a}><i style={{ background: AREA_COLOR[a] }} />{AREA_NAME[a]}</span>)}
          <span><i className="ring" style={{ borderColor: "var(--hot)" }} />Changed something</span>
          <span><i style={{ background: "var(--risk)" }} />Failed</span>
        </div>
      )}
    </div>
  );
}
