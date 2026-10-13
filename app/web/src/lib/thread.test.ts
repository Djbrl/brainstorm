// The thread builder (buildThread) carries on from the previous list as steps arrive; it must give exactly what a
// fresh build of the same list gives. Seeded from the audit's property test (t-thread.cjs: 47k builds, all equal).
import { describe, expect, it } from "vitest";
import type { Step } from "@contract";
import { buildThread, type Thread } from "./thread";
import { randomSteps, rng } from "../test/fixtures";

const MAPPED = new Set(["/p/a.ts", "/p/b.ts", "/p/src/c.ts", "/p/src/d.ts"]);
/** A new resolver each call: buildThread keys its cache on the resolver, so this always builds from scratch. */
const freshResolver = () => (abs: string | undefined) => (abs && MAPPED.has(abs) ? abs : null);

const plain = (t: Thread) => ({
  beats: t.beats.map((b) => ({ ...b, step: b.step.id, steps: b.steps.map((s) => s.id + (s.label ? "#" + s.label : "")) })),
  moves: t.moves, files: t.files, touched: [...t.touched], stepBeat: [...t.stepBeat].sort(), stepCount: t.stepCount, editCount: t.editCount,
});

describe("buildThread", () => {
  for (const detail of ["light", "full"] as const) {
    it(`grows step by step to what a fresh build gives (${detail})`, () => {
      for (let seed = 1; seed <= 150; seed++) {
        const r = rng(seed), all = randomSteps(r, `S${seed}`), resolve = freshResolver();
        for (let n = 1; n <= all.length; n++) {
          const prefix = all.slice(0, n);
          // Now and then the reader relabels an earlier step: the store replaces that step object.
          if (n > 3 && r() < 0.2) { const k = Math.floor(r() * (n - 1)); prefix[k] = { ...prefix[k], label: `L${n}` }; all[k] = prefix[k]; }
          const grown = buildThread(`S${seed}`, prefix, resolve, detail);
          const fresh = buildThread(`S${seed}`, prefix.slice(), freshResolver(), detail);
          expect(plain(grown), `seed ${seed}, ${n} steps`).toEqual(plain(fresh));
        }
      }
    });
  }

  it("keeps a beat's identity when a later step only adds to the thread", () => {
    const steps = randomSteps(rng(7), "K"), resolve = freshResolver();
    const a = buildThread("K", steps.slice(0, steps.length - 1), resolve);
    const b = buildThread("K", steps, resolve);
    // Every beat but the last one or two (the step may join it) is the same object.
    for (let i = 0; i < a.beats.length - 2; i++) expect(b.beats[i]).toBe(a.beats[i]);
  });

  it("returns the same thread for the same list and resolver", () => {
    const steps = randomSteps(rng(9), "M"), resolve = freshResolver();
    expect(buildThread("M", steps, resolve)).toBe(buildThread("M", steps, resolve));
  });

  it("moves the tracer on edits only, never on reads", () => {
    const at = (i: number) => new Date(Date.parse("2026-10-11T10:00:00Z") + i * 1000).toISOString();
    const s = (i: number, kind: Step["kind"], over: Partial<Step> = {}): Step => ({ id: `x${i}`, sessionId: "T", seq: i, ts: at(i), kind, ...over });
    const steps = [
      s(0, "prompt", { text: "Fix it" }),
      s(1, "tool_call", { tool: "Read", filePath: "/p/a.ts", toolUseId: "r1" }),
      s(2, "tool_result", { toolUseId: "r1", text: "ok" }),
      s(3, "edit", { tool: "Edit", filePath: "/p/b.ts", toolUseId: "e1", diff: { before: "a", after: "b" } }),
      s(4, "tool_call", { tool: "Read", filePath: "/p/src/c.ts", toolUseId: "r2" }),
    ];
    const t = buildThread("T", steps, freshResolver());
    expect(t.moves.map((m) => m.file)).toEqual(["/p/b.ts"]);
    expect(t.editCount).toBe(1);
    expect(t.files).toEqual(["/p/a.ts", "/p/b.ts", "/p/src/c.ts"]);
  });
});
