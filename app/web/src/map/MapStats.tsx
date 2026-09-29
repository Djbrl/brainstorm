// Owned by the lead. The line above the sidebar: how many threads, files and modules, and what's being edited now.
import { useLive } from "../lib/live";

export function MapStats() {
  const { state } = useLive();
  const map = state.map;
  if (!map) return null;
  const editing = map.files.filter((f) => f.activeSessionId).length;
  const n = (k: number, w: string) => `${k} ${w}${k === 1 ? "" : "s"}`;
  return (
    <p className="map-stats">
      {n(state.sessions.length, "thread")} · {n(map.files.length, "file")} · {n(map.modules.length, "module")}{editing ? ` · ${editing} being edited now` : ""}
    </p>
  );
}
