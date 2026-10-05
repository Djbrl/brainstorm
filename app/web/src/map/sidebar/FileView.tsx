// The selected file, in the sidebar's Files tab in place of the tree: what it does, its imports and the files that use
// it, the agent steps that touched it, and Ask. "All files" at the top (or Esc) goes back to the tree and lets go of
// the file on the map. Picking a file anywhere (the map, the tree, a link, a step's file) opens it here.
import { useEffect, useMemo, useState } from "react";
import type { Edge, FileNode, Step } from "@contract";
import { AskBox } from "../../ask/AskBox";
import { clock, useLiveSelector } from "../../lib/live";
import { missingSummary } from "../../lib/ai";
import { mapStyle } from "../themes";
import { relPath } from "../useSelectedFile";

const modName = (m: string) => (!m || m === "." ? "root" : m);
const baseName = (p: string) => p.split("/").pop() || p;

/** "changed just now" (under 45 s), "changed 5 min ago", "changed 3 h ago", "changed 2 days ago" (rounded). */
function changedAgo(iso: string | undefined, now: number): string {
  if (!iso) return "not changed recently";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 45) return "changed just now";
  if (s < 3600) return `changed ${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `changed ${Math.round(s / 3600)} h ago`;
  return `changed ${Math.round(s / 86400)} days ago`;
}

function useNow(ms = 20000) {
  const [now, setNow] = useState(clock());
  useEffect(() => { const t = setInterval(() => setNow(clock()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

/** "‹ All files": above the file, outside its scroll (MapSidebar puts it under the tabs). */
export function FileViewBack({ onBack }: { onBack: () => void }) {
  return (
    <div className="file-view-bar">
      <button className="file-view-back" onClick={onBack} title="Back to all files (Esc)">
        <i aria-hidden="true">‹</i>All files
      </button>
    </div>
  );
}

export function FileView({ file, root, edges, onFocus }: {
  file: FileNode; root: string; edges: Edge[]; onFocus: (path: string) => void;
}) {
  const now = useNow();
  const setup = useLiveSelector((s) => s.setup);
  const steps = useLiveSelector((s) => s.steps);
  // Unique: a file can import from the same module in several statements.
  const imports = useMemo(() => [...new Set(edges.filter((e) => e.from === file.path).map((e) => e.to))], [file.path, edges]);
  const usedBy = useMemo(() => [...new Set(edges.filter((e) => e.to === file.path).map((e) => e.from))], [file.path, edges]);
  const touching = useMemo(() => {
    const out: Step[] = [];
    for (const list of Object.values(steps)) for (const s of list) if (s.filePath === file.path) out.push(s);
    return out.sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 6);
  }, [file.path, steps]);
  const rel = relPath(file.path, root);

  return (
    <div className="file-view">
      <h2 title={baseName(file.path)}>{baseName(file.path)}</h2>
      <p className="file-view-path" title={rel}>{`\u200e${rel}\u200e`}</p>
      <p className="file-view-meta">
        {modName(file.module)} · {file.lines.toLocaleString()} lines · {changedAgo(file.lastChangedAt, now)}
      </p>
      {file.activeSessionId && <p className="file-view-live"><i />An agent is editing this file right now</p>}

      <section>
        <h3>What it does</h3>
        {file.summary ? <p className="file-view-summary">{file.summary}</p> : <p className="file-view-quiet">{missingSummary(setup)}</p>}
      </section>

      {imports.length > 0 && <Deps title="Imports" color={mapStyle().imports} paths={imports} root={root} onFocus={onFocus} />}
      {usedBy.length > 0 && <Deps title="Used by" color={mapStyle().usedBy} paths={usedBy} root={root} onFocus={onFocus} />}

      {touching.length > 0 && (
        <section>
          <h3>Recent agent steps</h3>
          <ul className="file-view-steps">
            {touching.map((s) => (
              <li key={s.id}>
                <span>{s.label ?? (s.tool ? `${s.tool} ${baseName(file.path)}` : s.kind)}</span>
                <time>{changedAgo(s.ts, now).replace("changed ", "")}</time>
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

function Deps({ title, color, paths, root, onFocus }: { title: string; color: string; paths: string[]; root: string; onFocus: (path: string) => void }) {
  return (
    <section className="file-view-deps">
      <h3><i style={{ background: color }} />{title}</h3>
      <ul>{paths.map((p) => <li key={p}><button onClick={() => onFocus(p)} title={relPath(p, root)}>{baseName(p)}</button></li>)}</ul>
    </section>
  );
}
