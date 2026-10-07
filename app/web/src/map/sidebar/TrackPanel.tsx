// Owner: sidebar agent. The sidebar's Track tab: the open thread's steps, next to the map (scrolling them moves the
// tracer), or its places on the Places lens, under the thread's name (so you see which one you're tracking); its numbers
// are above the sidebar (MapStats).
import { useNav } from "../../lib/nav";
import { useLiveSelector } from "../../lib/live";
import { isCodex } from "../../lib/harness";
import { ReplaySteps } from "../replay/ReplaySteps";
import { PlaceSteps } from "../../cowork/PlaceSteps";

export function TrackPanel() {
  const { replay, lens } = useNav();
  const sid = replay?.sessionId;
  const session = useLiveSelector((s) => (sid ? s.sessions.find((x) => x.id === sid) : undefined));
  if (!replay) return null;
  return (
    <div className="sidebar-track">
      <h2 className="sidebar-track-title" title={session?.title}>
        <span>{session?.title || "Untitled thread"}</span>
        {session && isCodex(session) && <small>Codex</small>}
      </h2>
      {lens === "places" ? <PlaceSteps /> : <ReplaySteps />}
    </div>
  );
}
