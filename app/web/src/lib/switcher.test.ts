// Which threads get a tab in the bar, and in which order (lib/switcher.ts).
import { describe, expect, it } from "vitest";
import type { Attention, AttentionState } from "@contract";
import { barThreads, forgetThread, rememberThread, rememberedThreads } from "./switcher";
import { session } from "../test/fixtures";

const NOW = Date.parse("2026-10-11T12:00:00Z");
const att = (sessionId: string, state: AttentionState): Attention => ({ sessionId, state, since: "2026-10-11T11:59:00Z", sure: true });
const at = (min: number) => new Date(Date.parse("2026-10-11T10:00:00Z") + min * 60_000).toISOString();
const ids = (l: { session: { id: string } }[]) => l.map((x) => x.session.id);

describe("the tab bar", () => {
  it("shows the open thread, those at work, waiting on you or done, and those opened lately; not the rest", () => {
    const sessions = [session("open", { startedAt: at(1) }), session("run", { startedAt: at(2), status: "running" }), session("ask", { startedAt: at(3) }),
      session("done", { startedAt: at(4) }), session("lately", { startedAt: at(5) }), session("old", { startedAt: at(6) }), session("stale", { startedAt: at(7) })];
    const attention = { ask: att("ask", "permission"), done: att("done", "done") };
    const mine = [{ id: "lately", at: NOW - 60_000 }, { id: "stale", at: NOW - 13 * 60 * 60_000 }];
    expect(ids(barThreads(sessions, attention, mine, [], "open", NOW))).toEqual(["open", "run", "ask", "done", "lately"]);
  });

  it("keeps a closed thread out, even running, until it needs you or is the open one", () => {
    const sessions = [session("a", { status: "running", startedAt: at(1) }), session("b", { startedAt: at(2) }), session("c", { startedAt: at(3) })];
    const shut = [{ id: "a", at: NOW - 1000 }, { id: "b", at: NOW - 1000 }, { id: "c", at: NOW - 1000 }];
    expect(ids(barThreads(sessions, { b: att("b", "question") }, [], shut, "c", NOW))).toEqual(["b", "c"]);
  });

  it("orders tabs by when the thread started, so a tab keeps its place and its number key", () => {
    const sessions = [session("late", { startedAt: at(9), status: "running" }), session("early", { startedAt: at(1), status: "running" })];
    expect(ids(barThreads(sessions, {}, [], [], null, NOW))).toEqual(["early", "late"]);
  });

  it("shows at most nine, keeping those that matter most", () => {
    const sessions = Array.from({ length: 12 }, (_, i) => session(`r${i}`, { status: "running", startedAt: at(i), lastEventAt: at(100 + i) }));
    sessions.push(session("blocked", { startedAt: at(50) }));
    const bar = ids(barThreads(sessions, { blocked: att("blocked", "permission") }, [], [], "r0", NOW));
    expect(bar).toHaveLength(9);
    expect(bar).toContain("r0");
    expect(bar).toContain("blocked");
    expect(bar).toContain("r11"); // the most recently active of the running ones
    expect(bar).not.toContain("r1");
  });

  it("remembers opening and closing per project: closing takes a thread out, opening it again brings it back", () => {
    rememberThread("/p", "x");
    expect(rememberedThreads("/p").mine?.map((r) => r.id)).toEqual(["x"]);
    forgetThread("/p", "x");
    expect(rememberedThreads("/p").mine).toEqual([]);
    expect(rememberedThreads("/p").shut?.map((r) => r.id)).toEqual(["x"]);
    rememberThread("/p", "x");
    expect(rememberedThreads("/p").shut).toEqual([]);
    expect(rememberedThreads("/q").mine).toBeUndefined();
  });
});
