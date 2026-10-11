// The third level: one step of the open thread in a side panel (its diff or output, and Ask), the
// same on the Map and the Track. It follows the cursor: scroll the steps or scrub the replay and it shows the step
// you're on. A click anywhere outside it (on the map, say) closes it, as do Esc and Back. Its link is
// /thread/<id>/step/<stepId>. Places shows its steps in the same panel, with its own header (where, "1 of 3 here")
// and its own way back; there it goes by the places rather than the cursor.
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { KEEPS_OPEN, useClickAway, useLastShown } from "./panel";
import type { Step } from "@contract";
import { useLiveActions, useLiveSelector } from "../lib/live";
import { useNavActions, useNavState, useReplayCursor } from "../lib/nav";
import { useThread } from "../lib/thread";
import { StepDetail } from "../follow/StepDetail";
import { isVisible, pairResults } from "../follow/format";
import "../follow/follow.css";
import "./map.css";

type StepPanelProps = {
  /** Under Back, above the step (Places: the place, and ‹ › through its steps). */
  header?: ReactNode;
  /** The Back button's words. */
  back?: string;
  /** Close it (Back, and the step view's own close). The app's closeStep by default. */
  onClose?: () => void;
  /** Follow the replay cursor and close on a click away (the Map). Places' panel goes by its places instead. */
  follow?: boolean;
};

export function StepPanel({ header, back = "Back to the steps", onClose, follow = true }: StepPanelProps = {}) {
  const { loadSteps } = useLiveActions();
  const { replay, step: stepId } = useNavState();
  const { showStep, closeStep } = useNavActions();
  const index = useReplayCursor((c) => (replay ? c.index : undefined));
  const sid = replay?.sessionId;
  const steps = useLiveSelector((s) => (sid ? s.steps[sid] : undefined));
  useEffect(() => { if (sid && stepId && !steps) loadSteps(sid); }, [sid, stepId, steps, loadSteps]);
  const thread = useThread(sid ?? null, replay?.detail ?? "light");

  // Follow the cursor: when the replay moves to another moment (scrolling the list, scrubbing), show its step.
  const pending = !!replay?.atStep; // a step was just opened: the cursor is on its way there
  const stepRef = useRef(stepId); stepRef.current = stepId;
  const lastIndex = useRef(index);
  useEffect(() => {
    const cur = stepRef.current;
    const moved = lastIndex.current !== index;
    lastIndex.current = index;
    // The thread was built again under a cursor that didn't move: its moments may have renumbered, and the cursor is
    // put back on its step (App's KeepCursor). The open step stays.
    if (!moved || !follow) return;
    if (!cur || pending || !thread || index === undefined) return;
    const beat = thread.beats[Math.min(index, thread.beats.length - 1)];
    if (beat && thread.stepBeat.get(cur) !== beat.index) showStep(beat.step.id);
  }, [index, pending, thread, showStep, follow]);

  // Click away to close (a drag on the map keeps it).
  const close = onClose ?? closeStep;
  useClickAway(follow && !!stepId, KEEPS_OPEN, close);

  const results = useMemo(() => pairResults(steps ?? []), [steps]);
  let step: Step | undefined = stepId ? steps?.find((s) => s.id === stepId) : undefined;
  if (step && !isVisible(step) && steps) { // a tool result (or empty thinking): show the call it answers, or the step before
    const at = steps.indexOf(step);
    const call = [...results.entries()].find(([, r]) => r.id === step!.id)?.[0];
    step = (call && steps.find((s) => s.id === call)) || steps.slice(0, at).reverse().find(isVisible) || step;
  }

  // Keyboard: a step opened from the list (Enter on a row) takes the focus with it, so the next Tab is in the panel;
  // closing it (Esc, Back) gives the focus back to the list's row for that step.
  const panel = useRef<HTMLDivElement>(null);
  const focusInside = useRef(false);
  const isOpen = !!step;
  useEffect(() => {
    const el = panel.current, active = document.activeElement;
    if (!el) return;
    if (isOpen && active instanceof HTMLElement && active.closest(".rp-steps")) el.focus({ preventScroll: true });
    if (!isOpen && focusInside.current) {
      focusInside.current = false;
      document.querySelector<HTMLElement>(".rp-steps .rp-m[aria-current='step']")?.focus({ preventScroll: true });
    }
  }, [isOpen]);

  // While it slides out, it keeps showing the step it had.
  const shown = useLastShown(step ? { step, result: results.get(step.id) } : null);
  return (
    <div className={`map-panel pl-panel ${step ? "open" : ""}`} aria-hidden={!step} inert={!step} ref={panel} tabIndex={-1}
      role="region" aria-label="Step" onFocus={() => { focusInside.current = true; }}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null) && e.relatedTarget) focusInside.current = false; }}>
      {shown && <button className="pl-panel-back" onClick={close}><i aria-hidden="true">‹</i>{back}</button>}
      {shown && header}
      {shown && <StepDetail step={shown.step} result={shown.result} onClose={close} />}
    </div>
  );
}
