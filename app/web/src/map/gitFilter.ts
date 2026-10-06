// Owner: git. What the map shows from git (the Files tab's Changes, sidebar/GitPanel.tsx): nothing (the whole map), the
// files not committed, the files not pushed, or what one branch (a worktree, usually an agent's) has that yours doesn't.
// While one is on, those files stay bright with a ring in its colour and their folders open; the rest steps back.
import { useSyncExternalStore } from "react";
import type { GitFileState, GitState } from "@contract";

export type GitFilter = { kind: "uncommitted" } | { kind: "unpushed" } | { kind: "branch"; path: string } | null;

let filter: GitFilter = null;
const listeners = new Set<() => void>();
const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
const get = () => filter;
export function setGitFilter(f: GitFilter) { filter = f; listeners.forEach((l) => l()); }
export const useGitFilter = () => useSyncExternalStore(subscribe, get, get);
export const sameFilter = (a: GitFilter, b: GitFilter) =>
  a === b || (!!a && !!b && a.kind === b.kind && (a.kind !== "branch" || (b.kind === "branch" && a.path === b.path)));

/** The colours of what git says about a file (rings on the map, letters in the list). */
export const GIT_COLOURS = { uncommitted: "#ff9f0a", added: "#30b46c", unpushed: "#0a84ff", branch: "#a35bd6", conflict: "#e5484d" };
export const stateColour = (s: GitFileState) => (s === "added" || s === "untracked" ? GIT_COLOURS.added : s === "conflict" ? GIT_COLOURS.conflict : GIT_COLOURS.uncommitted);
export const STATE_LETTER: Record<GitFileState, string> = { modified: "M", added: "A", deleted: "D", renamed: "R", untracked: "U", conflict: "C" };
export const STATE_WORD: Record<GitFileState, string> = { modified: "Changed", added: "New", deleted: "Deleted", renamed: "Renamed", untracked: "New, not added to git", conflict: "Conflict" };

/** The files a filter shows, by their path relative to the map's root, each with its ring colour. */
export function filterFiles(git: GitState | null, f: GitFilter): Map<string, string> | null {
  if (!git || !f) return null;
  const out = new Map<string, string>();
  if (f.kind === "uncommitted") for (const [p, s] of Object.entries(git.uncommitted)) out.set(p, stateColour(s));
  else if (f.kind === "unpushed") for (const p of git.unpushed ?? []) out.set(p, GIT_COLOURS.unpushed);
  else {
    const w = git.worktrees.find((x) => x.path === f.path);
    if (!w) return out;
    for (const p of w.committed) out.set(p, GIT_COLOURS.branch);
    for (const [p, s] of Object.entries(w.uncommitted)) out.set(p, stateColour(s));
  }
  return out;
}

/** In words, for the pill on the map. */
export function filterName(git: GitState | null, f: GitFilter): string {
  if (!f) return "";
  if (f.kind === "uncommitted") return "Not committed";
  if (f.kind === "unpushed") return "Not pushed";
  return `On ${git?.worktrees.find((w) => w.path === f.path)?.branch ?? "a branch"}`;
}
