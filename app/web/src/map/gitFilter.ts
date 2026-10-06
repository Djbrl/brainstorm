// Owner: git. The dock's "Show git" switch: rings on the files git says something about, over the map as it is. Your
// checkout's files not committed (orange, green when new) and those committed but not pushed (blue); with a thread
// open that works in its own checkout (a worktree, usually an agent's branch), that branch's instead: what it
// committed that yours doesn't have (purple) and what it hasn't committed. Remembered per browser.
//
// Hidden for now (6 Oct): the person found git a step too far for the map today and may come back to it. GIT_SHOWN
// turns it all back on (the switch, the rings, a file's git line); the server keeps reading git (/api/git, ws "git").
import { useSyncExternalStore } from "react";
import type { GitFileState, GitState, GitWorktree } from "@contract";

export const GIT_SHOWN = false;

const KEY = "brainstorm-map-git";
let on = (() => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } })();
const listeners = new Set<() => void>();
const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
const get = () => GIT_SHOWN && on;   // a switch left on before it was hidden draws nothing
export function setShowGit(v: boolean) {
  if (v === on) return;
  on = v;
  try { localStorage.setItem(KEY, v ? "1" : "0"); } catch { /* not remembered, still applied */ }
  listeners.forEach((l) => l());
}
export const useShowGit = () => useSyncExternalStore(subscribe, get, get);

/** The colours of what git says about a file (its ring on the map). */
export const GIT_COLOURS = { uncommitted: "#ff9f0a", added: "#30b46c", unpushed: "#0a84ff", branch: "#a35bd6", conflict: "#e5484d" };
const stateColour = (s: GitFileState) => (s === "added" || s === "untracked" ? GIT_COLOURS.added : s === "conflict" ? GIT_COLOURS.conflict : GIT_COLOURS.uncommitted);
const STATE_WORD: Record<GitFileState, string> = { modified: "Changed, not committed", added: "New, not committed", deleted: "Deleted, not committed", renamed: "Renamed, not committed", untracked: "New, not added to git", conflict: "Conflict" };

/** The checkout a thread works in, when it isn't yours. */
export const worktreeOf = (git: GitState | null, sessionId: string | null | undefined): GitWorktree | null =>
  (sessionId && git?.worktrees.find((w) => w.threads.includes(sessionId))) || null;

/** The files the switch rings, by their path relative to the map's root, each with its colour. */
export function gitFiles(git: GitState | null, wt: GitWorktree | null): Map<string, string> {
  const out = new Map<string, string>();
  if (!git) return out;
  if (wt) {
    for (const p of wt.committed) out.set(p, GIT_COLOURS.branch);
    for (const [p, s] of Object.entries(wt.uncommitted)) out.set(p, stateColour(s));
    return out;
  }
  for (const p of git.unpushed ?? []) out.set(p, GIT_COLOURS.unpushed);
  for (const [p, s] of Object.entries(git.uncommitted)) out.set(p, stateColour(s));   // not committed wins over not pushed
  return out;
}

/** What git says about one file, in words (the file's details in the sidebar). */
export function gitWord(git: GitState | null, rel: string): { word: string; colour: string } | null {
  if (!GIT_SHOWN || !git) return null;
  const s = git.uncommitted[rel];
  if (s) return { word: STATE_WORD[s], colour: stateColour(s) };
  if (git.unpushed?.includes(rel)) return { word: "Committed, not pushed", colour: GIT_COLOURS.unpushed };
  return null;
}

/** The switch's tooltip: where things stand, and what the colours mean (the map has no legend). */
export function gitSummary(git: GitState | null, wt: GitWorktree | null): string {
  if (!git) return "This project isn't in a git repository";
  const n = (k: number, one: string, many = one + "s") => `${k.toLocaleString()} ${k === 1 ? one : many}`;
  if (wt) {
    const u = Object.keys(wt.uncommitted).length;
    return [`This thread works on ${wt.branch}`,
      wt.merged ? "In your branch" : `Purple: ${n(wt.committed.length, "file")} it committed that your branch doesn't have`,
      u ? `Orange: ${n(u, "file")} not committed (green when new)` : "Everything committed"].join("\n");
  }
  const u = Object.keys(git.uncommitted).length, p = git.unpushed?.length ?? 0;
  return [git.branch ?? "No branch (detached)",
    u ? `Orange: ${n(u, "file")} not committed (green when new)` : "Everything committed",
    git.upstream ? (p ? `Blue: ${n(p, "file")} committed, not pushed (${n(git.ahead, "commit")})` : `Up to date with ${git.upstream}`) : "No upstream branch: nothing pushed yet"].join("\n");
}
