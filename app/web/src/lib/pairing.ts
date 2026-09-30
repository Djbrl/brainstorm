import type { Step } from "@contract";

/**
 * Matches tool results to the calls they answer (same rules as the server's listener/pairing.ts): by tool_use id when
 * both steps carry one, otherwise first-in-first-out per thread, since results come back in call order.
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
    if (!call || (!exact && st.toolUseId && call.toolUseId)) return undefined;
    q.splice(q.indexOf(call), 1);
    if (call.toolUseId) this.byId.delete(call.toolUseId);
    return call;
  }

  /** Forget calls that never got a result (a new prompt interrupts them). */
  clear() { this.queues.clear(); this.byId.clear(); }

  private queue(st: Step): Step[] {
    const k = !!st.isSubagent;
    let q = this.queues.get(k);
    if (!q) this.queues.set(k, (q = []));
    return q;
  }
}
