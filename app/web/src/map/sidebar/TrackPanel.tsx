// Owner: sidebar agent. The sidebar's Track tab: the open thread's steps, next to the map (scrolling them moves the
// tracer), or its places on the Places lens. Its title is in the header and its numbers above the sidebar (MapStats).
import { useNav } from "../../lib/nav";
import { ReplaySteps } from "../replay/ReplaySteps";
import { PlaceSteps } from "../../cowork/PlaceSteps";

export function TrackPanel() {
  const { replay, lens } = useNav();
  if (!replay) return null;
  return <div className="sidebar-track">{lens === "places" ? <PlaceSteps /> : <ReplaySteps />}</div>;
}
