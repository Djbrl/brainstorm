// Owner: cowork. Places: where the open thread went outside the code. The same screen as the Map (full-screen map,
// threads sidebar, no legend: the places read without one), in the same language (PlacesMap); the open thread's panel
// in the sidebar lists its places (PlaceSteps). No Readmap here: a visit is the thread's movement itself, which the
// camera already follows.
// Clicking a place opens its step in the side panel, the same step view as on the Map and the Track (and the same link: …/places/step/<id>).
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useLive } from "../lib/live";
import { useNav, useReplayCursor } from "../lib/nav";
import { initial } from "../map/agents";
import { MapSidebar } from "../map/sidebar/MapSidebar";
import { LensSwitch } from "../map/LensSwitch";
import { usePlaceRows, usePlaceTimeline } from "./rows";
import { Dock } from "../map/replay/ReplayBar";
import { togglePlay } from "../map/replay/layer";
import { isTyping } from "../switch/shortcuts";
import { HOME, eventsAt, placeOfStep, placeTitle, placesStore, selectPlace, useCowork, usePlaces } from "./data";
import { StepDetail } from "../follow/StepDetail";
import { pairResults } from "../follow/format";
import { PlacesMap } from "./PlacesMap";
import "../map/map.css";
import "../follow/follow.css";
import "./cowork.css";

const NARROW = "(max-width: 1100px)";
const PLACE_MS = 1100;   // a place's time on the player, at 1×
const useNarrow = () => useSyncExternalStore(
  (on) => { const m = matchMedia(NARROW); m.addEventListener("change", on); return () => m.removeEventListener("change", on); },
  () => matchMedia(NARROW).matches,
);

export function PlacesView() {
  const { state } = useLive();
  const { replay, setLens, step: navStep, openStep, closeStep } = useNav();
  const session = state.sessions.find((s) => s.id === replay?.sessionId);
  const { data, error } = useCowork(replay?.sessionId ?? null, session?.status === "running", state.connected); // a recording is "connected" once loaded
  const { selected, stepId, highlight, row: pickedRow } = usePlaces();

  // The step in the panel is the app's open step, so its link, Back and Esc work as everywhere else. Two one-way
  // syncs: a pick in Places (a place, a row, ‹ ›) opens its step in the app; the app's step (a link, Back, Esc) shows
  // in Places without echoing back. They used to be two effects that each undid the other on a link to a step
  // (…/places/step/<id>), until React gave up ("Maximum update depth exceeded").
  const fromApp = useRef(false);
  const mirror = (p: Parameters<typeof placesStore.set>[0]) => { fromApp.current = true; try { placesStore.set(p); } finally { fromApp.current = false; } };
  const { setReplayPlaying, setThreadMode } = useNav();
  const navRef = useRef({ replay, openStep, closeStep, setReplayPlaying, setThreadMode });
  navRef.current = { replay, openStep, closeStep, setReplayPlaying, setThreadMode };
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

  // Where the thread is, for the places map's marker: the replay's cursor, or its newest place while it follows live.
  // The places go by the thread's steps (always in order), the app's cursor by its moments: rows.ts maps one to the other.
  const timeline = usePlaceTimeline();
  const { full } = timeline;
  const beatOf = useCallback((id: string) => full?.stepBeat.get(id), [full]);
  const small = useNarrow();

  // ---- the player, place by place: Space plays from the place you're on, one place every ~1.1 s (faster at 2× 4×);
  // in the player ← → go one place back or forward, Home and End the first and the last ----
  const { rows, at, go } = usePlaceRows();
  const playing = useReplayCursor((c) => c.playing);
  const now = useRef({ rows, at, go, playing, replay }); now.current = { rows, at, go, playing, replay };
  useEffect(() => {
    if (!playing || !replay) return;
    if (at >= rows.length - 1) { navRef.current.setReplayPlaying(false); return; }
    const t = setTimeout(() => now.current.go(now.current.at + 1, true), PLACE_MS / (replay.speed ?? 1));
    return () => clearTimeout(t);
  }, [playing, at, rows.length, replay?.speed]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      const { rows: rs, at: i, go: to, playing: p, replay: r } = now.current;
      if (!r || !rs.length) return;
      switch (e.key) {
        case " ": {
          if ((e.target as HTMLElement | null)?.tagName === "BUTTON") return;
          if (r.mode !== "play") navRef.current.setThreadMode("play");
          togglePlay(p, navRef.current.setReplayPlaying, i >= rs.length - 1, () => to(0));   // at the end: from the start
          break;
        }
        case "ArrowLeft": if (r.mode !== "play") return; to(Math.max(0, i - 1)); break;
        case "ArrowRight": if (r.mode !== "play") return; to(Math.min(rs.length - 1, i + 1)); break;
        case "Home": if (r.mode !== "play") return; to(0); break;
        case "End": if (r.mode !== "play") return; to(rs.length - 1); break;
        default: return;
      }
      e.preventDefault();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="map-wrap cw-wrap">
      {data && data.events.length > 0 && (
        <PlacesMap key={replay?.sessionId} data={data} selected={selected} highlight={highlight} rightInset={step ? 440 : 0}
          onSelect={(id) => (id === HOME ? setLens("map") : selectPlace(id))} small={small} beatOf={beatOf} beats={timeline.steps}
          cursor={pickedRow && pickedRow.beat === timeline.index ? pickedRow.step : timeline.pos}
          until={pickedRow && pickedRow.beat === timeline.index ? pickedRow.event : undefined} live={!!replay?.live}
          letter={initial({ name: session?.title ?? "", isSubagent: false })} />
      )}
      <MapSidebar agents={Object.values(state.agents)} accent="#2563eb" followId={null} onFollow={() => setLens("map")} onFocusFile={() => setLens("map")} map={state.map} />
      <LensSwitch />
      {data && rows.length > 0 && <Dock steps={{ at, count: rows.length, go, noun: "place" }} />}
      {!replay && <p className="cw-note">Pick a thread to see where it went outside the code.</p>}
      {replay && error && <p className="cw-note">The places couldn't load. Check that Rundown is still running.</p>}
      <div className={`map-panel pl-panel ${step ? "open" : ""}`} aria-hidden={!step}>
        {step && (
          <>
            <button className="pl-panel-back" onClick={() => selectPlace(null)}><i aria-hidden="true">‹</i>Back to the places</button>
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
