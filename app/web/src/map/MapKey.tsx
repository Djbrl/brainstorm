// Owner: peek. The map's colour key, in the top-right corner across from the stats line, where a map keeps its key. It
// used to sit in the footer pill, which now holds only what you can do (Replay, Share and the switches). The same
// words as before: how recently a file changed, what an open thread only read, and the selected file's import lines.
// It steps aside while a side panel covers that corner.
import { isReplay } from "../lib/live";
import { lastSeen } from "../lib/visit";

export function MapKey({ thread, reads, imports }: { thread: boolean; reads: boolean; imports: string | null }) {
  return (
    <div className="map-key" aria-label="Map colours">
      <span><i style={{ background: "var(--hot)" }} />Just now</span>
      <span><i style={{ background: "var(--warm)" }} />{isReplay() ? "This hour" : lastSeen ? "Since you last looked" : "In the last day"}</span>
      <span><i style={{ background: "var(--cool)" }} />Earlier</span>
      {/* With a thread open the colours are its own changes; what it only read is the faint dot. */}
      {thread && reads && <span className="map-key-read" title="Files this thread read but didn't change"><i style={{ background: "var(--cool)", opacity: 0.5 }} />Read</span>}
      {imports && <span title="What the selected file imports"><i className="line" style={{ background: imports }} />Imports</span>}
    </div>
  );
}
