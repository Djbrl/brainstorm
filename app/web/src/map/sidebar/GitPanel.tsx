// Owner: git. The Files tab's Changes: where the project stands in git (its branch, what isn't committed, what isn't
// pushed) and every other checkout of the repo (worktrees: usually an agent's branch), with the threads working there
// and whether it's in your branch yet. Each part shows its files on the map when you click it (gitFilter.ts); a file
// opens like any other.
import { useMemo, useState } from "react";
import type { GitFileState, GitState, GitWorktree, ProjectMap, Session } from "@contract";
import { sameFilter, setGitFilter, STATE_LETTER, STATE_WORD, stateColour, GIT_COLOURS, useGitFilter, type GitFilter } from "../gitFilter";

const SHOWN = 40;   // files listed per part before "Show all"

export function GitPanel({ git, map, sessions, onFocusFile }: {
  git: GitState | null; map: ProjectMap | null; sessions: Session[]; onFocusFile: (path: string) => void;
}) {
  const filter = useGitFilter();
  const onMap = useMemo(() => new Set(map?.files.map((f) => f.path)), [map?.files]);
  if (!git) return <p className="sidebar-empty">This project isn't in a git repository, or git isn't installed.</p>;
  const root = git.root.replace(/\/+$/, "");
  const abs = (rel: string) => `${root}/${rel}`;
  const uncommitted = Object.entries(git.uncommitted);
  const toggle = (f: GitFilter) => setGitFilter(sameFilter(filter, f) ? null : f);
  const title = (id: string) => sessions.find((s) => s.id === id)?.title || "A thread";
  const pushLine = git.upstream
    ? git.ahead || git.behind
      ? [git.ahead && `${git.ahead.toLocaleString()} ${git.ahead === 1 ? "commit" : "commits"} to push`, git.behind && `${git.behind} to pull`].filter(Boolean).join(" · ")
      : `Up to date with ${git.upstream}`
    : "No upstream branch: nothing has been pushed";

  return (
    <div className="git">
      <div className="git-head">
        <b>{git.branch ?? "No branch (detached)"}</b>
        <span>{pushLine}</span>
      </div>

      <Part name="Not committed" count={uncommitted.length} empty="Everything is committed." colour={GIT_COLOURS.uncommitted}
        on={sameFilter(filter, { kind: "uncommitted" })} onToggle={() => toggle({ kind: "uncommitted" })}>
        <Files items={uncommitted.map(([p, s]) => ({ rel: p, state: s }))} abs={abs} onMap={onMap} onFocusFile={onFocusFile} />
      </Part>

      {git.unpushed && (
        <Part name="Not pushed" count={git.unpushed.length} empty="Everything is pushed." colour={GIT_COLOURS.unpushed}
          note={git.ahead ? `In ${git.ahead.toLocaleString()} ${git.ahead === 1 ? "commit" : "commits"}` : undefined}
          on={sameFilter(filter, { kind: "unpushed" })} onToggle={() => toggle({ kind: "unpushed" })}>
          <Files items={git.unpushed.map((p) => ({ rel: p }))} abs={abs} onMap={onMap} onFocusFile={onFocusFile} />
        </Part>
      )}

      {git.worktrees.length > 0 && <h4 className="git-sub">Other checkouts</h4>}
      {git.worktrees.map((w) => (
        <Worktree key={w.path} w={w} title={title} abs={abs} onMap={onMap} onFocusFile={onFocusFile}
          on={sameFilter(filter, { kind: "branch", path: w.path })} onToggle={() => toggle({ kind: "branch", path: w.path })} />
      ))}
    </div>
  );
}

/** One part (not committed, not pushed, a branch): its header shows its files on the map, its files open below. */
function Part({ name, count, note, empty, colour, on, onToggle, children }: {
  name: string; count: number; note?: string; empty: string; colour: string; on: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(count > 0 && count <= 12);
  return (
    <section className={`git-part${on ? " on" : ""}`}>
      <div className="git-part-head">
        <button className="git-open" aria-expanded={open} onClick={() => setOpen((o) => !o)} disabled={!count}>
          <span className="git-caret" aria-hidden="true">{count ? (open ? "▾" : "▸") : ""}</span>
          <span className="git-name">{name}</span>
          <span className="git-count">{count.toLocaleString()} {count === 1 ? "file" : "files"}</span>
        </button>
        {count > 0 && (
          <button className="git-show" aria-pressed={on} onClick={onToggle} style={{ ["--ring" as string]: colour }}>
            {on ? "On the map" : "Show on map"}
          </button>
        )}
      </div>
      {note && <p className="git-note">{note}</p>}
      {!count && <p className="git-note">{empty}</p>}
      {open && count > 0 && children}
    </section>
  );
}

function Worktree({ w, title, abs, onMap, onFocusFile, on, onToggle }: {
  w: GitWorktree; title: (id: string) => string; abs: (rel: string) => string; onMap: Set<string>; onFocusFile: (p: string) => void; on: boolean; onToggle: () => void;
}) {
  const uncommitted = Object.entries(w.uncommitted);
  const items = [...w.committed.map((p) => ({ rel: p, branch: true })), ...uncommitted.map(([p, s]) => ({ rel: p, state: s }))];
  const state = w.merged ? "In your branch" : `${w.ahead.toLocaleString()} ${w.ahead === 1 ? "commit" : "commits"} not in your branch`;
  const parts = [state, uncommitted.length ? `${uncommitted.length} not committed` : null].filter(Boolean).join(" · ");
  return (
    <Part name={w.branch} count={items.length} empty={w.merged ? "Merged, nothing left to commit." : "Nothing changed."} colour={GIT_COLOURS.branch}
      note={[parts, w.threads.length ? `${w.threads.length === 1 ? "Thread" : "Threads"}: ${w.threads.slice(0, 2).map(title).join(", ")}` : null].filter(Boolean).join(" · ")}
      on={on} onToggle={onToggle}>
      <Files items={items} abs={abs} onMap={onMap} onFocusFile={onFocusFile} />
    </Part>
  );
}

function Files({ items, abs, onMap, onFocusFile }: {
  items: { rel: string; state?: GitFileState; branch?: boolean }[]; abs: (rel: string) => string; onMap: Set<string>; onFocusFile: (p: string) => void;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, SHOWN);
  return (
    <ul className="git-files">
      {shown.map(({ rel, state, branch }) => {
        const there = onMap.has(abs(rel));
        const name = rel.split("/").pop() || rel, dir = rel.slice(0, rel.length - name.length - 1);
        const letter = branch ? "B" : state ? STATE_LETTER[state] : "";
        const colour = branch ? GIT_COLOURS.branch : state ? stateColour(state) : GIT_COLOURS.unpushed;
        const why = branch ? "Committed on this branch" : state ? STATE_WORD[state] : "In a commit not pushed yet";
        return (
          <li key={rel + (branch ? ":b" : "")}>
            <button disabled={!there} onClick={() => onFocusFile(abs(rel))} title={`${rel}\n${why}${there ? "" : "\nNot on the map"}`}>
              {letter && <span className="git-letter" style={{ color: colour }}>{letter}</span>}
              <span className="git-file">{name}</span>
              {dir && <span className="git-dir">{dir}</span>}
            </button>
          </li>
        );
      })}
      {!all && items.length > SHOWN && <li><button className="git-more" onClick={() => setAll(true)}>Show all {items.length.toLocaleString()}</button></li>}
    </ul>
  );
}
