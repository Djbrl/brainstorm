// Which agent ran a thread. "claude" is the default (every thread from before Codex support, and shared replays that
// lack the field), so only Codex threads get a mark in the app.
import type { Harness, Session } from "@contract";

/** A thread from outside (the server, a shared file) with its harness filled in: older ones lack it. */
export const withHarness = (s: Session): Session => (s.harness ? s : { ...s, harness: "claude" });
export const harnessOf = (s?: Pick<Session, "harness"> | null): Harness => s?.harness ?? "claude";
export const isCodex = (s?: Pick<Session, "harness"> | null) => harnessOf(s) === "codex";
export const harnessName = (h: Harness) => (h === "codex" ? "Codex" : "Claude Code");
