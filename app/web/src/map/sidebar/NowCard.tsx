// Owner: sidebar agent. The folded sidebar with a thread open: a small card in the top-left corner says which thread, its
// state (working, thinking, needs you, your turn) and the step it's on (the newest one while it follows live). Clicking
// it, or T, unfolds the sidebar. On a small map it keeps you up to date without covering the map.
import { useNavState, useReplayCursor } from "../../lib/nav";
import { useLiveSelector } from "../../lib/live";
import { beatLabel, useThread } from "../../lib/thread";
import { injectedLabel } from "../../lib/chapters";
import { attentionText, needsYou, yourTurn } from "../../lib/attention";

export function NowCard({ onOpen }: { onOpen: () => void }) {
  const { replay } = useNavState();
  const sid = replay?.sessionId ?? null;
  const thread = useThread(sid, replay?.detail ?? "light");
  const index = useReplayCursor((c) => c.index);
  const session = useLiveSelector((s) => (sid ? s.sessions.find((x) => x.id === sid) : undefined));
  const attn = useLiveSelector((s) => (sid ? s.attention[sid] : undefined));
  if (!replay) return null;

  const beats = thread?.beats ?? [];
  const beat = beats.length ? beats[Math.min(index, beats.length - 1)] : undefined;
  const step = beat ? injectedLabel(beat.step) ?? beatLabel(beat) : "Loading its steps…";
  const failed = !!beat && beat.failed > 0;
  const [state, word] = needsYou(attn) ? ["blocked", attentionText(attn!).badge]
    : yourTurn(attn) ? ["turn", "Your turn"]
    : attn?.state === "thinking" ? ["working", "Thinking"]
    : session?.status === "running" ? ["working", "Working"]
    : ["idle", ""];
  // Looking back through it (not the newest step): say where, so the card doesn't read as what happens now.
  const back = !replay.live && beats.length > 0 && index < beats.length - 1;
  const title = session?.title || "Untitled thread";

  return (
    <button className="sidebar-now" onClick={onOpen} aria-expanded={false}
      aria-label={`Open the sidebar. ${title}${word ? `, ${word}` : ""}. ${back ? `Step ${index + 1}` : "Now"}: ${step}`}
      title="Open the sidebar (T)">
      <span className="sn-top">
        <i className={`sn-dot ${state}`} aria-hidden="true" />
        <b>{title}</b>
        {word && <em className={state}>{word}</em>}
      </span>
      <span className={`sn-step${failed ? " failed" : ""}`}>
        {back && <small>Step {index + 1}</small>}
        <span>{step}</span>
        {failed && <small className="sn-failed">failed</small>}
      </span>
      <i className="sn-open" aria-hidden="true">›</i>
    </button>
  );
}
