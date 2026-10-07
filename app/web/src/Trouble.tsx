// Owned by the lead. When something goes wrong, said in plain words with a way out, instead of a page that waits
// forever or goes blank: the server out of reach (useOffline, Offline, OfflineBanner) and a crash while drawing the
// page (Crashed, an error boundary).
import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from "react";
import { isReplay, useLiveSelector } from "./lib/live";

/** The server hasn't answered for a few seconds (a blip while it restarts after an update doesn't count). */
export function useOffline(after = 4000): boolean {
  const connected = useLiveSelector((s) => s.connected);
  const [long, setLong] = useState(false);
  useEffect(() => {
    if (connected || isReplay()) { setLong(false); return; }
    const t = setTimeout(() => setLong(true), after);
    return () => clearTimeout(t);
  }, [connected, after]);
  return long && !isReplay();
}

const AWAY = "Rundown starts with your Claude Code sessions. If it doesn't come back within a minute, start a new Claude Code session, which starts it again.";

/** In place of the project, when nothing could load: the server is out of reach. */
export function Offline() {
  return (
    <div className="boot trouble" role="alert">
      <h2>Can't reach Rundown</h2>
      <p>Its server isn't answering. Trying again every few seconds.</p>
      <p className="trouble-hint">{AWAY}</p>
      <button className="next-cta" onClick={() => location.reload()}>Try again now</button>
    </div>
  );
}

/** Over the project, when the connection drops after it loaded: what's on screen may be out of date. */
export function OfflineBanner() {
  return (
    <div className="trouble-banner" role="status" title={AWAY}>
      <span className="trouble-dot" aria-hidden="true" />
      Lost the connection to Rundown. What you see may be out of date; trying again…
      <button onClick={() => location.reload()}>Reload</button>
    </div>
  );
}

/** A crash while drawing the page: a way out instead of a blank page. */
export class Crashed extends Component<{ children: ReactNode; where?: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error(`Rundown: ${this.props.where ?? "the page"} crashed`, error, info.componentStack); }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="boot trouble" role="alert">
        <h2>Something went wrong here</h2>
        <p>This part of Rundown stopped while drawing. Reloading the page usually brings it back.</p>
        <button className="next-cta" onClick={() => location.reload()}>Reload</button>
        <details className="trouble-detail"><summary>What happened</summary><code>{error.message}</code></details>
      </div>
    );
  }
}
