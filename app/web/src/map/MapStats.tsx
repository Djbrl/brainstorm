// Owned by the lead. The line above the sidebar. On the project overview: what's going on now and what changed since you
// last looked (see lib/visit.ts); a recording (the hosted demo) has no last visit, so it says what the project holds.
// With a thread open: that thread's summary, what it changed, read, how many steps and how long it worked, in the
// same words and numbers as the Track lens (lib/words.ts).
import type { FileNode, Session } from "@contract";
import { isReplay, useLive } from "../lib/live";
import { useNav } from "../lib/nav";
import { lastSeen, sinceLabel, sinceMs } from "../lib/visit";
import { plural as n, threadLine, useThreadNumbers } from "../lib/words";

const changedSince = (f: FileNode) => !!f.lastChangedAt && Date.parse(f.lastChangedAt) > sinceMs;

/**
 * Files changed since your last visit. The map has thousands of files and a new file list arrives with every file
 * the server sees change (the others are the same objects), so only the files that differ from the last count are
 * looked at again.
 */
let lastFiles: { files: FileNode[]; n: number } | null = null;
function filesSince(files: FileNode[]): number {
  const prev = lastFiles;
  if (prev?.files === files) return prev.n;
  let n = 0;
  if (prev && prev.files.length === files.length) {
    n = prev.n;
    for (let i = 0; i < files.length; i++) if (files[i] !== prev.files[i]) n += Number(changedSince(files[i])) - Number(changedSince(prev.files[i]));
  } else for (const f of files) if (changedSince(f)) n++;
  lastFiles = { files, n };
  return n;
}

const threadsSeen = new WeakMap<Session[], number>();
function threadsSince(sessions: Session[]): number {
  let n = threadsSeen.get(sessions);
  if (n === undefined) threadsSeen.set(sessions, (n = sessions.filter((s) => Date.parse(s.lastEventAt) > sinceMs).length));
  return n;
}

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
  const threads = threadsSince(state.sessions);
  const files = filesSince(map.files);
  const when = lastSeen ? `since you last looked, ${sinceLabel(lastSeen)}` : "in the last day";
  const parts = [
    working ? `${n(working, "agent")} working now` : "",
    threads || files ? `${n(threads, "thread")} and ${n(files, "file")} changed ${when}` : `Nothing changed ${when}`,
  ].filter(Boolean);
  return <p className="map-stats">{parts.join(" · ")}</p>;
}
