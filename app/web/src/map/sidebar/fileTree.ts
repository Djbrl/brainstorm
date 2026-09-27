// Owner: sidebar agent. Pure folder-tree helpers for the Files tab: build once from the map,
// then prune for search / "touched by this thread" without touching the original tree.
import type { FileNode } from "@contract";
import { repoRelative } from "../../lib/paths";

export type FileLeaf = { type: "file"; name: string; path: string; file: FileNode };
export type DirNode = { type: "dir"; name: string; path: string; children: TreeChild[]; fileCount: number };
export type TreeChild = DirNode | FileLeaf;

/** Build the folder tree once from the map's absolute file paths, relative to the repo root. */
export function buildTree(files: FileNode[], base: string): DirNode {
  const root: DirNode = { type: "dir", name: "", path: "", children: [], fileCount: 0 };
  const dirIndex = new Map<string, DirNode>([["", root]]);
  for (const f of files) {
    const rel = repoRelative(f.path, base);
    if (rel === null) continue;
    const parts = rel.split("/").filter(Boolean);
    if (parts.length === 0) continue;
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
    parent.children.push({ type: "file", name: parts[parts.length - 1], path: rel, file: f });
  }
  sortTree(root);
  return root;
}

function sortTree(dir: DirNode) {
  dir.children.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
  for (const c of dir.children) if (c.type === "dir") sortTree(c);
}

export type TreeFilter = { query: string; touched: Map<string, { edits: number; reads: number }> | null; touchedOnly: boolean };

/** Prune to nodes that match the filter. Returns null when nothing under `dir` matches. */
export function filterTree(dir: DirNode, filter: TreeFilter): DirNode | null {
  const q = filter.query.trim().toLowerCase();
  if (!q && !filter.touchedOnly) return dir;
  const children: TreeChild[] = [];
  for (const c of dir.children) {
    if (c.type === "file") {
      const matchesQuery = !q || c.path.toLowerCase().includes(q);
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

/** Every directory path present in an already-filtered tree, so matches can be force-expanded. */
export function collectDirPaths(dir: DirNode, out: Set<string> = new Set()): Set<string> {
  out.add(dir.path);
  for (const c of dir.children) if (c.type === "dir") collectDirPaths(c, out);
  return out;
}
