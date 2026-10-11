// Whether the sidebar is open, for MapSidebar. On a wide window it's open: ‹ or T folds it for now, not for next time
// (it used to be saved, and a fold left from a small window kept it folded on a wide one). Below 1100px wide it starts
// folded and opens over the content (tap outside, ‹ or Esc to fold it); that narrow state isn't saved, so the desktop's
// folded-or-not choice stays as it was. Folding the sheet by hand slides it away (.leaving), then it goes.
// On a tablet-sized window, the open sheet and a step's panel take turns (one opening closes the other).
import { useEffect, useRef, useState } from "react";
import { useNavActions, useNavState } from "../../lib/nav";
import { NARROW, PHONE, reducedMotion, useMedia } from "../../lib/breakpoints";

const LEAVE_MS = 220;                 // the sheet sliding away as it folds (sidebar.css)

export function useSidebarFold() {
  const { step: openStep } = useNavState();
  const { closeStep } = useNavActions();
  const [folded, setFolded] = useState(false); // wide: folded by hand, for now
  const narrow = useMedia(NARROW), phone = useMedia(PHONE);
  const [over, setOverNow] = useState(false); // narrow: open over the content, never saved
  // Folding the open sheet by hand: it slides away first (.leaving), then goes.
  const [leaving, setLeaving] = useState(false);
  const leaveT = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const setOver = (on: boolean) => {
    clearTimeout(leaveT.current);
    if (on || !over || reducedMotion()) { setLeaving(false); setOverNow(on); return; }
    setLeaving(true);
    leaveT.current = setTimeout(() => { setLeaving(false); setOverNow(false); }, LEAVE_MS);
  };
  useEffect(() => () => clearTimeout(leaveT.current), []);
  const collapsed = narrow ? !over : folded;
  const setCollapsed = (c: boolean) => (narrow ? setOver(!c) : setFolded(c));
  /** Open it (over the content when narrow), or fold it. */
  const setOpen = (open: boolean) => (narrow ? setOver(open) : setFolded(!open));

  // Back to a wide window: the sidebar opens again.
  useEffect(() => { if (!narrow) setFolded(false); }, [narrow]);
  useEffect(() => { if (!narrow) setOverNow(false); }, [narrow]);
  // A tablet-sized window has no room for the open sheet and a step's panel side by side (it used to slide over the
  // step, or leave the map no room): a step opening folds the sheet, the sheet opening closes the step (its row is still
  // the highlighted one, a tap opens it again). A phone shows the step in the sheet's place (map.css).
  const tablet = narrow && !phone;
  useEffect(() => { if (tablet && openStep && over) setOver(false); }, [openStep]);
  useEffect(() => { if (tablet && over && openStep) closeStep(); }, [over]);
  // Esc folds the open sheet first (before the app's Esc steps back out of a thread).
  useEffect(() => {
    if (!over) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOver(false); } };
    addEventListener("keydown", esc, true);
    return () => removeEventListener("keydown", esc, true);
  }, [over]);

  return { narrow, phone, over, leaving, collapsed, setCollapsed, setOpen, setOver, setOverNow };
}
