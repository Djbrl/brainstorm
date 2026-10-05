// Owner: D. A file of the map in the side panel: what it does, its imports, the agent steps that touched it, and Ask.
// Same rules as the step panel (map/panel.ts): Esc, Back or a click outside closes it, no close button. Its link is
// /file/<path from the project root> (after /thread/<id> when a thread is open), so a reload or a shared link opens it
// with the camera on it.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Edge, FileNode, Step } from "@contract";
import { AskBox } from "../ask/AskBox";
import { clock } from "../lib/live";
import { useNav } from "../lib/nav";
import { mapStyle } from "./themes";
import { relTime } from "./MapView";
import { KEEPS_OPEN, useClickAway, useLastShown } from "./panel";
import "./map.css";

const relPath = (p: string, root: string) => (root && p.startsWith(root) ? p.slice(root.length).replace(/^\/+/, "") : p);
const modName = (m: string) => (!m || m === "." ? "root" : m);
const baseName = (p: string) => p.split("/").pop() || p;

const SETTLE_MS = 1800;

function useNow(ms = 20000) {
  const [now, setNow] = useState(clock());
  useEffect(() => { const t = setInterval(() => setNow(clock()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

/**
 * The selected file on the map (a node id, its full path), kept in the link as a path from the project root.
 * A file opened by the link (a reload, Back, Forward) also brings the camera to it; one clicked on the map doesn't move it.
 */
export function useSelectedFile(root: string): [string | null, (path: string | null) => void] {
  const { file, selectFile, setFocusFile } = useNav();
  const full = file && (file.startsWith("/") ? file : root ? `${root.replace(/\/+$/, "")}/${file}` : null);
  const shown = useRef<string | null>(null); // the file the map already shows (selected there)
  const select = useCallback((path: string | null) => {
    shown.current = path;
    const rel = path ? relPath(path, root) : null;
    if (rel !== file) selectFile(rel);
  }, [root, file, selectFile]);
  const mapAt = useRef(0); // when the map first showed: its layout keeps settling for a moment
  if (root && !mapAt.current) mapAt.current = performance.now();
  useEffect(() => {
    const go = full && full !== shown.current;
    shown.current = full ?? null;
    if (!go) return;
    setFocusFile(full);
    // Opened with the page: once the files have settled, center on it again (where it moved to), unless you've moved on.
    const settling = SETTLE_MS - (performance.now() - mapAt.current);
    if (settling <= 0) return;
    const t = setTimeout(() => { if (shown.current === full) setFocusFile(full); }, settling);
    return () => clearTimeout(t);
  }, [full, setFocusFile]);
  return [full ?? null, select];
}

/** Clicks on the map itself are the map's: a file opens that file, empty space closes the panel (MapView). */
const FILE_KEEPS_OPEN = `${KEEPS_OPEN}, canvas`;

export function FilePanel({ file, root, steps, edges, onFocus, onClose }: {
  file?: FileNode; root: string; steps: Record<string, Step[]>; edges: Edge[]; onFocus: (path: string) => void; onClose: () => void;
}) {
  useClickAway(!!file, FILE_KEEPS_OPEN, onClose);
  const shown = useLastShown(file); // while it slides out, it keeps showing the file it had
  return (
    <aside className={`map-panel ${file ? "open" : ""}`} aria-hidden={!file} inert={!file}>
      {shown && <FileDetail file={shown} root={root} steps={steps} edges={edges} onFocus={onFocus} />}
    </aside>
  );
}

function FileDetail({ file, root, steps, edges, onFocus }: {
  file: FileNode; root: string; steps: Record<string, Step[]>; edges: Edge[]; onFocus: (path: string) => void;
}) {
  const now = useNow();
  // Unique: a file can import from the same module in several statements.
  const imports = useMemo(() => [...new Set(edges.filter((e) => e.from === file.path).map((e) => e.to))], [file.path, edges]);
  const usedBy = useMemo(() => [...new Set(edges.filter((e) => e.to === file.path).map((e) => e.from))], [file.path, edges]);
  const touching = useMemo(() => {
    const out: Step[] = [];
    for (const list of Object.values(steps)) for (const s of list) if (s.filePath === file.path) out.push(s);
    return out.sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 6);
  }, [file.path, steps]);

  return (
    <div className="map-panel-inner">
      <h2>{baseName(file.path)}</h2>
      <p className="map-path">{relPath(file.path, root)}</p>
      <p className="map-meta">
        {modName(file.module)} · {file.lines.toLocaleString()} lines · {relTime(file.lastChangedAt, now)}
      </p>
      {file.activeSessionId && <p className="map-live"><i />An agent is editing this file right now</p>}

      <section>
        <h3>What it does</h3>
        {file.summary ? <p className="map-summary">{file.summary}</p> : <p className="map-quiet">Summarizing…</p>}
      </section>

      {(imports.length > 0 || usedBy.length > 0) && (
        <section className="map-deps">
          {imports.length > 0 && (<>
            <h3><i style={{ background: mapStyle().imports }} />Imports</h3>
            <ul>{imports.map((p) => <li key={p}><button onClick={() => onFocus(p)} title={relPath(p, root)}>{baseName(p)}</button></li>)}</ul>
          </>)}
          {usedBy.length > 0 && (<>
            <h3><i style={{ background: mapStyle().usedBy }} />Used by</h3>
            <ul>{usedBy.map((p) => <li key={p}><button onClick={() => onFocus(p)} title={relPath(p, root)}>{baseName(p)}</button></li>)}</ul>
          </>)}
        </section>
      )}

      {touching.length > 0 && (
        <section>
          <h3>Recent agent steps</h3>
          <ul className="map-steps">
            {touching.map((s) => (
              <li key={s.id}>
                <span>{s.label ?? (s.tool ? `${s.tool} ${baseName(file.path)}` : s.kind)}</span>
                <time>{relTime(s.ts, now).replace("changed ", "")}</time>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3>Ask about this file</h3>
        <AskBox key={file.path} context={{ filePath: file.path }} placeholder={`What does ${baseName(file.path)} do?`} />
      </section>
    </div>
  );
}
