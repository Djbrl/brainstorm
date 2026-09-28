// Owned by the lead.
import { isReplay, useLive } from "./lib/live";
import { NavProvider, useNav, type View } from "./lib/nav";
import { FollowView } from "./follow/FollowView";
import { MapView } from "./map/MapView";
import { FailuresView } from "./failures/FailuresView";
import { Tour } from "./tour/Tour";
import { SetupView } from "./setup/SetupView";
import { useState } from "react";

function Shell() {
  const { state, reload } = useLive();
  const [setupOpen, setSetupOpen] = useState(false);
  const { view, setView } = useNav();
  const [tourSignal, setTourSignal] = useState(0);
  const tabs: { id: View; label: string }[] = [{ id: "follow", label: "Follow" }, { id: "map", label: "Map" }, { id: "failures", label: `Failures${state.failures.length ? ` ${state.failures.length}` : ""}` }];
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
          Post-deadline preview: a few features added a few hours after the hackathon cutoff. Agent moves and setup are played back from a real recording.{" "}
          <a href="https://brainstorm-demo-black.vercel.app">See the judged version</a>
        </div>
      )}
      {state.replay && <Tour openSignal={tourSignal} preview={state.preview} />}
      <main className="view">{view === "follow" ? <FollowView /> : view === "map" ? <MapView /> : <FailuresView />}</main>
    </div>
  );
}

export function App() {
  return <NavProvider><Shell /></NavProvider>;
}
