// Owner: C. Sessions list + live timeline of steps. Click a step → diff + AskBox.
import { useLive } from "../lib/live";

export function FollowView() {
  const { state } = useLive();
  return <div style={{ padding: 40 }}><h1>Follow</h1><p>{state.sessions.length} sessions</p></div>;
}
