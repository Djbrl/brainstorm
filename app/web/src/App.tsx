// Owned by the lead. The shell: the header with where you are (project › thread › step), and the view for that place.
// Each part reads only the slices it shows (useLiveSelector, useNavState), so a live message or a replay cursor move
// re-renders the parts that changed, not the whole app.
import { isReplay, shallowEqual, useLiveActions, useLiveSelector, useLiveStep } from "./lib/live";
import { END, NavProvider, useNavActions, useNavState, useReplayCursor } from "./lib/nav";
import { useThread, type ReplayDetail } from "./lib/thread";
import { displayLabel } from "./follow/format";
import { LinkedLabel } from "./lib/links";
import { SetupView } from "./setup/SetupView";
import { Welcome } from "./map/Welcome";
import { SettingsButton } from "./settings/Settings";
import { useAttentionAlerts } from "./lib/attention";
import { Logo } from "./Logo";
import { track } from "./lib/usage";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import "./boot.css";

// The views (and the graph library the Map needs) load when they're opened. The Map is what almost every visit
// shows, so its chunk starts downloading now, while the app boots, rather than once the project has loaded.
let mapChunk: Promise<typeof import("./map/MapView")> | null = null;
const loadMapView = () => (mapChunk ??= import("./map/MapView").catch((e) => { mapChunk = null; throw e; }));
loadMapView().catch(() => {}); // a failed prefetch is retried when the view mounts
const MapView = lazy(() => loadMapView().then((m) => ({ default: m.MapView })));
const PlacesView = lazy(() => import("./cowork/CoworkView").then((m) => ({ default: m.PlacesView })));

/** Project › Thread › Step: each part takes you back up to it. */
function Crumbs({ project }: { project: string }) {
  const { replay, step } = useNavState();
  const { stopReplay, closeStep, setThreadMode } = useNavActions();
  const sid = replay?.sessionId;
  const title = useLiveSelector((s) => (sid ? s.sessions.find((x) => x.id === sid)?.title : undefined));
  const st = useLiveStep(replay && step ? step : null);
  return (
    <nav className="crumbs" aria-label="Where you are">
      {replay ? <button onClick={stopReplay}>{project}</button> : <span aria-current="page">{project}</span>}
      {replay && <>
        <span className="sep" aria-hidden="true">›</span>
        {step ? <button onClick={closeStep}>{title || "Thread"}</button>
          : <button className="here" aria-current="page" onClick={() => setThreadMode("steps")}>{title || "Thread"}</button>}
      </>}
      {replay && step && <>
        <span className="sep" aria-hidden="true">›</span>
        <span className="here" aria-current="page" title={st && st.sessionId === sid ? displayLabel(st) : undefined}>{st && st.sessionId === sid ? <LinkedLabel text={displayLabel(st)} max={36} /> : "Step"}</span>
      </>}
    </nav>
  );
}

/** Mounted once: the tab title and notifications for threads that need you (on its own, so the shell doesn't re-render with every live change). */
function AttentionAlerts() {
  const { startReplay } = useNavActions();
  useAttentionAlerts((sid) => startReplay(sid, END, { live: true, lens: "map" })); // a notification opens the thread, its Track in the sidebar
  return null;
}

