// Owned by the lead. The map theme: how the map (and the chrome around it) looks. One choice per browser.
//
// The theme is set as <html data-theme="…"> so CSS can restyle surfaces (styles/themes.css), and read on every
// frame by the canvas layers through getTheme() (see map/themes.ts), like mapPrefs.
import { useSyncExternalStore } from "react";

export type ThemeId = "default" | "prism" | "hologram" | "metro";

export const THEMES: { id: ThemeId; name: string; note: string; dark: boolean }[] = [
  { id: "default", name: "Rundown", note: "Light and quiet. Colour shows what changed.", dark: false },
  { id: "metro", name: "Metro", note: "A regional rail map: folders as coloured lines, files as stations, fare zones.", dark: false },
  { id: "prism", name: "Prism", note: "Glass cubes in a violet haze, agents as glowing orbs.", dark: true },
  { id: "hologram", name: "Hologram", note: "A deck plan: blueprint rooms and waypoints on a dark grid.", dark: true },
];

const KEY = "rundown-theme";
const isTheme = (v: unknown): v is ThemeId => THEMES.some((t) => t.id === v);
/** Themes renamed in 0.6 (the old names were other companies' trademarks): a choice saved under the old id carries over. */
const RENAMED: Record<string, ThemeId> = { ps2: "prism", deadspace: "hologram" };

function read(): ThemeId {
  try {
    let v = localStorage.getItem(KEY);
    if (v && RENAMED[v]) { v = RENAMED[v]; localStorage.setItem(KEY, v); }
    if (isTheme(v)) return v;
  } catch { /* storage blocked: the default */ }
  return "default";
}

let current: ThemeId = read();
const listeners = new Set<() => void>();
const apply = () => { document.documentElement.dataset.theme = current; };
apply();

export const getTheme = () => current;
export function setTheme(id: ThemeId) {
  if (id === current) return;
  current = id;
  try { localStorage.setItem(KEY, id); } catch { /* not remembered, still applied */ }
  apply();
  listeners.forEach((f) => f());
}
const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
export const useTheme = () => useSyncExternalStore(subscribe, getTheme, getTheme);
