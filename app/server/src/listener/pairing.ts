import type { Step } from "../types";

/**
 * Matches tool results to the calls they answer. By tool_use id when both steps carry one (exact, also across parallel
 * subagents); otherwise first-in-first-out per thread, since results come back in call order (steps stored before ids).
 * Feed steps in order: `call()` for tool_call/edit steps, `result()` for tool_result steps.
 */
export class CallPairer {
  private queues = new Map<boolean, Step[]>();
  private byId = new Map<string, Step>();

  call(st: Step) {
    this.queue(st).push(st);
    if (st.toolUseId) this.byId.set(st.toolUseId, st);
  }

  /** The call this result answers, if any. Each call is returned once. */
  result(st: Step): Step | undefined {
    const exact = st.toolUseId ? this.byId.get(st.toolUseId) : undefined;
    const q = this.queue(exact ?? st);
    const call = exact ?? q[0];
    if (!call || (!exact && st.toolUseId && call.toolUseId)) return undefined; // its call isn't here (e.g. before an `until` cut)
    q.splice(q.indexOf(call), 1);
    if (call.toolUseId) this.byId.delete(call.toolUseId);
    return call;
  }

  /** Calls with no result yet (still running, or interrupted). */
  pending(): Step[] { return [...this.queues.values()].flat(); }

  private queue(st: Step): Step[] {
    const k = !!st.isSubagent;
    let q = this.queues.get(k);
    if (!q) this.queues.set(k, (q = []));
    return q;
  }
}
