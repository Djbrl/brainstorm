// Owner: switcher. The keyboard shortcuts, in one list: the ? window shows it, and the handlers check typing the same way.

/** Typing in a field: single-key shortcuts stay out of the way. */
export function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const MOD = isMac ? "⌘" : "Ctrl";

export const SHORTCUTS: { title: string; keys: { keys: string[]; what: string }[] }[] = [
  {
    title: "Threads",
    keys: [
      { keys: [`${MOD} K`], what: "Find a thread, here or in another project" },
      { keys: ["1", "…", "9"], what: "Open a thread in the bar" },
      { keys: ["[", "]"], what: "The thread before or after" },
      { keys: ["Esc"], what: "Step back: close the step, stop following, close the thread" },
    ],
  },
  {
    title: "Map",
    keys: [
      { keys: ["←", "↑", "→", "↓"], what: "Move around the map: hold to glide (with Shift, faster)" },
      { keys: ["+", "−"], what: "Zoom in or out: hold to keep going" },
      { keys: ["F"], what: "Fit the map to the window" },
      { keys: ["L"], what: "Lock or unlock the camera on the agent" },
      { keys: ["R"], what: "Show or hide reads" },
      { keys: ["P"], what: "Switch between the map and Places" },
    ],
  },
  {
    title: "Replay",
    keys: [
      { keys: ["Space"], what: "Play or pause, from the step you're on" },
      { keys: ["←", "→"], what: "In the player: one step back or forward (with Shift, ten)" },
      { keys: ["Home", "End"], what: "In the player: the first or the last step" },
    ],
  },
  {
    title: "Help",
    keys: [{ keys: ["?"], what: "These shortcuts" }],
  },
];
