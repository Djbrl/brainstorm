// Owned by the lead. The third level: one step of the open thread in a side panel (its diff or output, and Ask), the
// same on the Map and the Track. It follows the cursor: scroll the steps or scrub the replay and it shows the step
// you're on. A click anywhere outside it (on the map, say) closes it, as do Esc and Back. Its link is
// /thread/<id>/step/<stepId>.
import { useEffect, useMemo, useRef } from "react";
import { KEEPS_OPEN, useClickAway, useLastShown } from "./panel";
import type { Step } from "@contract";
import { useLive } from "../lib/live";
import { useNav } from "../lib/nav";
import { useThread } from "../lib/thread";
import { StepDetail } from "../follow/StepDetail";
import { isVisible, pairResults } from "../follow/format";
import "../follow/follow.css";
import "./map.css";

export function StepPanel() {
  const { state, loadSteps } = useLive();
  const { replay, step: stepId, showStep, closeStep } = useNav();
  const sid = replay?.sessionId;
  const steps = sid ? state.steps[sid] : undefined;
  useEffect(() => { if (sid && stepId && !steps) loadSteps(sid); }, [sid, stepId, steps, loadSteps]);
  const thread = useThread(sid ?? null, replay?.detail ?? "light");

  // Follow the cursor: when the replay moves to another moment (scrolling the list, scrubbing), show its step.
  const index = replay?.index;
  const pending = !!replay?.atStep; // a step was just opened: the cursor is on its way there
  const stepRef = useRef(stepId); stepRef.current = stepId;
  useEffect(() => {
    const cur = stepRef.current;
    if (!cur || pending || !thread || index === undefined) return;
    const beat = thread.beats[Math.min(index, thread.beats.length - 1)];
    if (beat && thread.stepBeat.get(cur) !== beat.index) showStep(beat.step.id);
  }, [index, pending, thread, showStep]);

  // Click away to close (a drag on the map keeps it).
  useClickAway(!!stepId, KEEPS_OPEN, closeStep);

  const results = useMemo(() => pairResults(steps ?? []), [steps]);
  let step: Step | undefined = stepId ? steps?.find((s) => s.id === stepId) : undefined;
  if (step && !isVisible(step) && steps) { // a tool result (or empty thinking): show the call it answers, or the step before
    const at = steps.indexOf(step);
    const call = [...results.entries()].find(([, r]) => r.id === step!.id)?.[0];
    step = (call && steps.find((s) => s.id === call)) || steps.slice(0, at).reverse().find(isVisible) || step;
  }

  // While it slides out, it keeps showing the step it had.
  const shown = useLastShown(step ? { step, result: results.get(step.id) } : null);
  return (
    <div className={`map-panel pl-panel ${step ? "open" : ""}`} aria-hidden={!step} inert={!step}>
      {shown && <StepDetail step={shown.step} result={shown.result} onClose={closeStep} />}
    </div>
  );
}
