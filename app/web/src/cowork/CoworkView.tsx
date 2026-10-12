// Places: where the open thread went outside the code. The same screen as the Map (full-screen map,
// threads sidebar, no legend: the places read without one), in the same language (PlacesMap); the open thread's panel
// in the sidebar lists its places (PlaceSteps). No Readmap here: a visit is the thread's movement itself, which the
// camera already follows.
// Clicking a place opens its step in the side panel, the Map's StepPanel with the place in its header (and the same link: …/places/step/<id>).
import { useCallback, useEffect, useRef } from "react";
import { useLiveSelector } from "../lib/live";
import { useNavActions, useNavState, useReplayCursor } from "../lib/nav";
import { initial } from "../map/agents";
import { MapSidebar } from "../map/sidebar/MapSidebar";
import { LensSwitch } from "../map/LensSwitch";
import { usePlaceRows, usePlaceTimeline } from "./rows";
import { Dock } from "../map/replay/ReplayBar";
import { togglePlay } from "../map/replay/layer";
import { useShortcut } from "../switch/shortcuts";
import { HOME, eventsAt, placeOfStep, placeTitle, placesStore, useCowork, usePlaces, useSelectPlace } from "./data";
import { StepPanel } from "../map/StepPanel";
import { PlacesMap } from "./PlacesMap";
import { NARROW, useMedia } from "../lib/breakpoints";
import "../map/map.css";
import "../follow/follow.css";
import "./cowork.css";

const PLACE_MS = 1100;   // a place's time on the player, at 1×

