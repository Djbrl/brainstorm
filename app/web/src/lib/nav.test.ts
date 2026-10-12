// Where you are (lib/nav.tsx): the links round trip, and the actions move between levels as Back and Esc expect.
import { beforeEach, describe, expect, it } from "vitest";
import { createNavStore, END, pathFor, readPlace, type Place } from "./nav";

const loc = globalThis.location as unknown as { pathname: string; search: string; hash: string };
const goTo = (path: string) => { loc.pathname = path; loc.search = ""; loc.hash = ""; };
beforeEach(() => goTo("/"));

describe("links", () => {
  const ids = ["abc", "a b", "100%", "x:y", "q?w", "h#t", "été", "s/lash"];
  const files = [null, "app/web/src/App.tsx", "dir with space/f.ts", "/Users/me/other/x.md", "100%.md"];
  it("read back as the place they were made for", () => {
    for (const thread of [null, ...ids]) for (const step of thread ? [null, ...ids] : [null]) for (const lens of ["map", "places"] as const)
      for (const file of files) {
        const p: Place = { thread, step, lens: thread ? lens : "map", file };
        goTo(pathFor(p));
        const back = readPlace();
        // A file shows in the link only on the map lens, without a step.
        const fileShown = file && !step && (!thread || lens === "map") ? file : null;
        expect({ ...back, file: back.file ?? null }, pathFor(p)).toEqual({ thread, step, lens: p.lens, file: fileShown });
      }
  });
  it("don't throw on a stray % typed by hand", () => {
    for (const raw of ["/file/100%.md", "/thread/abc%", "/thread/x/step/%E0%A4%A"]) { goTo(raw); expect(() => readPlace()).not.toThrow(); }
  });
  it("open old ?thread= links", () => {
    loc.pathname = "/"; loc.search = "?view=cowork&thread=t1&step=s1";
    expect(readPlace()).toEqual({ thread: "t1", step: "s1", lens: "places" });
  });
});

describe("nav store", () => {
  it("starts where the link points", () => {
    goTo("/thread/t1/step/s1");
    const d = createNavStore().get();
    expect(d.thread).toMatchObject({ sessionId: "t1", atStep: "s1", mode: "steps" });
    expect(d.step).toBe("s1");
    expect(d.cursor.index).toBe(END);
  });

  it("goes back up one level at a time: step, file, player, thread, project", () => {
    const { actions: a, get } = createNavStore();
    a.startReplay("t1", 3);
    a.setThreadMode("play");
    a.selectFile("src/a.ts");
    a.openStep("t1", "s9");
    a.back(); expect(get().step).toBeNull(); expect(get().file).toBe("src/a.ts");
    a.back(); expect(get().file).toBeNull(); expect(get().thread?.mode).toBe("play");
    a.back(); expect(get().thread?.mode).toBe("steps");
    a.back(); expect(get().thread).toBeNull();
  });

  it("moves the cursor without touching the open thread, and a hand move stops following live", () => {
    const { actions: a, get } = createNavStore();
    a.startReplay("t1", 0, { live: true });
    const thread = get().thread;
    a.followLive(5);
    expect(get().cursor.index).toBe(5);
    expect(get().thread).toBe(thread);
    a.setReplayIndex((i) => i - 10);
    expect(get().cursor.index).toBe(0); // never below the first beat
    expect(get().thread?.live).toBe(false);
    a.followLive(9);
    expect(get().cursor.index).toBe(0); // no longer live: following does nothing
  });

  it("tells listeners only when something changed", () => {
    const st = createNavStore();
    let heard = 0;
    st.subscribe(() => heard++);
    st.actions.selectFile("a");
    st.actions.selectFile("a");
    st.actions.closeStep();
    expect(heard).toBe(1);
  });

  it("toggles hidden agents and remembers them", () => {
    const { actions: a, get } = createNavStore();
    a.toggleAgent("x"); a.toggleAgent("y"); a.toggleAgent("x");
    expect([...get().hiddenAgents]).toEqual(["y"]);
    expect([...createNavStore().get().hiddenAgents]).toEqual(["y"]);
  });
});
