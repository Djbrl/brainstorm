// Map | Places: two views of the same thread, floating at the top of the Map tab. (A thread's Track
// is the sidebar's second tab, next to the map.) On a small window it sits in the thread bar instead (`inBar`), and the
// top of the map is left to the folded sidebar's card with the thread's step (lens.css).
import { useNav } from "../lib/nav";
import "./lens.css";

export function LensSwitch({ inBar }: { inBar?: boolean } = {}) {
  const { lens, setLens, replay } = useNav();
  if (!replay) return null; // views of one thread: they appear once a thread is open
  return (
    <div className={`lens-switch${inBar ? " in-bar" : ""}`} role="tablist" aria-label="View">
      <button role="tab" aria-selected={lens === "map"} onClick={() => setLens("map")}>Map</button>
      <button role="tab" aria-selected={lens === "places"} onClick={() => setLens("places")}>Places</button>
    </div>
  );
}
