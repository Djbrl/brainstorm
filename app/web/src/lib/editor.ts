// Owner: viewers. Where a file opens when you click its name in a step (Settings, "Open files in"): an editor through
// its own link (vscode://file/…; nothing goes through Brainstorm's server), or whatever app the computer uses for that
// kind of file (the server opens it: server/src/open). Remembered per browser, like the map's prefs.
import { useSyncExternalStore } from "react";

export type Editor = "vscode" | "cursor" | "windsurf" | "zed" | "system";
export const EDITORS: { id: Editor; name: string }[] = [
  { id: "vscode", name: "VS Code" }, { id: "cursor", name: "Cursor" }, { id: "windsurf", name: "Windsurf" }, { id: "zed", name: "Zed" },
  { id: "system", name: "The app your computer uses for it" },
];
const KEY = "brainstorm-editor";
let editor: Editor = (() => { try { const v = localStorage.getItem(KEY); return EDITORS.some((e) => e.id === v) ? (v as Editor) : "vscode"; } catch { return "vscode"; } })();
const listeners = new Set<() => void>();
const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
const get = () => editor;
export function setEditor(e: Editor) {
  if (e === editor) return;
  editor = e;
  try { localStorage.setItem(KEY, e); } catch { /* not remembered, still applied */ }
  listeners.forEach((f) => f());
}
export const useEditor = () => useSyncExternalStore(subscribe, get, get);
export const editorName = (e: Editor) => (e === "system" ? "your default app" : EDITORS.find((x) => x.id === e)!.name);

/** The editor's own link for a file (at a line), or null for "the app your computer uses" (opened by the server). */
export function editorLink(e: Editor, path: string, line?: number): string | null {
  if (e === "system") return null;
  return `${e}://file${encodeURI(path)}${line ? `:${line}` : ""}`;
}
/** Opens a file the way the setting says. */
export function openInEditor(e: Editor, path: string, line?: number) {
  const link = editorLink(e, path, line);
  if (link) { location.href = link; return; }
  void fetch("/api/open", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path }) });
}
