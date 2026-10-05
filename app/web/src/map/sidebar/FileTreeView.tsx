// Owner: sidebar agent. The folder tree built in fileTree.ts, as the lines it shows (flattenTree). A project can have
// tens of thousands of files and a search can open every folder, so only the lines in and near the view are drawn
// (every line is the same height), with empty space standing in for the rest.
import { memo, useCallback, useLayoutEffect, useRef, useState } from "react";
import type { FileNode } from "@contract";
import type { DirNode, FileLeaf, TreeRow } from "./fileTree";

type Touched = Map<string, { edits: number; reads: number }> | null;

const INDENT = 14;
const ROW_H = 29.5;        // a line's height until one is measured (.sidebar-tree-dir / -file: one line)
const OVERSCAN = 30;       // lines drawn past each edge of the view

/** The nearest scrolling ancestor (the sidebar's body). */
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if (o === "auto" || o === "scroll") return p;
  }
  return null;
}

export const FileTreeView = memo(function FileTreeView({ rows, now, toggleDir, onFocusFile, touched }: {
  /** The map's file list: a new one means a file changed (its leaf now points at the new node), so the lines redraw. */
  files: FileNode[];
  rows: TreeRow[];
  now: number;
  toggleDir: (path: string) => void;
  onFocusFile: (path: string) => void;
  touched: Touched;
}) {
  const ref = useRef<HTMLUListElement>(null);
  const [rowH, setRowH] = useState(ROW_H);
  const [view, setView] = useState<[number, number]>([0, 80]);

  // Which lines are in view, from where the list sits in its scrolling ancestor; drawn again only near the edges.
  useLayoutEffect(() => {
    const ul = ref.current, sc = scrollParent(ul);
    if (!ul || !sc) return;
    const update = () => {
      const top = ul.getBoundingClientRect().top - sc.getBoundingClientRect().top;
      const a = Math.floor(-top / rowH), b = Math.ceil((sc.clientHeight - top) / rowH);
      setView((cur) => (a - OVERSCAN / 2 < cur[0] && cur[0] > 0) || (b + OVERSCAN / 2 > cur[1] && cur[1] < rows.length) || b < cur[0] || a > cur[1]
        ? [Math.max(0, a - OVERSCAN), b + OVERSCAN] : cur);
    };
    update();
    sc.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(sc);
    return () => { sc.removeEventListener("scroll", update); ro.disconnect(); };
  }, [rowH, rows.length]);
  useLayoutEffect(() => {
    const h = ref.current?.querySelector<HTMLElement>(".sidebar-tree-dir, .sidebar-tree-file")?.getBoundingClientRect().height;
    if (h && Math.abs(h - rowH) > 0.05) setRowH(h);
  });

  const start = Math.max(0, Math.min(view[0], rows.length)), end = Math.min(rows.length, view[1]);
  const lines = [];
  for (let i = start; i < end; i++) {
    const { node, depth, open } = rows[i];
    lines.push(node.type === "dir"
      ? <DirRow key={node.path} dir={node} depth={depth} open={open} toggleDir={toggleDir} />
      : <FileRow key={node.path} leaf={node} file={node.file} depth={depth} cls={recencyClass(node.file.lastChangedAt, now)} counts={countsLabel(touched, node.file.path)} onFocusFile={onFocusFile} />);
  }
  return (
    <ul className="sidebar-tree" role="group" ref={ref}>
      {start > 0 && <li aria-hidden="true" style={{ height: start * rowH }} />}
      {lines}
      {end < rows.length && <li aria-hidden="true" style={{ height: (rows.length - end) * rowH }} />}
    </ul>
  );
});

const DirRow = memo(function DirRow({ dir, depth, open, toggleDir }: { dir: DirNode; depth: number; open: boolean; toggleDir: (path: string) => void }) {
  return (
    <li>
      <button className="sidebar-tree-dir" style={{ paddingLeft: 6 + depth * INDENT }} aria-expanded={open} onClick={() => toggleDir(dir.path)}>
        <i className={`sidebar-tree-caret ${open ? "open" : ""}`} aria-hidden="true">›</i>
        <span className="sidebar-tree-name">{dir.name}</span>
        <span className="sidebar-tree-count">{dir.fileCount}</span>
      </button>
    </li>
  );
});

const MIN = 60_000, HOUR = 60 * MIN;
function recencyClass(iso: string | undefined, now: number): "hot" | "warm" | "cool" {
  if (!iso) return "cool";
  const age = now - Date.parse(iso);
  if (!(age >= 0) || age < 5 * MIN) return "hot";
  if (age < HOUR) return "warm";
  return "cool";
}

function countsLabel(touched: Touched, path: string): string {
  const counts = touched?.get(path);
  if (!counts) return "";
  return [counts.edits ? `${counts.edits} edit${counts.edits === 1 ? "" : "s"}` : null, counts.reads ? `${counts.reads} read${counts.reads === 1 ? "" : "s"}` : null]
    .filter(Boolean).join(" · ");
}

/** A file line. `file` is passed apart from the leaf: the leaf stays, the map's node for it changes when the file does. */
const FileRow = memo(function FileRow({ leaf, file, depth, cls, counts, onFocusFile }:
  { leaf: FileLeaf; file: FileNode; depth: number; cls: "hot" | "warm" | "cool"; counts: string; onFocusFile: (path: string) => void }) {
  const focus = useCallback(() => onFocusFile(file.path), [onFocusFile, file.path]);
  return (
    <li>
      <button
        className="sidebar-tree-file"
        style={{ paddingLeft: 6 + depth * INDENT + INDENT }}
        onClick={focus}
        title={file.activeSessionId ? `${leaf.name} — an agent is editing this now` : leaf.name}
      >
        <i className={`sidebar-file-dot ${cls}`} aria-hidden="true" />
        <span className="sidebar-tree-name">{leaf.name}</span>
        {file.activeSessionId && <i className="sidebar-file-active" aria-hidden="true" />}
        {counts && <span className="sidebar-tree-touched">{counts}</span>}
      </button>
    </li>
  );
});
