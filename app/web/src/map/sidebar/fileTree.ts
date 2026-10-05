// Owner: sidebar agent. Pure folder-tree helpers for the Files tab: build once from the map,
// then prune for search / "touched by this thread" without touching the original tree, and lay out as rows.
import type { FileNode } from "@contract";
import { repoRelative } from "../../lib/paths";

/** A file in the tree. `file` is the map's current FileNode (kept up to date in place, see refreshLeaves). */
export type FileLeaf = { type: "file"; name: string; path: string; lower: string; file: FileNode };
export type DirNode = { type: "dir"; name: string; path: string; children: TreeChild[]; fileCount: number };
export type TreeChild = DirNode | FileLeaf;
/** The tree, and each map file's leaf by its index in the map's file list (null: not under the repo root). */
export type BuiltTree = { root: DirNode; leaves: (FileLeaf | null)[] };

/** Build the folder tree once from the map's absolute file paths, relative to the repo root. */
export function buildTree(files: FileNode[], base: string): BuiltTree {
  const root: DirNode = { type: "dir", name: "", path: "", children: [], fileCount: 0 };
  const dirIndex = new Map<string, DirNode>([["", root]]);
  const leaves: (FileLeaf | null)[] = [];
  for (const f of files) {
    const rel = repoRelative(f.path, base);
    const parts = rel === null ? [] : rel.split("/").filter(Boolean);
    if (rel === null || parts.length === 0) { leaves.push(null); continue; }
    const ancestors: DirNode[] = [root];
    let parent = root;
    let parentPath = "";
    for (let i = 0; i < parts.length - 1; i++) {
      const path = parentPath ? `${parentPath}/${parts[i]}` : parts[i];
      let dir = dirIndex.get(path);
      if (!dir) {
        dir = { type: "dir", name: parts[i], path, children: [], fileCount: 0 };
        dirIndex.set(path, dir);
        parent.children.push(dir);
      }
      ancestors.push(dir);
      parent = dir;
      parentPath = path;
    }
    for (const a of ancestors) a.fileCount++;
    const leaf: FileLeaf = { type: "file", name: parts[parts.length - 1], path: rel, lower: rel.toLowerCase(), file: f };
    parent.children.push(leaf);
    leaves.push(leaf);
  }
  sortTree(root);
  return { root, leaves };
}

function sortTree(dir: DirNode) {
  dir.children.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
  for (const c of dir.children) if (c.type === "dir") sortTree(c);
}

/** Whether two file lists have the same paths in the same order (then the tree built from one fits the other). */
export function samePaths(a: FileNode[], b: FileNode[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && a[i].path !== b[i].path) return false;
  return true;
}

/** A file changed (its recency, the agent on it) but none was added or removed: point the leaves at the new nodes. */
export function refreshLeaves(built: BuiltTree, files: FileNode[]) {
  for (let i = 0; i < files.length; i++) { const leaf = built.leaves[i]; if (leaf && leaf.file !== files[i]) leaf.file = files[i]; }
}

export type TreeFilter = { query: string; touched: Map<string, { edits: number; reads: number }> | null; touchedOnly: boolean };

/** Prune to nodes that match the filter. Returns null when nothing under `dir` matches. */
export function filterTree(dir: DirNode, filter: TreeFilter): DirNode | null {
  const q = filter.query.trim().toLowerCase();
  if (!q && !filter.touchedOnly) return dir;
  const children: TreeChild[] = [];
  for (const c of dir.children) {
    if (c.type === "file") {
      const matchesQuery = !q || c.lower.includes(q);
      const matchesTouched = !filter.touchedOnly || !!filter.touched?.has(c.file.path);
      if (matchesQuery && matchesTouched) children.push(c);
    } else {
      const kept = filterTree(c, filter);
      if (kept) children.push(kept);
    }
  }
  if (children.length === 0) return null;
  return { ...dir, children, fileCount: children.reduce((n, c) => n + (c.type === "file" ? 1 : c.fileCount), 0) };
}

/** One line of the tree as shown: a folder (open or not) or a file, and how deep it sits. */
export type TreeRow = { node: TreeChild; depth: number; open: boolean };

/** The tree as the lines it shows, top to bottom: the children of open folders only (`expanded` null: every folder open). */
export function flattenTree(dir: DirNode, expanded: ReadonlySet<string> | null, depth = 0, out: TreeRow[] = []): TreeRow[] {
  for (const c of dir.children) {
    if (c.type === "file") { out.push({ node: c, depth, open: false }); continue; }
    const open = expanded ? expanded.has(c.path) : true;
    out.push({ node: c, depth, open });
    if (open) flattenTree(c, expanded, depth + 1, out);
  }
  return out;
}
