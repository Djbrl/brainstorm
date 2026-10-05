// Owned by the lead. The shell: the header with where you are (project › thread › step), and the view for that place.
import { isReplay, useLive } from "./lib/live";
import { END, NavProvider, threadLens, useNav } from "./lib/nav";
import { useThread } from "./lib/thread";
import { displayLabel } from "./follow/format";
import { SetupView } from "./setup/SetupView";
import { Welcome } from "./map/Welcome";
import { SettingsButton } from "./settings/Settings";
import { useAttentionAlerts } from "./lib/attention";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import "./boot.css";

// The views (and the graph library the Map needs) load when they're opened.
const MapView = lazy(() => import("./map/MapView").then((m) => ({ default: m.MapView })));
const TrackView = lazy(() => import("./tasks/TrackView").then((m) => ({ default: m.TrackView })));
const PlacesView = lazy(() => import("./cowork/CoworkView").then((m) => ({ default: m.PlacesView })));

/** Project › Thread › Step: each part takes you back up to it. */
function Crumbs({ project }: { project: string }) {
  const { state } = useLive();
  const { replay, step, stopReplay, closeStep, setThreadMode } = useNav();
  const session = replay ? state.sessions.find((s) => s.id === replay.sessionId) : undefined;
  const st = replay && step ? state.steps[replay.sessionId]?.find((s) => s.id === step) : undefined;
  return (
    <nav className="crumbs" aria-label="Where you are">
      {replay ? <button onClick={stopReplay}>{project}</button> : <span aria-current="page">{project}</span>}
      {replay && <>
        <span className="sep" aria-hidden="true">›</span>
        {step ? <button onClick={closeStep}>{session?.title || "Thread"}</button>
          : <button className="here" aria-current="page" onClick={() => setThreadMode("steps")}>{session?.title || "Thread"}</button>}
      </>}
      {replay && step && <>
        <span className="sep" aria-hidden="true">›</span>
        <span className="here" aria-current="page">{st ? displayLabel(st) : "Step"}</span>
      </>}
    </nav>
  );
}

function Shell() {
  const { state, reload } = useLive();
  const [setupOpen, setSetupOpen] = useState(false);
  const { lens, replay, back, startReplay, stopReplay, selectFile } = useNav();
  useAttentionAlerts((sid) => startReplay(sid, END, { live: true, lens: threadLens() })); // a notification opens the thread's Track

  // Esc closes the innermost thing first: a popover (it handles Esc itself and marks it handled), then a panel (step,
  // file), then the player, then the thread (not while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== "Escape" || e.defaultPrevented || (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable))) return;
      back();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [back]);

  // First load: a quiet "Loading" until we know whether to show setup or the map, rather than a blank page or a flash of either.
  const booting = useBooting();
  if (booting) return <Loading />;

  // Local app: pick a workspace first (and whenever "Change" is clicked). The hosted demo never shows setup,
  // except the post-deadline preview, which plays back a recorded setup run (see lib/preview.ts).
  if ((setupOpen && (!state.replay || state.preview)) || (!state.replay && state.setup && !state.setup.root)) {
    // Another project: whatever was open (a thread, a step, a file) belonged to the old one.
    return <SetupView onDone={() => { setSetupOpen(false); stopReplay(); selectFile(null); reload(); }} onCancel={state.setup?.root || state.preview ? () => setSetupOpen(false) : undefined} />;
  }
  const project = state.setup?.name || "brainstorm";

  return (
    <div className={`shell ${state.preview || state.shared ? "has-banner" : ""}`}>
      <header className="topbar">
        {isReplay()
          ? <a className="wordmark" href="https://brainstorm-landing.vercel.app" aria-label="Brainstorm home">Brainstorm</a>
          : <div className="wordmark">Brainstorm</div>}
        <Crumbs project={project} />
        <div className="status">
          {state.preview && (
            <button className="ws-chip" title="Play back a recorded setup run" onClick={() => setSetupOpen(true)}>Setup preview</button>
          )}
          {!state.replay && state.setup?.root && (
            <button className="ws-chip" title={state.setup.root} onClick={() => setSetupOpen(true)}>Change project</button>
          )}
          <SettingsButton />
          <span className={`dot ${state.connected ? "live" : ""}`} />
          {state.shared ? "Shared replay" : state.replay ? "Recorded demo" : state.connected ? "Live" : "Connecting…"}
        </div>
      </header>
      {state.preview && (
        <div className="preview-banner">
          A recording of Claude Code agents building Brainstorm, played back. To see your own agents live,{" "}
          <a href="https://github.com/Djbrl/brainstorm#install-claude-code-plugin-preview" target="_blank" rel="noopener">install the plugin</a>.
        </div>
      )}
      {state.shared && (
        <div className="preview-banner">
          A Claude Code session, shared from Brainstorm on {new Date(state.shared.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}.
          {" "}Press Play to watch it on the map. To follow your own agents,{" "}
          <a href="https://github.com/Djbrl/brainstorm#install-claude-code-plugin-preview" target="_blank" rel="noopener">install Brainstorm</a>.
        </div>
      )}
      {state.shared && <OpenShared />}
      <LiveFollow />
      {!replay && !state.shared && <Welcome />}
      <main className="view"><Suspense fallback={<Loading />}>{
        replay && state.sessionsLoaded && !state.sessions.some((s) => s.id === replay.sessionId) ? <MissingThread onBack={stopReplay} />
          : replay && lens === "track" && !state.replay ? <TrackView />
          : replay && lens === "places" ? <PlacesView />
          : <MapView />
      }</Suspense></main>
    </div>
  );
}

