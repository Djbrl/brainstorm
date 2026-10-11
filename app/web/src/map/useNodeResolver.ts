// Every file and folder on the map by id (a folder's ends in "/"), and how an agent's file (or a searched directory)
// finds its node: the same path, an island's file from another checkout, the same file in another worktree, or the
// first file under a directory. Moved out of MapView.tsx.
import { useCallback, useMemo, useRef } from "react";
import type { ProjectMap } from "@contract";
import { makeFileResolver } from "../lib/paths";
import { islandPath } from "../lib/islands";
import { PARK } from "./agents";
import type { Graph, GNode } from "./graph";

export function useNodeResolver(map: ProjectMap | null, graph: Graph) {
  // The nodes by id, and PARK: where an agent waits that hasn't touched a file yet, the top of the project's circle.
  const nodeIndex = useMemo(() => {
    const m = new Map(graph.nodes.map((n) => [n.id, n]));
    let reach = 0;
    for (const n of graph.nodes) if (!n.up && !n.isle && n.x !== undefined && n.y !== undefined) reach = Math.max(reach, Math.hypot(n.x, n.y) + n.r);
    if (reach > 0) m.set(PARK, { id: PARK, x: 0, y: -reach, r: 0, slot: 0, file: { path: "", module: "", lines: 0 } } as GNode);
    return m;
  }, [graph.nodes]);
  const nodeIndexRef = useRef(nodeIndex); nodeIndexRef.current = nodeIndex;
  /** Map an agent's file (or a searched directory) to a node id on the map. */
  const fileResolver = useMemo(() => makeFileResolver(map), [nodeIndex, map?.root, map?.formerRoots]); // eslint-disable-line react-hooks/exhaustive-deps
  // Every answer is kept (misses too) until the files change: agents ask for the same few files on every frame.
  const resolved = useMemo(() => new Map<string, string | null>(), [nodeIndex, fileResolver]); // eslint-disable-line react-hooks/exhaustive-deps
  const resolvedRef = useRef({ resolved, fileResolver }); resolvedRef.current = { resolved, fileResolver };
  const resolveId = useCallback((file: string): string | undefined => {
    const { resolved: memo, fileResolver: same } = resolvedRef.current;
    const hit = memo.get(file);
    if (hit !== undefined) return hit ?? undefined;
    const idx = nodeIndexRef.current;
    let id: string | undefined;
    if (idx.has(file)) id = file;
    else if (idx.has(islandPath(file))) id = islandPath(file);   // an island's file, from another checkout of its repo
    else {
      const other = same(file); // same file in another worktree of this repo
      if (other && idx.has(other)) id = other;
      else {
        const dir = file.replace(/\/+$/, "") + "/";
        for (const k of idx.keys()) if (k.startsWith(dir)) { id = k; break; }
      }
    }
    memo.set(file, id ?? null);
    return id;
  }, []);
  return { nodeIndex, nodeIndexRef, resolveId };
}
