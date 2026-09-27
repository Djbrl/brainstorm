// Owned by the lead. Cross-view navigation: which view, which session, which file is focused.
import { createContext, useContext, useState, type ReactNode } from "react";

export type View = "follow" | "map";
type Nav = {
  view: View; setView: (v: View) => void;
  sessionId: string | null; setSessionId: (id: string | null) => void;
  focusFile: string | null; setFocusFile: (p: string | null) => void;
  /** Jump to the map with a file selected (e.g. from an edit step). */
  openFile: (path: string) => void;
};
const Ctx = createContext<Nav | null>(null);

export function NavProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<View>("follow");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [focusFile, setFocusFile] = useState<string | null>(null);
  const openFile = (p: string) => { setFocusFile(p); setView("map"); };
  return <Ctx.Provider value={{ view, setView, sessionId, setSessionId, focusFile, setFocusFile, openFile }}>{children}</Ctx.Provider>;
}
export function useNav() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useNav outside NavProvider");
  return v;
}
