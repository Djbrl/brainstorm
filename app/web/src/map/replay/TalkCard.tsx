// Owned by the lead. While a replay has no file to trace (a thread that never touches one, like drafting an email, or
// the talk before a thread's first edit), the conversation plays on one card over the map instead of nothing moving.
import { useNav } from "../../lib/nav";
import { beatLabel, countParts, useThread } from "../../lib/thread";
import { stripInjected } from "../../follow/format";

const MAX = 420;
const cut = (t: string) => (t.length > MAX ? `${t.slice(0, MAX - 1).trimEnd()}…` : t);

export function TalkCard() {
  const { replay, setLens, step } = useNav();
  const thread = useThread(replay?.sessionId ?? null, replay?.detail ?? "light");
  if (!replay || replay.mode !== "play" || step || !thread || thread.sessionId !== replay.sessionId || !thread.beats.length) return null;
  const beat = thread.beats[Math.min(replay.index, thread.beats.length - 1)];
  const noFiles = thread.touched.size === 0;
  if (!noFiles && beat.moveIndex >= 0) return null; // the tracer is on the map: it tells the story
  const you = beat.step.kind === "prompt" && !beat.step.isSubagent;
  const text = cut(you ? stripInjected(beat.step.text) || beatLabel(beat) : beatLabel(beat));
  const parts = !you && beat.counts ? countParts(beat.counts).filter((p) => !p.endsWith("message") && !p.endsWith("messages")) : [];
  const web = thread.beats.some((b) => b.steps.some((s) => s.kind === "tool_call" && /browser|chrome|WebFetch|navigate/i.test(s.tool ?? "")));
  return (
    <div className="rp-talk" aria-live="polite">
      <p className="rp-talk-who">{you ? "You" : "Agent"}</p>
      <p className={`rp-talk-text${you ? " you" : ""}`} key={beat.index}>{text}</p>
      {(parts.length > 0 || web) && (
        <p className="rp-talk-meta">
          {parts.join(" · ")}
          {web && <button className="rp-talk-link" onClick={() => setLens("places")}>See the places it visited</button>}
        </p>
      )}
      <p className="rp-talk-note">{noFiles ? "This thread didn't change any files, so its conversation plays here." : "The map lights up at its first edit."}</p>
    </div>
  );
}
