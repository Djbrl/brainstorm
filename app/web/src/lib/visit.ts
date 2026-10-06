// Owned by the lead. When you last looked, so the map can show what changed since then instead of everything.
// The time is saved when the page is hidden or closed, and read once per tab: looking at the map or reloading doesn't
// move the line, coming back later in a new tab does. Per browser; a blocked storage means every visit counts as the first.

import { relTime } from "../follow/format";

const KEY = "rundown-last-seen";
const WELCOMED = "rundown-welcomed";

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, v: string) {
  try { localStorage.setItem(key, v); } catch { /* storage blocked */ }
}

/**
 * The line for this tab. A reload keeps it (the review found a refresh wiped every highlight): the first load in a tab
 * reads when you last left, and stores it for the tab's later reloads in sessionStorage. A new tab or window starts over.
 */
const BASELINE = "rundown-baseline";
function baseline(): number {
  try {
    const kept = Number(sessionStorage.getItem(BASELINE)) || 0;
    if (kept > 0) return kept;
    const saved = Number(read(KEY)) || 0;
    sessionStorage.setItem(BASELINE, String(saved || -1)); // -1: a first visit, remembered as such across reloads
    return saved;
  } catch { return Number(read(KEY)) || 0; }
}
const saved = baseline();

/** When you last had Rundown open (ms), or null on a first visit. */
export const lastSeen: number | null = saved > 0 ? saved : null;

/** "Since you last looked" needs a line: a first visit uses the last 24 hours. */
export const sinceMs = lastSeen ?? Date.now() - 24 * 3_600_000;

const mark = () => write(KEY, String(Date.now()));
if (typeof window !== "undefined") {
  addEventListener("pagehide", mark);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") mark(); });
}

/** Whether the first-visit card was seen (or dismissed). */
export const welcomed = () => read(WELCOMED) === "1";
export const markWelcomed = () => write(WELCOMED, "1");

/** When `ms` was, for a sentence: relTime's words ("3 h ago", "yesterday 14:05"), with "on" before a date ("on Mon 2 Oct"). */
export function sinceLabel(ms: number, now = Date.now()): string {
  const t = relTime(ms, now);
  return /ago$|^just|^yesterday/.test(t) ? t : `on ${t}`;
}
