// Where a file opens when you click its name in a step (Settings, "Open files in"): an editor through
// its own link (vscode://file/…; nothing goes through Rundown's server), or whatever app the computer uses for that
// kind of file (the server opens it: server/src/open). Remembered per browser, like the map's prefs.
import { createAtom } from "./store";
import { post } from "./api";

export type Editor = "vscode" | "cursor" | "windsurf" | "zed" | "system";
export const EDITORS: { id: Editor; name: string }[] = [
  { id: "vscode", name: "VS Code" }, { id: "cursor", name: "Cursor" }, { id: "windsurf", name: "Windsurf" }, { id: "zed", name: "Zed" },
  { id: "system", name: "The app your computer uses for it" },
];
const editor = createAtom<Editor>("vscode", { key: "rundown-editor", parse: (v) => EDITORS.find((e) => e.id === v)?.id });
export const setEditor = (e: Editor) => editor.set(e);
export const useEditor = editor.use;
export const editorName = (e: Editor) => (e === "system" ? "your default app" : EDITORS.find((x) => x.id === e)!.name);

/** The editor's own link for a file (at a line), or null for "the app your computer uses" (opened by the server). */
export function editorLink(e: Editor, path: string, line?: number): string | null {
  if (e === "system") return null;
  return `${e}://file${path.split("/").map(encodeURIComponent).join("/")}${line ? `:${line}` : ""}`;
}
/** Opens a file the way the setting says. */
export function openInEditor(e: Editor, path: string, line?: number) {
  const link = editorLink(e, path, line);
  if (link) { location.href = link; return; }
  post("/api/open", { path }).catch(() => { /* the server can't open it: nothing to do */ });
}
