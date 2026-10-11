// The folders that show open at any zoom (fold.ts): around the selected file, the one a link focuses, what an open
// thread showed and where a followed agent worked (agents at work are added per frame, useMapFrame). Moved out of MapView.tsx.
import { useEffect, useMemo, useState } from "react";
import type { AgentPresence } from "@contract";
import { openAround } from "./fold";
import type { GNode } from "./graph";

export function useOpenFolders({ nodeIndex, selected, focusFile, footprint, sessionId, followId, agents, resolveId }: {
  nodeIndex: Map<string, GNode>; selected: string | null; focusFile: string | null;
  /** The open thread's files in view (replay/layer.ts footprint), or null. */
  footprint: string[] | null;
  sessionId: string | null; followId: string | null; agents: AgentPresence[];
  resolveId: (file: string) => string | undefined;
}): Set<GNode> {
  // What an open thread showed on the map and where a followed agent worked: their folders stay open while you watch.
  const [watched, setWatched] = useState<{ key: string; files: string[] }>({ key: "", files: [] });
  // The thread's files in view (its recent window, or all of it) and a followed agent's file open their folders, and
  // keep them open until the thread closes or you stop following: folders don't fold and open again as the window moves.
  useEffect(() => {
    const key = `${sessionId ?? ""}|${followId ?? ""}`;
    const add: string[] = [...(footprint ?? [])];
    const agent = followId ? agents.find((a) => a.id === followId) : undefined;
    const at = agent?.file ? resolveId(agent.file) : undefined;
    if (at) add.push(at);
    setWatched((w) => {
      const base = w.key === key ? w.files : [], had = new Set(base);
      const more = add.filter((f) => !had.has(f));
      return more.length || w.key !== key ? { key, files: base.concat(more) } : w;
    });
  });
  return useMemo(() => {
    const set = new Set<GNode>();
    for (const f of [selected, focusFile, ...watched.files]) if (f) openAround(nodeIndex.get(f), set);
    return set;
  }, [nodeIndex, selected, focusFile, watched.files]);
}
