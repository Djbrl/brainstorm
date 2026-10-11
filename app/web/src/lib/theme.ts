// The map theme: how the map (and the chrome around it) looks. One choice per browser.
//
// The theme is set as <html data-theme="…"> so CSS can restyle surfaces (styles/themes.css), and read on every
// frame by the canvas layers through getTheme() (see map/themes.ts), like mapPrefs.
import { createAtom, readStored, writeStored } from "./store";

export type ThemeId = "default" | "prism" | "hologram" | "metro";

export const THEMES: { id: ThemeId; name: string; note: string; dark: boolean }[] = [
  { id: "default", name: "Rundown", note: "Light and quiet. Colour shows what changed.", dark: false },
  { id: "metro", name: "Metro", note: "A regional rail map: files as stations, folders as fare zones.", dark: false },
  { id: "prism", name: "Prism", note: "Glass cubes in a violet haze.", dark: true },
  { id: "hologram", name: "Hologram", note: "Turning wireframe globes and a violet locator line, in a dark room.", dark: true },
];

const KEY = "rundown-theme";
const isTheme = (v: unknown): v is ThemeId => THEMES.some((t) => t.id === v);
/** Themes renamed in 0.6 (the old names were other companies' trademarks): a choice saved under the old id carries over. */
const RENAMED: Record<string, ThemeId> = { ps2: "prism", deadspace: "hologram" };

const theme = createAtom<ThemeId>("default", { key: KEY, parse: (v) => { const t = RENAMED[v] ?? v; return isTheme(t) ? t : undefined; } });
{ const saved = readStored(KEY); if (saved && RENAMED[saved]) writeStored(KEY, RENAMED[saved]); } // kept under its new name
const apply = () => { document.documentElement.dataset.theme = theme.get(); };
apply();
theme.subscribe(apply);

export const getTheme = theme.get;
export const setTheme = (id: ThemeId) => theme.set(id);
export const useTheme = theme.use;
