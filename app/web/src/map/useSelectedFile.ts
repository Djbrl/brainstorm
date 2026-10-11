// The selected file on the map, kept in the link as /file/<path from the project root> (after /thread/<id> when a
// thread is open), so a reload or a shared link opens it with the camera on it. Its details show in the sidebar's
// Files tab (sidebar/FileView.tsx).
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavActions, useNavSelector } from "../lib/nav";

export const relPath = (p: string, root: string) => (root && p.startsWith(root) ? p.slice(root.length).replace(/^\/+/, "") : p);

/**
 * The selected file (a node id, its full path), how to select one (null clears it), and a count of picks: it goes up
 * every time a file is picked (on the map, in a list, by a link), the same file again included, so the sidebar can
 * turn to it. A file opened by the link (a reload, Back, Forward) also brings the camera to it; one clicked on the map
 * doesn't move it.
 */
export function useSelectedFile(root: string): [string | null, (path: string | null) => void, number] {
  const file = useNavSelector((d) => d.file);
  const { selectFile, setFocusFile } = useNavActions();
  const full = file && (file.startsWith("/") ? file : root ? `${root.replace(/\/+$/, "")}/${file}` : null);
  const shown = useRef<string | null>(null); // the file the map already shows (selected there)
  const [picks, setPicks] = useState(0);
  const select = useCallback((path: string | null) => {
    shown.current = path;
    if (path) setPicks((n) => n + 1);
    const rel = path ? relPath(path, root) : null;
    if (rel !== file) selectFile(rel);
  }, [root, file, selectFile]);
  useEffect(() => {
    const go = full && full !== shown.current;
    shown.current = full ?? null;
    if (!go) return;
    setFocusFile(full);
  }, [full, setFocusFile]);
  return [full ?? null, select, picks];
}
