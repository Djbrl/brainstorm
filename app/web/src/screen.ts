// What the shell shows, worked out from plain values before anything is drawn (App's Shell renders it):
// the kind of app this is (your own Rundown, a recorded demo, its setup preview, a shared replay) and the screen
// (loading, picking a project, the map, Places...).
import type { Lens } from "./lib/nav";

/** Your own Rundown (live), the hosted recorded demo, the demo's post-deadline preview (it plays back a setup run too),
 *  or a replay someone shared. */
export type Kind = "local" | "demo" | "preview" | "shared";

/** A shared replay is said as one even if its file carries preview extras (shares are made without them). */
export function kindOf(s: { replay: boolean; preview: boolean; shared: boolean }): Kind {
  return s.shared ? "shared" : s.preview ? "preview" : s.replay ? "demo" : "local";
}

export type Screen = "loading" | "setup" | "offline" | "missing" | "places" | "map";

export type ScreenInput = {
  kind: Kind;
  booting: boolean;      // the first load isn't in yet
  picking: boolean;      // the setup checklist is running
  setupOpen: boolean;    // "Change project" was clicked
  noProject: boolean;    // the server answered and has no project yet
  offline: boolean;      // the server is out of reach
  hasMap: boolean;
  thread: boolean;       // a thread is open
  missing: boolean;      // ... one this project doesn't have
  lens: Lens;
};

export function screenOf(s: ScreenInput): Screen {
  // Not while the setup checklist runs: the new project reloads the store, and the checklist must stay where it is.
  if (s.booting && !s.picking) return "loading";
  // Local app: pick a workspace first (and whenever "Change" is clicked). The hosted demo never shows setup, except
  // the post-deadline preview, which plays back a recorded setup run (see lib/preview.ts).
  if ((s.setupOpen && (s.kind === "local" || s.kind === "preview")) || (s.kind === "local" && (s.picking || s.noProject))) return "setup";
  if (s.offline && !s.hasMap) return "offline";
  if (s.thread && s.missing) return "missing";
  if (s.thread && s.lens === "places") return "places";
  return "map";
}
