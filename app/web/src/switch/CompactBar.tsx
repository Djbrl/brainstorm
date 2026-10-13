// The small window's bar (NARROW in lib/breakpoints.ts, 1100 px and below: anything but a full screen), floating at the
// bottom of the map and of Places where the full screen's player sits. The thread bar is gone there; this holds what it
// gave: back to your threads (the open one closes, the sidebar opens on the list), Map | Places for the open thread,
// and Find a thread (⌘K). The project switcher is the header's Change project. On a full screen it isn't shown
// (map/dock.css). Placed by the dock's rules: beside a side panel, on the phone's thread sheet.
import { useNavActions, useNavState } from "../lib/nav";
import { LensSwitch } from "../map/LensSwitch";
import { showThreadList } from "../map/sidebar/useSidebarFold";
import { MOD, run } from "./shortcuts";

export function CompactBar() {
  const { thread } = useNavState();
  const { stopReplay } = useNavActions();
  return (
    <nav className="compact-bar" aria-label="Threads">
      {thread && (
        <button className="compact-back" onClick={() => { stopReplay(); showThreadList(); }} title="Back to your threads (Esc)">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5L5.5 8l4.5 4.5" /></svg>
          Threads
        </button>
      )}
      <LensSwitch inBar />
      <button className="compact-find" onClick={() => run("find")} aria-label="Find a thread" title={`Find any thread, in this project or another (${MOD} K)`}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5 14 14" /></svg>
        {!thread && <span>Find a thread</span>}
      </button>
    </nav>
  );
}
