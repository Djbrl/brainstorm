// Owner: cowork. Places: where the open thread went outside the code. The same screen as the Map (full-screen map,
// threads sidebar, legend at the bottom); the open thread's panel in the sidebar lists its places (PlaceSteps).
import { useEffect } from "react";
import type { CoworkArea } from "@contract";
import { useLive } from "../lib/live";
import { useNav } from "../lib/nav";
import { MapSidebar } from "../map/sidebar/MapSidebar";
import { MapStats } from "../map/MapStats";
import { LensSwitch } from "../map/LensSwitch";
import { AREAS, AREA_NAME, placesStore, useCowork, usePlaces } from "./data";
import { AREA_COLOR, WorldMap } from "./WorldMap";
import "../map/map.css";
import "./cowork.css";

const ALL = new Set<CoworkArea>(AREAS);

export function PlacesView() {
  const { state } = useLive();
  const { replay, setLens } = useNav();
  const session = state.sessions.find((s) => s.id === replay?.sessionId);
  const { data } = useCowork(replay?.sessionId ?? null, session?.status === "running", state.connected); // a recording is "connected" once loaded
  const { selected, highlight } = usePlaces();
  useEffect(() => { placesStore.set({ data, selected: null, highlight: null }); }, [data]);
  useEffect(() => () => placesStore.set({ data: null, selected: null, highlight: null }), []);

  const used = data ? AREAS.filter((a) => data.areas[a] > 0) : [];
  return (
    <div className="map-wrap cw-wrap">
      {data && data.events.length > 0 && (
        <WorldMap key={replay?.sessionId} data={data} areas={ALL} selected={selected} highlight={highlight} leftInset={380}
          onSelect={(id) => placesStore.set({ selected: id })} />
      )}
      <MapSidebar agents={Object.values(state.agents)} accent="#5b5bd6" followId={null} onFollow={() => setLens("map")} onFocusFile={() => setLens("map")} map={state.map} />
      <MapStats />
      <LensSwitch />
      {!replay && <p className="cw-note">Pick a thread to see where it went outside the code.</p>}
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
