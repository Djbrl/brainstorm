// Owned by the lead. Cross-view navigation: which view, which session, which file is focused.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type View = "follow" | "map" | "failures";
type Nav = {
  view: View; setView: (v: View) => void;
  sessionId: string | null; setSessionId: (id: string | null) => void;
  focusFile: string | null; setFocusFile: (p: string | null) => void;
  /** Jump to the map with a file selected (e.g. from an edit step). */
  openFile: (path: string) => void;
  /** Step to reveal in Follow (set by openStep; Follow selects + scrolls to it, then clears it). */
  focusStep: string | null; setFocusStep: (id: string | null) => void;
  /** Jump to Follow with a session selected and a step revealed (e.g. from Failures evidence). */
  openStep: (sessionId: string, stepId: string) => void;
};
const Ctx = createContext<Nav | null>(null);

export function NavProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<View>(() => ((new URLSearchParams(location.search).get("view") as View) || "follow"));
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [focusFile, setFocusFile] = useState<string | null>(null);
  const [focusStep, setFocusStep] = useState<string | null>(null);
  // Keep the view in the URL so a reload (e.g. the dev server reacting to agents editing this very repo) stays put.
  useEffect(() => {
    const u = new URL(location.href);
    if (u.searchParams.get("view") === view) return;
    u.searchParams.set("view", view);
    history.replaceState(null, "", u);
  }, [view]);
  const openFile = (p: string) => { setFocusFile(p); setView("map"); };
  const openStep = (sid: string, stepId: string) => { setSessionId(sid); setFocusStep(stepId); setView("follow"); };
  return <Ctx.Provider value={{ view, setView, sessionId, setSessionId, focusFile, setFocusFile, openFile, focusStep, setFocusStep, openStep }}>{children}</Ctx.Provider>;
}
export function useNav() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useNav outside NavProvider");
  return v;
}
