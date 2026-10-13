// The shell: the header with where you are (project › thread › step), and the view for that place.
// Each part reads only the slices it shows (useLiveSelector, useNavState), so a live message or a replay cursor move
// re-renders the parts that changed, not the whole app.
import { DEMO, isRecording, shallowEqual, useLiveActions, useLiveSelector, useHarness, useLiveStep } from "./lib/live";
import { harnessName } from "./lib/harness";
import { GITHUB_URL, LANDING_URL } from "./lib/urls";
import { END, NavProvider, useNavActions, useNavState } from "./lib/nav";
import { displayLabel } from "./step/format";
import { LinkedLabel } from "./lib/links";
import { SetupView } from "./setup/SetupView";
import { Welcome } from "./map/Welcome";
import { UsageAsk } from "./map/UsageAsk";
import { Tour } from "./map/tour/Tour";
import { useTour } from "./lib/tour";
import { SettingsButton } from "./settings/Settings";
import { Crashed, Offline, OfflineBanner, useOffline } from "./Trouble";
import { useAttentionAlerts } from "./lib/attention";
import { Logo } from "./Logo";
import { track } from "./lib/usage";
import { ThreadBar } from "./switch/ThreadBar";
import { Elsewhere } from "./switch/Elsewhere";
import { Keys } from "./switch/Keys";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { keyRules, useShortcut } from "./switch/shortcuts";
import { LiveFollow } from "./LiveFollow";
import { kindOf, screenOf } from "./screen";
import "./boot.css";

// The views (and the graph library the Map needs) load when they're opened. The Map is what almost every visit
// shows, so its chunk starts downloading now, while the app boots, rather than once the project has loaded.
let mapChunk: Promise<typeof import("./map/MapView")> | null = null;
const loadMapView = () => (mapChunk ??= import("./map/MapView").catch((e) => { mapChunk = null; throw e; }));
loadMapView().catch(() => {}); // a failed prefetch is retried when the view mounts
const MapView = lazy(() => loadMapView().then((m) => ({ default: m.MapView })));
const PlacesView = lazy(() => import("./places/CoworkView").then((m) => ({ default: m.PlacesView })));

/** Project › Thread › Step: each part takes you back up to it. */
function Crumbs({ project }: { project: string }) {
  const { thread, step } = useNavState();
  const { stopReplay, closeStep, setThreadMode } = useNavActions();
  const sid = thread?.sessionId;
  const title = useLiveSelector((s) => (sid ? s.sessions.find((x) => x.id === sid)?.title : undefined));
  const codex = useHarness(sid) === "codex";
  const st = useLiveStep(thread && step ? step : null);
  return (
    <nav className="crumbs" aria-label="Where you are">
      {/* No project name (the server out of reach): no empty crumb. */}
      {project && (thread ? <button onClick={stopReplay}>{project}</button> : <span aria-current="page">{project}</span>)}
      {thread && <>
        {project && <span className="sep" aria-hidden="true">›</span>}
        {step ? <button onClick={closeStep}>{title || "Thread"}</button>
          : <button className="here" aria-current="page" onClick={() => setThreadMode("steps")}>{title || "Thread"}</button>}
        {codex && <span className="crumb-harness" title="This thread ran in Codex">Codex</span>}
      </>}
      {thread && step && <>
        <span className="sep" aria-hidden="true">›</span>
        <span className="here" aria-current="page" title={st && st.sessionId === sid ? displayLabel(st) : undefined}>{st && st.sessionId === sid ? <LinkedLabel text={displayLabel(st)} max={36} /> : "Step"}</span>
      </>}
    </nav>
  );
}

/**
 * The hosted demo opens on its thread: its steps in the sidebar and what it touched on the map, once, when the
 * recording is in and no link names another thread. A click on a step opens it; Space or the welcome card plays it.
 */
