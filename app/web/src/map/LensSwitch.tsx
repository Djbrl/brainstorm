// Map | Places: two views of the same thread. One place on each size: in the thread bar on a full screen
// (switch/ThreadBar.tsx), in the compact bar at the bottom below it (switch/CompactBar.tsx). Nothing floats on the map.
import { useNavActions, useNavState } from "../lib/nav";
import "./lens.css";

export function LensSwitch() {
  const { lens, thread } = useNavState();
  const { setLens } = useNavActions();
  if (!thread) return null; // views of one thread: they appear once a thread is open
  return (
    <div className="lens-switch" role="tablist" aria-label="View">
      <button role="tab" aria-selected={lens === "map"} onClick={() => setLens("map")}>Map</button>
      <button role="tab" aria-selected={lens === "places"} onClick={() => setLens("places")}>Places</button>
    </div>
  );
}
