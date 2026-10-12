// Seeded randomness and small builders for the tests: the same seed gives the same cases on every run.
import type { Session, Step } from "@contract";

/** A seeded random number generator (mulberry32): numbers in [0, 1). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const int = (r: () => number, n: number) => Math.floor(r() * n);
export const pick = <T>(r: () => number, l: readonly T[]): T => l[int(r, l.length)];
export const shuffle = <T>(r: () => number, l: readonly T[]): T[] => {
  const b = l.slice();
  for (let i = b.length - 1; i > 0; i--) { const j = int(r, i + 1); [b[i], b[j]] = [b[j], b[i]]; }
  return b;
};

export const session = (id: string, over: Partial<Session> = {}): Session => ({
  id, cwd: "/p", title: id, startedAt: "2026-10-11T10:00:00.000Z", lastEventAt: "2026-10-11T10:00:00.000Z", status: "idle", harness: "claude", ...over,
});

/**
 * A random thread like the ones agents write (seeded from the audit's property test, t-thread.cjs): prompts, words,
 * thinking, reads, searches, commands that read files, edits in and out of the project, results with and without a
 * tool_use id (sometimes before their call's neighbours), and subagents interleaved with the main thread.
 */
export function randomSteps(r: () => number, sessionId = "S", files: readonly (string | undefined)[] = ["/p/a.ts", "/p/b.ts", "/p/src/c.ts", "/p/src/d.ts", "/elsewhere/x.ts", undefined]): Step[] {
  const steps: Step[] = [];
  const open: string[] = [];
  let t = Date.parse("2026-10-11T10:00:00Z"), n = 0;
  const len = 5 + int(r, 60);
  for (let i = 0; i < len; i++) {
    t += pick(r, [100, 1000, 5000, 60_000, 40 * 60_000, -2000]);
    const ag = pick(r, [null, null, null, "a1", "a2"]);
    const who = ag ? { isSubagent: true, agentId: ag } : { isSubagent: false };
    const base = { id: `s${n++}`, sessionId, seq: i, ts: new Date(t).toISOString() };
    const x = r();
    if (x < 0.08) steps.push({ ...base, kind: "prompt", text: pick(r, ["Please fix the bug", "[Request interrupted by user]"]), isSubagent: false });
    else if (x < 0.22) steps.push({ ...base, kind: "text", text: pick(r, ["Done.", "Now I will update the parser.", ""]), ...who });
    else if (x < 0.3) steps.push({ ...base, kind: "thinking", text: "hmm", ...who });
    else if (x < 0.62) {
      const tool = pick(r, ["Read", "Grep", "Bash", "Glob", "WebFetch", "Task"]);
      const id = r() < 0.85 ? `tu${n}` : undefined;
      if (id) open.push(id);
      steps.push({ ...base, kind: "tool_call", tool, toolUseId: id, filePath: tool === "Read" ? pick(r, files) : undefined,
        ...(tool === "Bash" && r() < 0.4 ? { reads: [pick(r, files) ?? "/p/a.ts"] } : {}), ...who });
    } else if (x < 0.82) {
      const id = open.length && r() < 0.8 ? open.splice(int(r, open.length), 1)[0] : undefined;
      steps.push({ ...base, kind: "tool_result", toolUseId: id, text: pick(r, ["ok", "Error: no such file", "Exit code 1"]), isError: r() < 0.15, ...who });
    } else {
      const id = `tu${n}`;
      open.push(id);
      steps.push({ ...base, kind: "edit", tool: pick(r, ["Edit", "Write", "MultiEdit"]), toolUseId: id, filePath: pick(r, files) ?? "/p/a.ts",
        diff: { before: "a", after: "b" }, ...who });
    }
  }
  return steps;
}
