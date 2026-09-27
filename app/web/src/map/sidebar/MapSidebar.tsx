// Owner: sidebar agent. Floating left sidebar on the map: [Threads | Files] tabs. STUB: renders the old tracker.
import type { AgentPresence, ProjectMap } from "@contract";
import { AgentTracker } from "../agents";

export type MapSidebarProps = {
  /** All live agents, including hidden ones (so they can be shown again). */
  agents: AgentPresence[];
  accent: string;
  followId: string | null;
  onFollow: (id: string | null) => void;
  /** Center the map on a file and open its panel. */
  onFocusFile: (path: string) => void;
  map: ProjectMap | null;
};

export function MapSidebar({ agents, accent, followId, onFollow, onFocusFile }: MapSidebarProps) {
  return <AgentTracker agents={agents} accent={accent} followId={followId} onFollow={onFollow} onFocusFile={onFocusFile} />;
}