/**
 * Still loading: the workspace status (setup or map?) and, once there's a project, its map; a recording, until it's in.
 * Gives up after a while so a server that doesn't answer shows the app (and its "Connecting…") instead.
 */
function useBooting(): boolean {
  const { state } = useLive();
  const ready = isReplay() ? state.replay : !!state.setup && (!state.setup.root || !!state.map);
  const [waited, setWaited] = useState(false);
  useEffect(() => { if (ready) return; const t = setTimeout(() => setWaited(true), 8000); return () => clearTimeout(t); }, [ready]);
  return !ready && !waited;
}

/** A link to a thread this project doesn't have: another project's, a deleted one, or a typo. */
function MissingThread({ onBack }: { onBack: () => void }) {
  return (
    <div className="boot missing" role="status">
      <h2>This thread isn't in this project</h2>
      <p>It may belong to another project, or it was deleted.</p>
      <button className="next-cta" onClick={onBack}>Back to the project</button>
    </div>
  );
}

function Loading() {
  return <div className="boot" role="status" aria-live="polite"><p>Loading your project…</p></div>;
}

/** A shared replay holds one thread: it opens on that thread's footprint (unless its link names a place). */
function OpenShared() {
  const { state } = useLive();
  const { replay, startReplay } = useNav();
  const first = state.sessions[0]?.id;
  const done = useRef(false);
  useEffect(() => {
    if (!first || done.current) return;
    done.current = true;
    if (!replay) startReplay(first, 0);
  }, [first, replay, startReplay]);
  return null;
}

/**
 * A thread you chose to follow live stays on its newest step; a replay that reaches the end of a running thread
 * starts following it. Nothing opens or plays by itself: running threads show as moving dots until you click one.
 */
function LiveFollow() {
  const { state } = useLive();
  const { replay, followLive, setReplayLive } = useNav();
  const thread = useThread(replay?.live ? replay.sessionId : null, replay?.detail ?? "light");
  const beats = thread?.beats.length ?? 0;
  useEffect(() => { if (replay?.live && beats) followLive(beats - 1); }, [replay?.live, beats, followLive]);
  const running = state.sessions.find((s) => s.id === replay?.sessionId)?.status === "running";
  const all = useThread(replay && replay.mode === "play" && !replay.live && running ? replay.sessionId : null, replay?.detail ?? "light");
  useEffect(() => {
    if (replay && replay.mode === "play" && !replay.live && running && all && replay.index >= all.beats.length - 1 && !replay.playing) setReplayLive(true);
  }, [replay, running, all, setReplayLive]);
  return null;
}

export function App() {
  return <NavProvider><Shell /></NavProvider>;
}