export function PlacesView() {
  const { thread, step: navStep } = useNavState();
  const { setLens, openStep, setReplayPlaying, setThreadMode } = useNavActions();
  const session = useLiveSelector((s) => s.sessions.find((x) => x.id === thread?.sessionId));
  const running = session?.status === "running";
  const connected = useLiveSelector((s) => s.connected);
  const agents = useLiveSelector((s) => s.agents), map = useLiveSelector((s) => s.map);
  const { data, error } = useCowork(thread?.sessionId ?? null, running, connected); // a recording is "connected" once loaded
  const { selected, highlight, row: pickedRow } = usePlaces();
  const selectPlace = useSelectPlace();

  // The step in the panel is the app's open step, so its link, Back and Esc work as everywhere else: a pick in Places
  // (a place, a row, ‹ ›) opens its step in the app (useSelectPlace), and the app's step picks its place here.
  const stepId = navStep;
  const navRef = useRef({ setReplayPlaying, setThreadMode });
  navRef.current = { setReplayPlaying, setThreadMode };
  useEffect(() => { placesStore.set({ data, selected: null, highlight: null }); }, [thread?.sessionId, !!data]);
  useEffect(() => { if (data) placesStore.set({ data }); }, [data]);
  useEffect(() => () => placesStore.set({ data: null, selected: null, highlight: null }), []);
  // The app's step, with its place picked if the one picked doesn't hold it (a link opens on its place).
  useEffect(() => {
    const p = placesStore.get();
    if (!navStep || !p.data) return;
    const holds = !!p.selected && eventsAt(p.data, p.selected).some((e) => e.stepId === navStep);
    const place = holds ? null : placeOfStep(p.data, navStep);
    if (place) placesStore.set({ selected: place });
  }, [navStep, !!data]);

  // The step in the panel (StepPanel shows it), and the other steps in the same place (to step through them).
  const steps = useLiveSelector((s) => (thread ? s.steps[thread.sessionId] : undefined));
  const step = stepId ? steps?.find((s) => s.id === stepId) : undefined;
  const here = data && selected ? [...new Set(eventsAt(data, selected).map((e) => e.stepId))] : [];
  const pos = stepId ? here.indexOf(stepId) : -1;
  const place = data && selected ? eventsAt(data, selected).find((e) => e.stepId === stepId) : undefined;

  // Where the thread is, for the places map's marker: the replay's cursor, or its newest place while it follows live.
  // The places go by the thread's steps (always in order), the app's cursor by its moments: rows.ts maps one to the other.
  const timeline = usePlaceTimeline();
  const { full } = timeline;
  const beatOf = useCallback((id: string) => full?.stepBeat.get(id), [full]);
  const small = useMedia(NARROW);

  // ---- the player, place by place: Space plays from the place you're on, one place every ~1.1 s (faster at 2× 4×);
  // in the player ← → go one place back or forward, Home and End the first and the last ----
  const { rows, at, go } = usePlaceRows();
  const playing = useReplayCursor((c) => c.playing);
  const now = useRef({ rows, at, go, playing, thread }); now.current = { rows, at, go, playing, thread };
  useEffect(() => {
    if (!playing || !thread) return;
    if (at >= rows.length - 1) { navRef.current.setReplayPlaying(false); return; }
    const t = setTimeout(() => now.current.go(now.current.at + 1, true), PLACE_MS / (thread.speed ?? 1));
    return () => clearTimeout(t);
  }, [playing, at, rows.length, thread?.speed]);
  useShortcut("play", (e) => {
    const { rows: rs, at: i, go: to, playing: p, thread: r } = now.current;
    if (!r || !rs.length || (e?.target as HTMLElement | null)?.tagName === "BUTTON") return false;
    if (r.mode !== "play") navRef.current.setThreadMode("play");
    togglePlay(p, navRef.current.setReplayPlaying, i >= rs.length - 1, () => to(0));   // at the end: from the start
  });
  useShortcut("player.step", (e) => {
    const { rows: rs, at: i, go: to, thread: r } = now.current;
    if (!e || !r || !rs.length || r.mode !== "play") return false;
    to(e.key === "ArrowLeft" ? Math.max(0, i - 1) : Math.min(rs.length - 1, i + 1));
  });
  useShortcut("player.ends", (e) => {
    const { rows: rs, go: to, thread: r } = now.current;
    if (!e || !r || !rs.length || r.mode !== "play") return false;
    to(e.key === "Home" ? 0 : rs.length - 1);
  });

  return (
    <div className="map-wrap cw-wrap">
      {data && data.events.length > 0 && (
        <PlacesMap key={thread?.sessionId} data={data} selected={selected} highlight={highlight} rightInset={step ? 440 : 0}
          onSelect={(id) => (id === HOME ? setLens("map") : selectPlace(id))} small={small} beatOf={beatOf} beats={timeline.steps}
          cursor={pickedRow && pickedRow.beat === timeline.index ? pickedRow.step : timeline.pos}
          until={pickedRow && pickedRow.beat === timeline.index ? pickedRow.event : undefined} live={!!thread?.live}
          letter={initial({ name: session?.title ?? "", isSubagent: false })} />
      )}
      <MapSidebar agents={Object.values(agents)} accent="#2563eb" followId={null} onFollow={() => setLens("map")} onFocusFile={() => setLens("map")} map={map} />
      <LensSwitch />
      {data && rows.length > 0 && <Dock steps={{ at, count: rows.length, go, noun: "place" }} />}
      {!thread && <p className="cw-note">Pick a thread to see where it went outside the code.</p>}
      {thread && error && <p className="cw-note">The places couldn't load. Check that Rundown is still running.</p>}
      <StepPanel follow={false} back="Back to the places" onClose={() => selectPlace(null)} header={step && here.length > 1 && (
        <div className="pl-panel-nav">
          <span>{place ? placeTitle(place) : ""}</span>
          <span className="pl-panel-count">{pos + 1} of {here.length} here</span>
          <button onClick={() => pos > 0 && thread && openStep(thread.sessionId, here[pos - 1])} disabled={pos <= 0} aria-label="Previous step here">‹</button>
          <button onClick={() => pos < here.length - 1 && thread && openStep(thread.sessionId, here[pos + 1])} disabled={pos >= here.length - 1} aria-label="Next step here">›</button>
        </div>
      )} />
    </div>
  );
}
