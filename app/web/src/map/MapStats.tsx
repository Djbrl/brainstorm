// Owned by the lead. The line above the sidebar on the project overview: what's going on now and what changed since you
// last looked (see lib/visit.ts). A recording (the hosted demo) has no last visit: it says what the project holds.
import { isReplay, useLive } from "../lib/live";
import { useNav } from "../lib/nav";
import { lastSeen, sinceLabel, sinceMs } from "../lib/visit";

const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;

export function MapStats() {
  const { state } = useLive();
  const { replay } = useNav();
  const map = state.map;
  if (!map || replay) return null; // an open thread says where you are in the header
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
