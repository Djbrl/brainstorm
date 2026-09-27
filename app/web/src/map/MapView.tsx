// Owner: D. Force graph of files/modules, glow by recency, pulse on activeSessionId, side panel + AskBox.
import { useLive } from "../lib/live";

export function MapView() {
  const { state } = useLive();
  return <div style={{ padding: 40 }}><h1>Map</h1><p>{state.map?.files.length ?? 0} files</p></div>;
}
