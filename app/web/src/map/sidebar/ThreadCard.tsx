// Owned by the lead. A thread's footprint, the first thing you see when you open it: what you asked, what it changed,
// and two ways in, its steps or its replay. The map meanwhile lights the files it touched.
import type { Session } from "@contract";
import { useLive } from "../../lib/live";
import { useNav } from "../../lib/nav";
import { useThread } from "../../lib/thread";
import { basename, stripInjected } from "../../follow/format";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function duration(from: string, to: string): string {
  const min = Math.round((Date.parse(to) - Date.parse(from)) / 60_000);
  if (!Number.isFinite(min) || min < 1) return "";
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ""}`;
}

export function ThreadCard({ session }: { session: Session }) {
  const { state } = useLive();
  const { setThreadMode, setReplayPlaying, setReplayIndex, setReplayLive, openFile } = useNav();
  const thread = useThread(session.id, "light");
  const running = session.status === "running";
  const prompt = state.steps[session.id]?.find((s) => s.kind === "prompt" && !s.isSubagent && stripInjected(s.text).trim());
  const touched = thread ? [...thread.touched.entries()] : [];
  const changed = touched.filter(([, t]) => t.edits > 0).sort((a, b) => b[1].edits - a[1].edits);
  const read = touched.filter(([, t]) => t.edits === 0 && t.reads > 0).length;
  const took = duration(session.startedAt, session.lastEventAt);

  const play = () => {
    if (running) { setReplayLive(true); return; }
    setReplayIndex(0);
    setReplayPlaying(true);
  };

  return (
    <div className="thread-card">
      {prompt && <p className="thread-card-prompt" title={stripInjected(prompt.text)}>{stripInjected(prompt.text)}</p>}
      <p className="thread-card-facts">
        {thread ? <>
          {changed.length ? `Changed ${plural(changed.length, "file")}` : "Changed no files"}
          {read > 0 && ` · read ${read} more`}
          {` · ${plural(thread.stepCount, "step")}`}
          {took && ` · ${took}`}
        </> : "Reading the thread…"}
      </p>
      {changed.length > 0 && (
        <ul className="thread-card-files">
          {changed.slice(0, 6).map(([path, t]) => (
            <li key={path}><button onClick={() => openFile(path)} title={`${path}\n${plural(t.edits, "edit")}. Show it on the map`}>{basename(path)}</button></li>
          ))}
          {changed.length > 6 && <li className="more">+{changed.length - 6}</li>}
        </ul>
      )}
      <div className="thread-card-actions">
        <button className="thread-card-play" onClick={play} disabled={!thread?.beats.length}>
          <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.8v8.4L10.2 6z" fill="currentColor" /></svg>
          {running ? "Follow live" : "Play"}
        </button>
        <button className="thread-card-steps" onClick={() => setThreadMode("steps")} disabled={!thread?.beats.length}>Steps</button>
      </div>
    </div>
  );
}
