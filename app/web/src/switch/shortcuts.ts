// The keyboard shortcuts, in one registry: what each key is, how the ? window says it, and one window listener that
// hands a key press to whichever view does it now. Views say what a shortcut does with useShortcut(id, handler); a
// button that does the same as a key calls run(id). Windows over the page (Settings, Find a thread, the tour) keep
// their own keys: they take them first (capture) and stop them here.
import { useEffect, useRef } from "react";

/** Typing in a field: single-key shortcuts stay out of the way. */
export function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  if (el.tagName === "INPUT" && /^(range|checkbox|radio|button)$/.test((el as HTMLInputElement).type)) return false; // a slider isn't typing
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
}
/** In a text field (a select or a slider counts too), for Esc: it stays the field's. */
const inField = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || !!el.isContentEditable);
};
/** A window is open over the map (Settings, Find a thread, a picture): the map's own keys wait. */
export const windowOpen = () => !!document.querySelector('[aria-modal="true"], .lightbox');

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const MOD = isMac ? "⌘" : "Ctrl";

const key = (...ks: string[]) => (e: KeyboardEvent) => ks.includes(e.key);

type Entry = {
  id: string;
  /** Its group in the ? window, the keys it shows ("…" reads "to") and what it does. No `what`: not listed there. */
  group?: string; keys?: string[]; what?: string;
  /** Whether this key press is this shortcut. */
  match: (e: KeyboardEvent) => boolean;
  /** The handler checks everything itself (modifier keys, typing, a key already taken). Otherwise a press with ⌘, Ctrl
   *  or Alt, one while typing, or one another handler already took, isn't this shortcut. */
  raw?: boolean;
};

/** In the order a key press tries them (Esc stops following before it steps back). */
const ENTRIES: Entry[] = [
  { id: "find", group: "Threads", keys: [`${MOD} K`], what: "Find a thread, here or in another project", raw: true,
    match: (e) => (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k" },
  { id: "thread.number", group: "Threads", keys: ["1", "…", "9"], what: "Open a thread in the bar", match: (e) => /^[1-9]$/.test(e.key) },
  { id: "thread.next", group: "Threads", keys: ["[", "]"], what: "The thread before or after in the bar", match: key("[", "]") },
  { id: "sidebar", group: "Threads", keys: ["T"], what: "Show or hide the sidebar (folded, it shows the thread's step)", match: key("t", "T") },
  { id: "follow.stop", raw: true, match: key("Escape") },
  { id: "back", group: "Threads", keys: ["Esc"], what: "Step back: close the step, stop following, close the thread", raw: true, match: key("Escape") },

  { id: "map.move", group: "Map", keys: ["←", "↑", "→", "↓"], what: "Move around the map: hold to glide", raw: true,
    match: (e) => !e.shiftKey && key("ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown")(e) },
  { id: "map.zoom", group: "Map", keys: ["Shift", "↑", "↓"], what: "Zoom in or out: hold to keep going", raw: true,
    match: (e) => key("Shift", "+", "=", "-", "_")(e) || (e.shiftKey && key("ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown")(e)) },
  { id: "center", group: "Map", keys: ["C"], what: "Center the camera on the agent (without locking it)", match: key("c", "C") },
  { id: "follow.next", group: "Map", keys: ["A"], what: "Follow the next agent (with Shift, the one before)", match: key("a", "A") },
  { id: "readmap", group: "Map", keys: ["M"], what: "Show or hide the Readmap", match: key("m", "M") },
  { id: "lock", group: "Map", keys: ["L"], what: "Lock or unlock the camera on the agent", match: key("l", "L") },
  { id: "lens", group: "Map", keys: ["P"], what: "Switch between the map and Places", match: key("p", "P") },

  { id: "play", group: "Replay", keys: ["Space"], what: "Play or pause, from the step you're on", match: key(" ") },
  { id: "player.step", group: "Replay", keys: ["←", "→"], what: "In the player: one step back or forward (with Shift, ten)", match: key("ArrowLeft", "ArrowRight") },
  { id: "player.ends", group: "Replay", keys: ["Home", "End"], what: "In the player: the first or the last step", match: key("Home", "End") },

  { id: "help", group: "Help", keys: ["?"], what: "These shortcuts", match: key("?") },
];

export type ShortcutId = "find" | "thread.number" | "thread.next" | "sidebar" | "follow.stop" | "back" | "map.move" | "map.zoom" | "center"
  | "follow.next" | "readmap" | "lock" | "lens" | "play" | "player.step" | "player.ends" | "help";

/** The ? window's list: the shortcuts by group, in order. */
export const SHORTCUTS: { title: string; keys: { keys: string[]; what: string }[] }[] = [];
for (const e of ENTRIES) {
  if (!e.what || !e.group) continue;
  let g = SHORTCUTS.find((x) => x.title === e.group);
  if (!g) SHORTCUTS.push((g = { title: e.group, keys: [] }));
  g.keys.push({ keys: e.keys ?? [], what: e.what });
}

/**
 * What a shortcut does in a view. `e` is the key press, or undefined when a button runs it (run). Returns false when it
 * has nothing to do just now: the press goes on to the next view that does this shortcut, and the page keeps the key.
 */
export type ShortcutHandler = (e?: KeyboardEvent) => boolean | void;

const handlers = new Map<string, { current: ShortcutHandler }[]>();

function onKey(e: KeyboardEvent) {
  for (const entry of ENTRIES) {
    const list = handlers.get(entry.id);
    if (!list?.length || !entry.match(e)) continue;
    if (!entry.raw && (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target))) continue;
    for (const h of [...list]) {
      if (h.current(e) !== false) { if (!entry.raw) e.preventDefault(); return; }
    }
  }
}
let listening = false;

/** Do a shortcut as if its key was pressed (a toolbar button). Returns whether some view did it. */
export function run(id: ShortcutId): boolean {
  for (const h of [...(handlers.get(id) ?? [])]) if (h.current() !== false) return true;
  return false;
}

/**
 * This view does `id` while it's mounted: `handler` (its latest version) runs when the key is pressed, or a button
 * runs it. Views mounted earlier get the press first.
 */
export function useShortcut(id: ShortcutId, handler: ShortcutHandler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!listening && typeof window !== "undefined") { addEventListener("keydown", onKey); listening = true; }
    const list = handlers.get(id) ?? [];
    handlers.set(id, list);
    const h = { current: (e?: KeyboardEvent) => ref.current(e) };
    list.push(h);
    return () => { const i = list.indexOf(h); if (i >= 0) list.splice(i, 1); };
  }, [id]);
}

/** Where the arrow keys and + − stay with the page, not the map's camera (map/useCameraKeys.ts): any field (a slider
 *  too: its arrows move it), a list that scrolls with them (the Track's, a listbox), a window over the page. */
const keepsArrows = (t: EventTarget | null) => {
  const el = t instanceof HTMLElement ? t : null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable || !!el.closest(".rp-list, [role=listbox], [aria-modal=true]"));
};

/** For raw handlers: Esc and the camera's keys follow these rules themselves. */
export const keyRules = { inField, keepsArrows };
