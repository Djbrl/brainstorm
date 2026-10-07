// Owner: sidebar agent. The sidebar's Track tab: the open thread's steps, next to the map (scrolling them moves the
// tracer), or its places on the Places lens, under the thread's name (so you see which one you're tracking); its numbers
// are above the sidebar (MapStats).
import { useNav } from "../../lib/nav";
import { useLiveSelector } from "../../lib/live";
import { isCodex } from "../../lib/harness";
import { visitorFrom } from "../../lib/islands";
import { ReplaySteps } from "../replay/ReplaySteps";
import { PlaceSteps } from "../../cowork/PlaceSteps";

export function TrackPanel() {
  const { replay, lens } = useNav();
  const sid = replay?.sessionId;
  const session = useLiveSelector((s) => (sid ? s.sessions.find((x) => x.id === sid) : undefined));
  const map = useLiveSelector((s) => s.map);
  if (!replay) return null;
  // A visitor: a thread working in another project that touched this one. Where it comes from.
  const from = visitorFrom(session?.cwd, map);
  return (
    <div className="sidebar-track">
      <h2 className="sidebar-track-title" title={session?.title}>
        <span>{session?.title || "Untitled thread"}</span>
        {session && isCodex(session) && <small>Codex</small>}
        {from && <small title={`Works in ${session!.cwd}, and touched this project`}>from {from}</small>}
      </h2>
      {lens === "places" ? <PlaceSteps /> : <ReplaySteps />}
    </div>
  );
}
