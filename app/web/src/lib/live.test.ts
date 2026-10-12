// The live store's reducer: messages applied in batches, with indexes kept beside the state. Each case checks the
// state against what the messages mean, and that untouched parts keep their identity (what the selectors rely on).
import { describe, expect, it } from "vitest";
import type { FileNode, ProjectMap, Step } from "@contract";
import { createLiveStore } from "./live";
import { int, pick, rng, session } from "../test/fixtures";

const file = (path: string, over: Partial<FileNode> = {}): FileNode => ({ path, module: ".", lines: 10, ...over });
const map = (paths: string[], edges: [string, string][] = []): ProjectMap => ({ root: "/p", files: paths.map((p) => file(p)), edges: edges.map(([from, to]) => ({ from, to })), modules: [] });
const step = (sessionId: string, seq: number, over: Partial<Step> = {}): Step => ({ id: `${sessionId}-${seq}`, sessionId, seq, ts: `2026-10-11T10:00:${String(seq % 60).padStart(2, "0")}.000Z`, kind: "text", text: "x", ...over });

describe("live store", () => {
  it("keeps threads newest first, and a session message moves its thread to the top", () => {
    const st = createLiveStore();
    st.dispatch({ type: "sessions", sessions: [session("a", { lastEventAt: "2026-10-11T10:00:01Z" }), session("b", { lastEventAt: "2026-10-11T10:00:05Z" })] });
    expect(st.get().sessions.map((s) => s.id)).toEqual(["b", "a"]);
    expect(st.get().sessionsLoaded).toBe(true);
    st.dispatch({ type: "session", session: session("a", { lastEventAt: "2026-10-11T10:00:09Z" }) });
    expect(st.get().sessions.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("adds live steps to a loaded thread only, once each, and finds them by id", () => {
    const st = createLiveStore();
    st.dispatch({ type: "step", step: step("t", 0) });
    expect(st.get().steps.t).toBeUndefined(); // not loaded: it comes with the fetch
    st.dispatch({ type: "steps", sessionId: "t", steps: [step("t", 0), step("t", 1)] });
    const before = st.get().steps;
    st.dispatch({ type: "step", step: step("t", 1) });
    expect(st.get().steps).toBe(before); // already there: nothing changes
    st.dispatch({ type: "step", step: step("t", 2) });
    expect(st.get().steps.t.map((s) => s.seq)).toEqual([0, 1, 2]);
    expect(st.stepOf("t-2")?.seq).toBe(2);
    expect(st.stepOf("nope")).toBeUndefined();
  });

  it("puts caught-up steps back in seq order with live ones that came meanwhile", () => {
    const st = createLiveStore();
    st.dispatch({ type: "steps", sessionId: "t", steps: [step("t", 0), step("t", 1)] });
    st.dispatch({ type: "step", step: step("t", 5) });
    st.dispatch({ type: "steps-more", sessionId: "t", steps: [step("t", 2), step("t", 3), step("t", 4), step("t", 5)] });
    expect(st.get().steps.t.map((s) => s.seq)).toEqual([0, 1, 2, 3, 4, 5]);
    for (const s of st.get().steps.t) expect(st.stepOf(s.id)).toBe(s);
  });

  it("relabels a step in place, leaving other threads' lists as they were", () => {
    const st = createLiveStore();
    st.dispatch({ type: "steps", sessionId: "t", steps: [step("t", 0), step("t", 1)] });
    st.dispatch({ type: "steps", sessionId: "u", steps: [step("u", 0)] });
    const u = st.get().steps.u, t0 = st.get().steps.t[0];
    st.dispatch({ type: "step-update", id: "t-1", label: "Read the parser", risk: ["touches auth"] });
    expect(st.get().steps.t[1]).toMatchObject({ label: "Read the parser", risk: ["touches auth"] });
    expect(st.get().steps.u).toBe(u);
    expect(st.get().steps.t[0]).toBe(t0);
  });

  it("bumps structureVersion when files come or go, not when one changes", () => {
    const st = createLiveStore();
    st.dispatch({ type: "map", map: map(["/p/a.ts", "/p/b.ts"], [["/p/a.ts", "/p/b.ts"]]) });
    const v = st.get().structureVersion;
    st.dispatch({ type: "file", file: file("/p/a.ts", { lines: 99, lastChangedAt: "2026-10-11T11:00:00Z" }) });
    expect(st.get().structureVersion).toBe(v);
    expect(st.get().map!.files[0].lines).toBe(99);
    st.dispatch({ type: "file", file: file("/p/c.ts"), edges: [{ from: "/p/c.ts", to: "/p/a.ts" }] });
    expect(st.get().structureVersion).toBe(v + 1);
    expect(st.get().map!.edges).toEqual(expect.arrayContaining([{ from: "/p/a.ts", to: "/p/b.ts" }, { from: "/p/c.ts", to: "/p/a.ts" }]));
    st.dispatch({ type: "file-removed", path: "/p/a.ts" });
    expect(st.get().structureVersion).toBe(v + 2);
    expect(st.get().map!.files.map((f) => f.path)).toEqual(["/p/b.ts", "/p/c.ts"]);
    expect(st.get().map!.edges).toEqual([]); // a removed file's imports go both ways
  });

  it("matches a from-scratch model after random file messages (indexes stay right)", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const r = rng(seed), st = createLiveStore();
      const paths = Array.from({ length: 12 }, (_, i) => `/p/f${i}.ts`);
      let files = paths.slice(0, 6), edges = new Map<string, string[]>();
      st.dispatch({ type: "map", map: map(files) });
      for (let k = 0; k < 80; k++) {
        const p = pick(r, paths);
        if (r() < 0.3) {
          st.enqueue({ type: "file-removed", path: p });
          if (!files.includes(p)) continue; // not on the map: nothing to remove
          files = files.filter((f) => f !== p);
          edges.delete(p);
          for (const [f, l] of edges) edges.set(f, l.filter((x) => x !== p));
        } else {
          const to = Array.from({ length: int(r, 3) }, () => pick(r, files.length ? files : paths)).filter((x, i, l) => l.indexOf(x) === i && x !== p);
          st.enqueue({ type: "file", file: file(p, { lines: int(r, 500) }), edges: to.map((x) => ({ from: p, to: x })) });
          if (!files.includes(p)) files = [...files, p];
          edges.set(p, to);
        }
        if (r() < 0.3) st.dispatch({ type: "connected", value: true }); // applies the queued batch
      }
      st.dispatch({ type: "connected", value: true });
      const m = st.get().map!;
      expect(m.files.map((f) => f.path), `seed ${seed}`).toEqual(files);
      const want = [...edges].flatMap(([from, l]) => l.map((to) => `${from}>${to}`)).sort();
      expect(m.edges.map((e) => `${e.from}>${e.to}`).sort(), `seed ${seed}`).toEqual(want);
    }
  });

  it("says a thread is running while attention says it works, whatever the log says", () => {
    const st = createLiveStore();
    st.dispatch({ type: "sessions", sessions: [session("a")] });
    st.dispatch({ type: "attention", attention: { sessionId: "a", state: "thinking", since: new Date().toISOString(), sure: true } });
    expect(st.get().sessions[0].status).toBe("running");
    st.dispatch({ type: "attention", attention: { sessionId: "a", state: "done", since: new Date().toISOString(), sure: true } });
    expect(st.get().sessions[0].status).toBe("idle");
  });

  it("forgets everything on reset", () => {
    const st = createLiveStore();
    st.dispatch({ type: "sessions", sessions: [session("a")] });
    st.dispatch({ type: "steps", sessionId: "a", steps: [step("a", 0)] });
    st.dispatch({ type: "reset" });
    expect(st.get()).toMatchObject({ sessions: [], steps: {}, map: null, agents: {}, attention: {}, sessionsLoaded: false });
    expect(st.stepOf("a-0")).toBeUndefined();
  });
});
