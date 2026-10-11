// A timer's work runs outside any request or transaction: an error thrown there (a database another program holds
// locked, a full disk) would reach the event loop and stop the whole server. Timers run their work through here.

/** Run `fn` (sync or async); a throw or a rejection is logged as `<what> failed: ...`, never passed on. */
export function safely(log: { warn(message: string): unknown }, what: string, fn: () => unknown): void {
  const fail = (e: unknown) => { log.warn(`${what} failed: ${e instanceof Error ? e.message : String(e)}`); };
  try {
    const r = fn();
    if (r instanceof Promise) r.catch(fail);
  } catch (e) { fail(e); }
}
