// Owned by the lead. The map theme: how the map (and the chrome around it) looks. One choice per browser.
//
// The theme is set as <html data-theme="…"> so CSS can restyle surfaces (styles/themes.css), and read on every
// frame by the canvas layers through getTheme() (see map/themes.ts), like mapPrefs.
import { useSyncExternalStore } from "react";

export type ThemeId = "default" | "ps2" | "deadspace" | "metro";

export const THEMES: { id: ThemeId; name: string; note: string; dark: boolean }[] = [
  { id: "default", name: "Rundown", note: "Light and quiet. Colour shows what changed.", dark: false },
  { id: "metro", name: "Metro", note: "Imports as transit lines, files as stations.", dark: false },
  { id: "ps2", name: "PS2", note: "Glass cubes in a violet haze.", dark: true },
  { id: "deadspace", name: "Dead Space", note: "A hologram: floor plates and a cyan locator line.", dark: true },
];

const KEY = "rundown-theme";
const isTheme = (v: unknown): v is ThemeId => THEMES.some((t) => t.id === v);

function read(): ThemeId {
  try { const v = localStorage.getItem(KEY); if (isTheme(v)) return v; } catch { /* storage blocked: the default */ }
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
