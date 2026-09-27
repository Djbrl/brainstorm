// Owner: sidebar agent. Files tab: a searchable folder tree of the codebase, with per-file recency
// dots and, during a replay, which files that thread touched.
import { useEffect, useMemo, useState } from "react";
import type { ProjectMap } from "@contract";
import { clock } from "../../lib/live";
import { useNav } from "../../lib/nav";
import { useThread } from "../../lib/thread";
import { repoBase } from "../../lib/paths";
import { buildTree, collectDirPaths, filterTree } from "./fileTree";
import { FileTreeView } from "./FileTreeView";

function useTick(ms: number) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

export function FilesPanel({ map, onFocusFile }: { map: ProjectMap | null; onFocusFile: (path: string) => void }) {
  useTick(20000);
  const now = clock();
  const { replay } = useNav();
  const thread = useThread(replay?.sessionId ?? null);
  const [search, setSearch] = useState("");
  const [touchedOnly, setTouchedOnly] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const base = useMemo(() => (map ? repoBase(map.root) : ""), [map]);
  const tree = useMemo(() => (map ? buildTree(map.files, base) : null), [map, base]);
  const touched = replay ? thread?.touched ?? null : null;
  const filtering = search.trim().length > 0 || touchedOnly;

  const filtered = useMemo(() => {
    if (!tree) return null;
    return filtering ? filterTree(tree, { query: search, touched, touchedOnly }) : tree;
  }, [tree, filtering, search, touched, touchedOnly]);

  const forceExpanded = useMemo(() => (filtering && filtered ? collectDirPaths(filtered) : null), [filtering, filtered]);

  const toggleDir = (path: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(path)) n.delete(path);
      else n.add(path);
      return n;
    });

  if (!map || !tree) return <p className="sidebar-empty">No files mapped yet.</p>;

  return (
    <div className="sidebar-files">
      <div className="sidebar-search">
        <input type="search" placeholder="Search files" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search files" />
      </div>
      {replay && (
        <button className={`sidebar-chip ${touchedOnly ? "active" : ""}`} aria-pressed={touchedOnly} onClick={() => setTouchedOnly((v) => !v)}>
          Touched by this thread
        </button>
      )}
      <div className="sidebar-tree-scroll">
        {filtered ? (
          <FileTreeView dir={filtered} depth={0} now={now} expanded={expanded} forceExpanded={forceExpanded} toggleDir={toggleDir} onFocusFile={onFocusFile} touched={touched} />
        ) : (
          <p className="sidebar-empty">No matching files.</p>
        )}
      </div>
    </div>
  );
}
