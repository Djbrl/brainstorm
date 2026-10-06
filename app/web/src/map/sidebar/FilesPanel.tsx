// Owner: sidebar agent. Files tab: a searchable folder tree of the codebase, with per-file recency
// dots and, during a replay, which files that thread touched.
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { ProjectMap } from "@contract";
import { clock } from "../../lib/live";
import { useNav } from "../../lib/nav";
import { useThread } from "../../lib/thread";
import { repoBase } from "../../lib/paths";
import { buildTree, filterTree, flattenTree, refreshLeaves, samePaths, type BuiltTree } from "./fileTree";
import { FileTreeView } from "./FileTreeView";

function useTick(ms: number) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

/**
 * The folder tree for a map, built again only when a file is added or removed (or the root changes). An agent editing
 * a file sends a new map for every edit: the same paths, so the tree stays and its leaves point at the new nodes.
 */
function useFileTree(map: ProjectMap | null): BuiltTree | null {
  const built = useRef<{ files: ProjectMap["files"]; base: string; tree: BuiltTree } | null>(null);
  const files = map?.files ?? null, base = map ? repoBase(map.root) : "";
  return useMemo(() => {
    if (!files) return null;
    const b = built.current;
    if (b && b.base === base && samePaths(b.files, files)) {
      if (b.files !== files) { refreshLeaves(b.tree, files); b.files = files; }
      return b.tree;
    }
    const tree = buildTree(files, base);
    built.current = { files, base, tree };
    return tree;
  }, [files, base]);
}

export function FilesPanel({ map, onFocusFile, hidden = false }: {
  map: ProjectMap | null; onFocusFile: (path: string) => void;
  /** A file is open in its place (FileView): the tree stays, as it was, out of sight. */
  hidden?: boolean;
}) {
  useTick(20000);
  const now = clock();
  const { replay } = useNav();
  const thread = useThread(replay?.sessionId ?? null, replay?.detail ?? "light");
  const [search, setSearch] = useState("");
  const [touchedOnly, setTouchedOnly] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const built = useFileTree(map);
  const tree = built?.root ?? null;
  const touched = replay ? thread?.touched ?? null : null;
  // The box answers every key at once; the tree follows when there's time (typing never waits on a 20,000-file filter).
  const query = useDeferredValue(search);
  const filtering = query.trim().length > 0 || touchedOnly;

  const filtered = useMemo(() => {
    if (!tree) return null;
    return filtering ? filterTree(tree, { query, touched, touchedOnly }) : tree;
  }, [tree, filtering, query, touched, touchedOnly]);

  // While filtering, every folder of the result is open.
  const rows = useMemo(() => (filtered ? flattenTree(filtered, filtering ? null : expanded) : []), [filtered, filtering, expanded]);

  const toggleDir = useCallback((path: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(path)) n.delete(path);
      else n.add(path);
      return n;
    }), []);
  // The sidebar hands a new function each render: the rows keep one that calls the latest.
  const focusRef = useRef(onFocusFile); focusRef.current = onFocusFile;
  const focusFile = useCallback((path: string) => focusRef.current(path), []);

  if (!map || !tree) return hidden ? null : <p className="sidebar-empty">No files mapped yet.</p>;

  return (
    <div className="sidebar-files" hidden={hidden}>
      <div className="sidebar-search">
        <input type="search" placeholder="Search files" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search files" />
      </div>
      {(map.totalFiles ?? 0) > map.files.length && (
        <p className="sidebar-files-note">
          The map shows {map.files.length.toLocaleString()} of {map.totalFiles!.toLocaleString()} files: from every folder, the ones agents
          touched, changed lately or that many files use. A file an agent edits always joins.
        </p>
      )}
      {replay && (
        <button className={`sidebar-chip ${touchedOnly ? "active" : ""}`} aria-pressed={touchedOnly} onClick={() => setTouchedOnly((v) => !v)}>
          Touched by this thread
        </button>
      )}
      <div className="sidebar-tree-scroll">
        {filtered ? (
          <FileTreeView rows={rows} files={map.files} now={now} toggleDir={toggleDir} onFocusFile={focusFile} touched={touched} />
        ) : (
          <p className="sidebar-empty">No matching files.</p>
        )}
      </div>
    </div>
  );
}
