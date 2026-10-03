// Owned by the lead. The third level: one step of the open thread in a side panel (its diff or output, and Ask), the
// same on the Map and the Track. ‹ › walk through the thread's steps without going back to the list. Its link is
// /thread/<id>/step/<stepId>; Esc or Back closes it.
import { useEffect, useMemo } from "react";
import type { Step } from "@contract";
import { useLive } from "../lib/live";
import { useNav } from "../lib/nav";
import { StepDetail } from "../follow/StepDetail";
import { isVisible, pairResults } from "../follow/format";
import "../follow/follow.css";
import "./map.css";

export function StepPanel() {
  const { state, loadSteps } = useLive();
  const { replay, step: stepId, openStep, closeStep } = useNav();
  const sid = replay?.sessionId;
  const steps = sid ? state.steps[sid] : undefined;
  useEffect(() => { if (sid && stepId && !steps) loadSteps(sid); }, [sid, stepId, steps, loadSteps]);

  const results = useMemo(() => pairResults(steps ?? []), [steps]);
  const visible = useMemo(() => (steps ?? []).filter(isVisible), [steps]);
  let step: Step | undefined = stepId ? steps?.find((s) => s.id === stepId) : undefined;
  if (step && !isVisible(step) && steps) { // a tool result (or empty thinking): show the call it answers, or the step before
    const at = steps.indexOf(step);
    const call = [...results.entries()].find(([, r]) => r.id === step!.id)?.[0];
    step = (call && steps.find((s) => s.id === call)) || steps.slice(0, at).reverse().find(isVisible) || step;
  }
  const pos = step ? visible.indexOf(step) : -1;
  const go = (d: number) => { const next = visible[pos + d]; if (sid && next) openStep(sid, next.id); };

  return (
    <div className={`map-panel pl-panel ${step ? "open" : ""}`} aria-hidden={!step}>
      {step && (
        <>
          <div className="pl-panel-nav">
            <span>Step {pos + 1} of {visible.length}</span>
            <span className="pl-panel-count" />
            <button onClick={() => go(-1)} disabled={pos <= 0} aria-label="Previous step">‹</button>
            <button onClick={() => go(1)} disabled={pos < 0 || pos >= visible.length - 1} aria-label="Next step">›</button>
          </div>
          <StepDetail step={step} result={results.get(step.id)} onClose={closeStep} />
        </>
      )}
    </div>
  );
}
