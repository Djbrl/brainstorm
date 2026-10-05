// Owned by the lead. The line above the sidebar. On the project overview: what's going on now and what changed since you
// last looked (see lib/visit.ts); a recording (the hosted demo) has no last visit, so it says what the project holds.
// With a thread open: that thread's summary, what it changed, read, how many steps and how long it worked, in the
// same words and numbers as the Track lens (lib/words.ts).
import { isReplay, useLive } from "../lib/live";
import { useNav } from "../lib/nav";
import { lastSeen, sinceLabel, sinceMs } from "../lib/visit";
import { plural as n, threadLine, useThreadNumbers } from "../lib/words";

function ThreadStats({ sessionId }: { sessionId: string }) {
  const numbers = useThreadNumbers(sessionId);
  if (!numbers) return null;
  return <p className="map-stats">{threadLine(numbers)}</p>;
}

export function MapStats() {
  const { state } = useLive();
  const { replay } = useNav();
  const map = state.map;
  if (replay) return <ThreadStats sessionId={replay.sessionId} />;
  if (!map) return null;
  const working = Object.values(state.agents).filter((a) => a.active).length;
  if (isReplay()) {
    return <p className="map-stats">{n(state.sessions.length, "thread")} · {n(map.files.length, "file")}{working ? ` · ${n(working, "agent")} working now` : ""}</p>;
  }
  const threads = state.sessions.filter((s) => Date.parse(s.lastEventAt) > sinceMs).length;
  const files = map.files.filter((f) => f.lastChangedAt && Date.parse(f.lastChangedAt) > sinceMs).length;
  const when = lastSeen ? `since you last looked, ${sinceLabel(lastSeen)}` : "in the last day";
  const parts = [
    working ? `${n(working, "agent")} working now` : "",
    threads || files ? `${n(threads, "thread")} and ${n(files, "file")} changed ${when}` : `Nothing changed ${when}`,
  ].filter(Boolean);
  return <p className="map-stats">{parts.join(" · ")}</p>;
}
