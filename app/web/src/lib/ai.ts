// Owner: review-fixes. Whether the AI that writes file summaries is on, from the setup checklist (GET /api/workspace).
import type { SetupStatus } from "@contract";

/** True when summaries can be written now; false when no model is set up or it's offline; null while unknown. */
export function summariesOn(setup: SetupStatus | null): boolean | null {
  const step = setup?.steps.find((s) => s.id === "nemotron");
  if (!step || step.state === "pending" || step.state === "running") return null;
  return step.state === "done";
}

/** What to show where a file's summary would be, when there is none yet. */
export function missingSummary(setup: SetupStatus | null): string {
  const on = summariesOn(setup);
  if (on === false) return "No summary: file summaries need an AI model, and none is set up.";
  return "Summarizing…";
}
