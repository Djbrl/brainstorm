// Owner: replay agent. "Replay on map" button for the Follow session header.
import { useNav } from "../../lib/nav";
import "./replay.css";

/** Starts a thread replay on the map at `index` (the selected step's position in the session, or 0). */
export function ReplayOnMapButton({ sessionId, index = 0 }: { sessionId: string; index?: number }) {
  const { startReplay } = useNav();
  return (
    <button className="rp-follow-btn" onClick={() => startReplay(sessionId, Math.max(0, index))}
      title={index > 0 ? "Replay this thread on the map from the selected step" : "Replay this thread on the map"}>
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.2v9.6L12.8 8z" fill="currentColor" /></svg>
      Replay on map
    </button>
  );
}
