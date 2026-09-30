// Owned by the lead. Map | Track | Places: three views of the same thread, floating at the top of the Map tab.
import { isReplay } from "../lib/live";
import { useNav } from "../lib/nav";

export function LensSwitch() {
  const { lens, setLens } = useNav();
  const demo = isReplay(); // the hosted demos carry places but no Track (its screenshots stay on your computer)
  return (
    <div className="lens-switch" role="tablist" aria-label="View">
      <button role="tab" aria-selected={lens === "map"} onClick={() => setLens("map")}>Map</button>
      {!demo && <button role="tab" aria-selected={lens === "track"} onClick={() => setLens("track")}>Track</button>}
      <button role="tab" aria-selected={lens === "places"} onClick={() => setLens("places")}>Places</button>
    </div>
  );
}
