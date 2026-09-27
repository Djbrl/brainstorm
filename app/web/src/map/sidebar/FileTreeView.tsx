// Owner: sidebar agent. Recursive rendering of the folder tree built in fileTree.ts.
import type { DirNode, FileLeaf, TreeChild } from "./fileTree";

type Touched = Map<string, { edits: number; reads: number }> | null;

type SharedProps = {
  now: number;
  expanded: ReadonlySet<string>;
  /** Set while search/touched filtering is on: every directory in it renders open, ignoring `expanded`. */
  forceExpanded: ReadonlySet<string> | null;
  toggleDir: (path: string) => void;
  onFocusFile: (path: string) => void;
  touched: Touched;
};

const INDENT = 14;

export function FileTreeView({ dir, depth, ...shared }: SharedProps & { dir: DirNode; depth: number }) {
  return (
    <ul className="sidebar-tree" role="group">
      {dir.children.map((c) => <TreeRow key={c.path} node={c} depth={depth} {...shared} />)}
    </ul>
  );
}

function TreeRow({ node, depth, ...shared }: SharedProps & { node: TreeChild; depth: number }) {
  return node.type === "dir" ? <DirRow dir={node} depth={depth} {...shared} /> : <FileRow node={node} depth={depth} {...shared} />;
}

function DirRow({ dir, depth, expanded, forceExpanded, toggleDir, ...rest }: SharedProps & { dir: DirNode; depth: number }) {
  const open = forceExpanded ? forceExpanded.has(dir.path) : expanded.has(dir.path);
  return (
    <li>
      <button className="sidebar-tree-dir" style={{ paddingLeft: 6 + depth * INDENT }} aria-expanded={open} onClick={() => toggleDir(dir.path)}>
        <i className={`sidebar-tree-caret ${open ? "open" : ""}`} aria-hidden="true">›</i>
        <span className="sidebar-tree-name">{dir.name}</span>
        <span className="sidebar-tree-count">{dir.fileCount}</span>
      </button>
      {open && <FileTreeView dir={dir} depth={depth + 1} expanded={expanded} forceExpanded={forceExpanded} toggleDir={toggleDir} {...rest} />}
    </li>
  );
}

const MIN = 60_000, HOUR = 60 * MIN;
function recencyClass(iso: string | undefined, now: number): "hot" | "warm" | "cool" {
  if (!iso) return "cool";
  const age = now - Date.parse(iso);
  if (!(age >= 0) || age < 5 * MIN) return "hot";
  if (age < HOUR) return "warm";
  return "cool";
}

function FileRow({ node, depth, now, onFocusFile, touched }: SharedProps & { node: FileLeaf; depth: number }) {
  const cls = recencyClass(node.file.lastChangedAt, now);
  const counts = touched?.get(node.file.path);
  const label = [counts?.edits ? `${counts.edits} edit${counts.edits === 1 ? "" : "s"}` : null, counts?.reads ? `${counts.reads} read${counts.reads === 1 ? "" : "s"}` : null]
    .filter(Boolean).join(" · ");
  return (
    <li>
      <button
        className="sidebar-tree-file"
        style={{ paddingLeft: 6 + depth * INDENT + INDENT }}
        onClick={() => onFocusFile(node.file.path)}
        title={node.file.activeSessionId ? `${node.name} — an agent is editing this now` : node.name}
      >
        <i className={`sidebar-file-dot ${cls}`} aria-hidden="true" />
        <span className="sidebar-tree-name">{node.name}</span>
        {node.file.activeSessionId && <i className="sidebar-file-active" aria-hidden="true" />}
        {label && <span className="sidebar-tree-touched">{label}</span>}
      </button>
    </li>
  );
}
