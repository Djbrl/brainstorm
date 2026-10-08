// A window over the page (the welcome card, settings, the shortcuts) takes the keyboard while it's open: the focus moves
// into it, Tab and Shift Tab go round its buttons only, Esc closes it, and on close the focus goes back where it was.
import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useDialogFocus(box: RefObject<HTMLElement | null>, onClose: () => void, open = true) {
  const close = useRef(onClose); close.current = onClose;

  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    const items = () => [...(box.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter((el) => el.offsetParent !== null);
    // The first button, or the window itself (it has tabIndex -1) when it has none.
    (items()[0] ?? box.current)?.focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      const el = box.current;
      if (!el) return;
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close.current(); return; }
      if (e.key !== "Tab") return;
      const all = items();
      if (!all.length) { e.preventDefault(); el.focus(); return; }
      const first = all[0], last = all[all.length - 1], at = document.activeElement;
      if (!el.contains(at)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
      else if (e.shiftKey && (at === first || at === el)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
    };
    addEventListener("keydown", onKey, true);
    return () => {
      removeEventListener("keydown", onKey, true);
      if (before && before !== document.body && document.contains(before)) before.focus({ preventScroll: true });
    };
  }, [box, open]);
}