function DemoOpen() {
  const { thread } = useNavState();
  const { startReplay } = useNavActions();
  const sessions = useLiveSelector((s) => s.sessions);
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !sessions.length) return;
    done.current = true;
    if (thread) return;
    const latest = [...sessions].sort((a, b) => b.lastEventAt.localeCompare(a.lastEventAt))[0];
    startReplay(latest.id, END);
  }, [sessions, thread, startReplay]);
  return null;
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
  const { lens, thread, file, step, focusFile } = useNavState();
  const { back, stopReplay, selectFile, setFocusFile } = useNavActions();
  const replayId = thread?.sessionId ?? null;
  const state = useLiveSelector((s) => ({
    replay: s.replay, preview: s.preview, shared: s.shared, connected: s.connected, setup: s.setup,
    sharedBy: s.shared ? s.sessions[0]?.harness ?? "claude" : null, // a shared replay holds one thread
    missing: !!replayId && s.sessionsLoaded && !s.sessions.some((x) => x.id === replayId), // a thread this project doesn't have
    hasMap: !!s.map,
  }), shallowEqual);
  const [setupOpen, setSetupOpen] = useState(false);
  const [picking, setPicking] = useState(false); // the setup checklist is running: it stays up until "Open Rundown"
  const [finding, setFinding] = useState(false); // Find a thread (⌘K)
  const [help, setHelp] = useState(false);       // the keyboard shortcuts (?)
  // Picking a project is a screen of its own: the browser's back (and Esc, and its Back link) return from it.
  const openSetup = () => { try { history.pushState({ ...(history.state ?? {}), rundownSetup: true }, ""); } catch { /* still opens */ } setSetupOpen(true); };
  // Picking stops too: a checklist left behind (its screen went away under it) mustn't keep the picker up.
  const closeSetup = () => { setPicking(false); if (history.state?.rundownSetup) history.back(); else setSetupOpen(false); };
  useEffect(() => {
    if (!setupOpen) return;
    const onPop = () => { setSetupOpen(false); setPicking(false); };
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, [setupOpen]);

  // Esc closes the innermost thing first: a popover (it handles Esc itself and marks it handled), then a panel (step,
  // file), then the player, then the thread (not while typing).
  useShortcut("back", (e) => { if (e && (e.defaultPrevented || keyRules.inField(e.target))) return false; back(); });

  // First load: a quiet "Loading" until we know whether to show setup or the map, rather than a blank page or a flash of either.
  const booting = useBooting();
  const offline = useOffline();
  const kind = kindOf({ replay: state.replay, preview: state.preview, shared: !!state.shared });
  const screen = screenOf({
    kind, booting, picking, setupOpen, noProject: !!state.setup && !state.setup.root, offline, hasMap: state.hasMap,
    thread: !!thread, missing: state.missing, lens,
  });
  const local = kind === "local";
  // The hosted demo shows the thread bar and the keys as your own Rundown does (it's the same app, playing a recording).
  const board = local || (DEMO && kind === "preview");

  if (screen === "loading") return <Loading />;
  if (screen === "setup") {
    // Another project: whatever was open (a thread, a step, a file) belonged to the old one.
    return <SetupView onDone={() => {
      if (history.state?.rundownSetup) try { history.replaceState({ ...history.state, rundownSetup: false }, ""); } catch { /* fine */ }
      setSetupOpen(false); setPicking(false); stopReplay(); selectFile(null); reload();
    }} onPicking={setPicking} onCancel={state.setup?.root || kind === "preview" ? closeSetup : undefined} />;
  }
  const project = state.setup?.name || "";   // none yet (the server out of reach): no name rather than a made-up one

  // The logo: home, the project as it opens (no thread, file or step), as if Esc were pressed until nothing is left to
  // close; already there, the page loads again.
  const goHome = () => {
    if (!thread && !file && !step && !focusFile && lens === "map") { location.reload(); return; }
    stopReplay(); selectFile(null); setFocusFile(null);
  };

  return (
    <div className={`shell ${kind === "preview" || kind === "shared" ? "has-banner" : ""}`}>
      <header className="topbar">
        {isRecording()
          ? <a className="wordmark" href={LANDING_URL} aria-label="Rundown home"><Logo label="Rundown home" /></a>
          : <button className="wordmark" onClick={goHome} aria-label="Home" title="Home"><Logo /></button>}
        {!local ? <Crumbs project={project || (kind === "shared" ? "The whole map" : "")} /> : <div className="topbar-space" />}
        <div className="status">
          {local && <Elsewhere />}
          {DEMO && kind === "preview" && (
            <button className="ws-chip" title="Play back a recorded setup run" onClick={openSetup}>Setup preview</button>
          )}
          {local && state.setup?.root && (
            <button className="ws-chip ws-change" title={state.setup.root} onClick={openSetup}>Change project</button>
          )}
          <SettingsButton />
          {/* No "Live" pill: being live is the normal state. Only what isn't is said: a replay, or the server out of reach. */}
          {(!local || !state.connected) && (
            <>
              <span className="dot" />
              <span className="status-text">{kind === "shared" ? "Shared replay" : !local ? "Recorded demo" : "Connecting…"}</span>
            </>
          )}
        </div>
      </header>
      {/* The hosted demo only (a demo build). */}
      {DEMO && kind === "preview" && (
        <div className="preview-banner">
          A recording of a real Claude Code thread, played back. To see your own agents live,{" "}
          <a href={`${GITHUB_URL}#install-claude-code-plugin-preview`} target="_blank" rel="noopener">install the plugin</a>.
        </div>
      )}
      {state.shared && (
        <div className="preview-banner">
          A {harnessName(state.sharedBy ?? "claude")} session, shared from Rundown on {new Date(state.shared.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}.
          {" "}Press Play to watch it on the map. To follow your own agents,{" "}
          <a href={`${GITHUB_URL}#install-claude-code-plugin-preview`} target="_blank" rel="noopener">install Rundown</a>.
        </div>
      )}
      {offline && state.hasMap && <OfflineBanner />}
      {board && <ThreadBar project={project} onFind={() => setFinding(true)} onHelp={() => setHelp(true)} onAllProjects={openSetup} />}
      {board && <Keys finding={finding} setFinding={setFinding} help={help} setHelp={setHelp} />}
      {kind === "shared" && <OpenShared />}
      <LiveFollow />
      {DEMO && kind === "preview" && <DemoOpen />}
      {/* The hosted demo keeps its one welcome card; your own Rundown has the tour (its last step asks about usage stats). */}
      {DEMO && kind === "preview" ? <Tour /> : isRecording() ? !thread && kind !== "shared" && <Welcome /> : kind !== "shared" && kind !== "preview" && <><Tour /><AfterTour /></>}
      <main className="view"><Crashed where="the map" key={`${thread?.sessionId ?? ""}|${lens}`}><Suspense fallback={<Loading />}>{
        screen === "offline" ? <Offline />
          : screen === "missing" ? <MissingThread onBack={stopReplay} />
          : screen === "places" ? <PlacesView />
          : <MapView />
      }</Suspense></Crashed></main>
    </div>
  );
}

/**
 * Still loading: the workspace status (setup or map?) and, once there's a project, its map; a recording, until it's in.
 * Gives up after a while so a server that doesn't answer shows the app (and its "Connecting…") instead.
 */
function useBooting(): boolean {
  const ready = useLiveSelector((s) => (isRecording() ? s.replay : !!s.setup && (!s.setup.root || !!s.map)));
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
  // Nothing loaded and the server out of reach: say so, rather than "Loading" forever.
  const offline = useOffline();
  if (offline) return <Offline />;
  return <div className="boot" role="status" aria-live="polite"><p>Loading your project…</p></div>;
}

/** A shared replay holds one thread: it opens on that thread's footprint (unless its link names a place). */
function OpenShared() {
  const first = useLiveSelector((s) => s.sessions[0]?.id);
  const { thread } = useNavState();
  const { startReplay } = useNavActions();
  const done = useRef(false);
  useEffect(() => {
    if (!first || done.current) return;
    done.current = true;
    if (!thread) startReplay(first, 0);
  }, [first, thread, startReplay]);
  return null;
}

/** The usage question, for someone who skipped the tour (its last step asks it): once the tour is done, mounted then so
 *  it reads the setting as it is now. */
function AfterTour() {
  const ready = useTour((t) => t.done === true && !t.step);
  return ready ? <UsageAsk /> : null;
}

export function App() {
  return <Crashed><NavProvider><AttentionAlerts /><Shell /></NavProvider></Crashed>;
}
