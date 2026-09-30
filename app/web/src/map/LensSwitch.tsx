// Owned by the lead. Map | Track | Places: three views of the same thread, floating at the top of the Map tab.
import { isReplay, useLive } from "../lib/live";
import { useNav, type Lens } from "../lib/nav";

export function LensSwitch() {
  const { lens, setLens, replay, startReplay } = useNav();
  const { state } = useLive();
  const demo = isReplay(); // the hosted demos carry places but no Track (its screenshots stay on your computer)
  // Track and Places are about one thread: with none open, they open on the newest one instead of "Pick a thread".
  const pick = (l: Lens) => {
    setLens(l);
    if (l === "map" || replay) return;
    const latest = [...state.sessions].sort((a, b) => b.lastEventAt.localeCompare(a.lastEventAt))[0];
    if (latest) startReplay(latest.id, 0, { live: latest.status === "running" });
  };
  return (
    <div className="lens-switch" role="tablist" aria-label="View">
      <button role="tab" aria-selected={lens === "map"} onClick={() => pick("map")}>Map</button>
      {!demo && <button role="tab" aria-selected={lens === "track"} onClick={() => pick("track")}>Track</button>}
      <button role="tab" aria-selected={lens === "places"} onClick={() => pick("places")}>Places</button>
    </div>
  );
}
