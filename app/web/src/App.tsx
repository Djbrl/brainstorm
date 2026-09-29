// Owned by the lead.
import { isReplay, useLive } from "./lib/live";
import { NavProvider, useNav, type View } from "./lib/nav";
import { FollowView } from "./follow/FollowView";
import { MapView } from "./map/MapView";
import { FailuresView } from "./failures/FailuresView";
import { CoworkView } from "./cowork/CoworkView";
import { TrackView } from "./tasks/TrackView";
import { useThread } from "./lib/thread";
import { Tour } from "./tour/Tour";
import { SetupView } from "./setup/SetupView";
import { useEffect, useRef, useState } from "react";

function Shell() {
  const { state, reload } = useLive();
  const [setupOpen, setSetupOpen] = useState(false);
  const { view, setView, lens } = useNav();
  const [tourSignal, setTourSignal] = useState(0);
  // Local app: Follow, Map (with its Map | Track views) and Places. Failures was a hackathon view: errors now show on the map,
  // in Follow and in the Track. The judged hackathon demo keeps it, its tour points at it.
  const tabs: { id: View; label: string }[] = state.replay && !state.preview
    ? [{ id: "follow", label: "Follow" }, { id: "map", label: "Map" }, { id: "failures", label: `Failures${state.failures.length ? ` ${state.failures.length}` : ""}` }]
    : state.replay ? [{ id: "follow", label: "Follow" }, { id: "map", label: "Map" }] // the post-deadline demo
    : [{ id: "follow", label: "Follow" }, { id: "map", label: "Map" }, { id: "cowork", label: "Places" }];
  // Local app: pick a workspace first (and whenever "Change" is clicked). The hosted replay never shows setup.
  // In the post-deadline preview, the setup screen plays back a recorded run (see lib/preview.ts).
  if ((setupOpen && (!state.replay || state.preview)) || (!state.replay && state.setup && !state.setup.root)) {
    return <SetupView onDone={() => { setSetupOpen(false); reload(); }} onCancel={state.setup?.root || state.preview ? () => setSetupOpen(false) : undefined} />;
  }

  return (
    <div className={`shell ${state.preview ? "has-banner" : ""}`}>
      <header className="topbar">
        {isReplay()
          ? <a className="wordmark" href="https://brainstorm-landing.vercel.app" aria-label="Brainstorm home">Brainstorm</a>
          : <div className="wordmark">Brainstorm</div>}
        <nav className="tabs" role="tablist">
          {tabs.map((t) => (
            <button key={t.id} role="tab" data-tour={`tab-${t.id}`} aria-selected={view === t.id} onClick={() => setView(t.id)}>{t.label}</button>
          ))}
        </nav>
        <div className="status">
          {state.preview && (
            <button className="ws-chip" title="Play back a recorded setup run" onClick={() => setSetupOpen(true)}>brainstorm <span>Setup preview</span></button>
          )}
          {!state.replay && state.setup?.root && (
            <button className="ws-chip" title={state.setup.root} onClick={() => setSetupOpen(true)}>{state.setup.name} <span>Change</span></button>
          )}
          {state.replay && !state.preview && (
            <a className="next-cta" href="https://brainstorm-next.vercel.app" title="Post-deadline preview: setup, live agents on the map, thread replay">Try Brainstorm Next</a>
          )}
          <span className={`dot ${state.connected ? "live" : ""}`} />
          {state.replay ? "Recorded demo" : state.connected ? "Live" : "Connecting…"}
          {state.replay && <button className="tour-help" aria-label="Show the tour" title="Show the tour" onClick={() => setTourSignal((n) => n + 1)}>?</button>}
        </div>
      </header>
      {state.preview && (
        <div className="preview-banner">
          A recording of Claude Code agents building Brainstorm, played back. To see your own agents live,{" "}
          <a href="https://github.com/Djbrl/brainstorm#install-claude-code-plugin-preview" target="_blank" rel="noopener">install the plugin</a>.
        </div>
      )}
      {state.replay && <Tour openSignal={tourSignal} preview={state.preview} />}
      {!state.replay && <LiveReplay />}
      <main className="view">{view === "follow" ? <FollowView /> : view === "map" ? (lens === "track" && !state.replay ? <TrackView /> : <MapView />) : view === "cowork" && !state.replay ? <CoworkView /> : state.replay ? <FailuresView /> : <FollowView />}</main>
    </div>
  );
}

/**
 * A running thread plays live by default: when the Map tab opens with no thread selected, the newest running thread
 * is picked and followed (until the user closes a replay). A live replay stays on the thread's newest beat.
 */
function LiveReplay() {
  const { state } = useLive();
  const { replay, view, startReplay, followLive, setReplayLive } = useNav();
  const thread = useThread(replay?.live ? replay.sessionId : null, replay?.detail ?? "light");
  const beats = thread?.beats.length ?? 0;
  useEffect(() => { if (replay?.live && beats) followLive(beats - 1); }, [replay?.live, beats, followLive]);
  const running = state.sessions.find((s) => s.id === replay?.sessionId)?.status === "running";
  const all = useThread(replay && !replay.live && running ? replay.sessionId : null, replay?.detail ?? "light");
  useEffect(() => {
    if (replay && !replay.live && running && all && replay.index >= all.beats.length - 1 && !replay.playing) setReplayLive(true);
  }, [replay, running, all, setReplayLive]);

  const closed = useRef(false), had = useRef(false);
  useEffect(() => { if (had.current && !replay) closed.current = true; had.current = !!replay; }, [replay]);
  useEffect(() => {
    if (replay || closed.current || view !== "map") return;
    const running = state.sessions.filter((s) => s.status === "running").sort((a, b) => b.lastEventAt.localeCompare(a.lastEventAt))[0];
    if (running) startReplay(running.id, 0, { live: true });
  }, [state.sessions, replay, view, startReplay]);
  return null;
}

export function App() {
  return <NavProvider><Shell /></NavProvider>;
}