function Shell() {
  useEffect(() => { track("op"); }, []); // one "app opened" for the usage stats (counts nothing in a replay)
  const { reload } = useLiveActions();
  const { lens, replay } = useNavState();
  const { back, stopReplay, selectFile } = useNavActions();
  const replayId = replay?.sessionId ?? null;
  const state = useLiveSelector((s) => ({
    replay: s.replay, preview: s.preview, shared: s.shared, connected: s.connected, setup: s.setup,
    missing: !!replayId && s.sessionsLoaded && !s.sessions.some((x) => x.id === replayId), // a thread this project doesn't have
  }), shallowEqual);
  const [setupOpen, setSetupOpen] = useState(false);

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
          ? <a className="wordmark" href="https://brainstorm-landing.vercel.app" aria-label="Rundown home"><Logo label="Rundown home" /></a>
          : <div className="wordmark"><Logo /></div>}
        <Crumbs project={project} />
        <div className="status">
          {state.preview && (
            <button className="ws-chip" title="Play back a recorded setup run" onClick={() => setSetupOpen(true)}>Setup preview</button>
          )}
          {!state.replay && state.setup?.root && (
            <button className="ws-chip ws-change" title={state.setup.root} onClick={() => setSetupOpen(true)}>
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2.75 6.25V15a1.25 1.25 0 0 0 1.25 1.25h12A1.25 1.25 0 0 0 17.25 15V8A1.25 1.25 0 0 0 16 6.75h-6.2L8.3 4.5a1 1 0 0 0-.83-.45H4A1.25 1.25 0 0 0 2.75 5.3Z" /></svg>
              Change project
            </button>
          )}
          <SettingsButton />
          <span className={`dot ${state.connected ? "live" : ""}`} />
          <span className="status-text">{state.shared ? "Shared replay" : state.replay ? "Recorded demo" : state.connected ? "Live" : "Connecting…"}</span>
        </div>
      </header>
      {state.preview && (
        <div className="preview-banner">
          A recording of Claude Code agents building Rundown, played back. To see your own agents live,{" "}
          <a href="https://github.com/Djbrl/brainstorm#install-claude-code-plugin-preview" target="_blank" rel="noopener">install the plugin</a>.
        </div>
      )}
      {state.shared && (
        <div className="preview-banner">
          A Claude Code session, shared from Rundown on {new Date(state.shared.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}.
          {" "}Press Play to watch it on the map. To follow your own agents,{" "}
          <a href="https://github.com/Djbrl/brainstorm#install-claude-code-plugin-preview" target="_blank" rel="noopener">install Rundown</a>.
        </div>
      )}
      {state.shared && <OpenShared />}
      <LiveFollow />
      {!replay && !state.shared && <Welcome />}
      <main className="view"><Suspense fallback={<Loading />}>{
        replay && state.missing ? <MissingThread onBack={stopReplay} />
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
  const ready = useLiveSelector((s) => (isReplay() ? s.replay : !!s.setup && (!s.setup.root || !!s.map)));
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
  const first = useLiveSelector((s) => s.sessions[0]?.id);
  const { replay } = useNavState();
  const { startReplay } = useNavActions();
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
 * The parts that build the thread are mounted only while they're needed.
 */
function LiveFollow() {
  const { replay } = useNavState();
  const sid = replay?.sessionId;
  const running = useLiveSelector((s) => !!sid && s.sessions.find((x) => x.id === sid)?.status === "running");
  if (!replay) return null;
  if (replay.live) return <FollowNewest sessionId={replay.sessionId} detail={replay.detail} />;
  if (replay.mode === "play" && running) return <FollowAtEnd sessionId={replay.sessionId} detail={replay.detail} />;
  return null;
}

/** Following live: keep the cursor on the newest beat as the thread grows. */
function FollowNewest({ sessionId, detail }: { sessionId: string; detail: ReplayDetail }) {
  const { followLive } = useNavActions();
  const beats = useThread(sessionId, detail)?.beats.length ?? 0;
  useEffect(() => { if (beats) followLive(beats - 1); }, [beats, followLive]);
  return null;
}

/** Replaying a running thread: once the player stops on its last beat, follow it live. */
function FollowAtEnd({ sessionId, detail }: { sessionId: string; detail: ReplayDetail }) {
  const { setReplayLive } = useNavActions();
  const all = useThread(sessionId, detail);
  const last = all ? all.beats.length - 1 : -1;
  const atEnd = useReplayCursor((c) => last >= 0 && c.index >= last && !c.playing);
  useEffect(() => { if (atEnd) setReplayLive(true); }, [atEnd, setReplayLive]);
  return null;
}

export function App() {
  return <NavProvider><AttentionAlerts /><Shell /></NavProvider>;
}
