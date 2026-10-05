// Owned by the lead. Map | Places: two views of the same thread, floating at the top of the Map tab. (A thread's Track
// is the sidebar's second tab, next to the map.)
import { useNav } from "../lib/nav";
import "../tasks/track.css"; // its own styles live there; Places can be the first view loaded

export function LensSwitch() {
  const { lens, setLens, replay } = useNav();
  if (!replay) return null; // views of one thread: they appear once a thread is open
  return (
    <div className="lens-switch" role="tablist" aria-label="View">
      <button role="tab" aria-selected={lens === "map"} onClick={() => setLens("map")}>Map</button>
      <button role="tab" aria-selected={lens === "places"} onClick={() => setLens("places")}>Places</button>
    </div>
  );
}
