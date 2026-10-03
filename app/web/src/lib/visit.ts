// Owned by the lead. When you last looked, so the map can show what changed since then instead of everything.
// The time is saved when the page is hidden or closed, and read once when it opens: looking at the map doesn't move
// the line, coming back later does. Per browser; a blocked storage means every visit counts as the first.

const KEY = "brainstorm-last-seen";
const WELCOMED = "brainstorm-welcomed";

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, v: string) {
  try { localStorage.setItem(key, v); } catch { /* storage blocked */ }
}

const saved = Number(read(KEY)) || 0;

/** When you last had Brainstorm open (ms), or null on a first visit. */
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

/** "3 h ago", "yesterday", "on 28 Sep": how long since `ms`, for a sentence. */
export function sinceLabel(ms: number, now = Date.now()): string {
  const min = Math.round((now - ms) / 60_000);
  if (min < 2) return "a moment ago";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  if (h < 48) return "yesterday";
  return `on ${new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
}
