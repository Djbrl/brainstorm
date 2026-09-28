// Owned by the lead. Map | Track: two views of the same thread, floating at the top of the Map tab.
import { isReplay } from "../lib/live";
import { useNav } from "../lib/nav";

export function LensSwitch() {
  const { lens, setLens } = useNav();
  if (isReplay()) return null; // the hosted demos have no Tasks API
  return (
    <div className="lens-switch" role="tablist" aria-label="View">
      <button role="tab" aria-selected={lens === "map"} onClick={() => setLens("map")}>Map</button>
      <button role="tab" aria-selected={lens === "track"} onClick={() => setLens("track")}>Track</button>
    </div>
  );
}
