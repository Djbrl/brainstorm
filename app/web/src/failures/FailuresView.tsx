// Owner: C. Recurring failures, grouped and prioritized, with evidence steps.
import { useLive } from "../lib/live";

export function FailuresView() {
  const { state } = useLive();
  return <div style={{ padding: 40 }}><h1>Failures</h1><p>{state.failures.length} groups</p></div>;
}
