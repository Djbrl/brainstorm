// Owned by the lead. The line above the sidebar. On the project overview: what's going on now and what changed since you
// last looked (see lib/visit.ts); a recording (the hosted demo) has no last visit, so it says what the project holds.
// With a thread open: that thread's summary, what it changed, read, how many steps and how long it worked.
import { isReplay, useLive } from "../lib/live";
import { useNav } from "../lib/nav";
import { useThread } from "../lib/thread";
import { activeMs, duration } from "../lib/chapters";
import { lastSeen, sinceLabel, sinceMs } from "../lib/visit";

const n = (k: number, one: string, many = `${one}s`) => `${k.toLocaleString()} ${k === 1 ? one : many}`;

function ThreadStats({ sessionId }: { sessionId: string }) {
  const { state } = useLive();
  const { replay } = useNav();
  const thread = useThread(sessionId, replay?.detail ?? "light");
  if (!thread) return null;
  const touched = [...thread.touched.values()];
  const changed = touched.filter((t) => t.edits > 0).length;
  const read = touched.filter((t) => t.edits === 0 && t.reads > 0).length;
  const steps = state.steps[sessionId];
  const took = steps && steps.length > 1 ? duration(activeMs(steps)) : "";
  const parts = [changed ? `Changed ${n(changed, "file")}` : "Changed no files", read ? `read ${read.toLocaleString()} more` : "", n(thread.stepCount, "step"), took];
  return <p className="map-stats">{parts.filter(Boolean).join(" · ")}</p>;
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
