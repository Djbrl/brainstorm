// Owned by the lead.
import { useLive } from "./lib/live";
import { NavProvider, useNav, type View } from "./lib/nav";
import { FollowView } from "./follow/FollowView";
import { MapView } from "./map/MapView";
import { FailuresView } from "./failures/FailuresView";
import { Tour } from "./tour/Tour";
import { useState } from "react";

function Shell() {
  const { state } = useLive();
  const { view, setView } = useNav();
  const [tourSignal, setTourSignal] = useState(0);
  const tabs: { id: View; label: string }[] = [{ id: "follow", label: "Follow" }, { id: "map", label: "Map" }, { id: "failures", label: `Failures${state.failures.length ? ` ${state.failures.length}` : ""}` }];
  return (
    <div className="shell">
      <header className="topbar">
        <div className="wordmark">Brainstorm</div>
        <nav className="tabs" role="tablist">
          {tabs.map((t) => (
            <button key={t.id} role="tab" data-tour={`tab-${t.id}`} aria-selected={view === t.id} onClick={() => setView(t.id)}>{t.label}</button>
          ))}
        </nav>
        <div className="status">
          <span className={`dot ${state.connected ? "live" : ""}`} />
          {state.replay ? "Recorded demo" : state.connected ? "Live" : "Connecting…"}
          {state.replay && <button className="tour-help" aria-label="Show the tour" title="Show the tour" onClick={() => setTourSignal((n) => n + 1)}>?</button>}
        </div>
      </header>
      {state.replay && <Tour openSignal={tourSignal} />}
      <main className="view">{view === "follow" ? <FollowView /> : view === "map" ? <MapView /> : <FailuresView />}</main>
    </div>
  );
}

export function App() {
  return <NavProvider><Shell /></NavProvider>;
}
