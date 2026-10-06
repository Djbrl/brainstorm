// Owner: attention. Threads waiting on you: words for each state, the tab title, and desktop notifications.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Attention, AttentionState } from "@contract";
import { useLive } from "./live";

/** States where the agent can't go on without you. "done" (your turn) is softer: it finished, nothing is blocked. */
export const BLOCKED: ReadonlySet<AttentionState> = new Set(["permission", "question", "plan", "stuck"]);
export const needsYou = (a?: Attention | null) => !!a && BLOCKED.has(a.state);
export const yourTurn = (a?: Attention | null) => !!a && a.state === "done";

const toolWord = (tool?: string) => {
  if (!tool) return "a tool";
  if (tool === "Bash") return "a command";
  if (tool === "Edit" || tool === "MultiEdit" || tool === "Write" || tool === "NotebookEdit") return "an edit";
  if (tool === "Read") return "reading a file";
  if (tool === "WebFetch") return "opening a page";
  if (tool === "WebSearch") return "a web search";
  return tool.replace(/^mcp__.+?__/, "").replace(/_/g, " ");
};

/** Short badge text ("Needs you") and a sentence for the step list and notifications. */
export function attentionText(a: Attention): { badge: string; line: string; title: string } {
  const who = a.agentId ? "A subagent" : "The agent";
  switch (a.state) {
    case "permission": return {
      badge: "Needs you", title: "Waiting for your permission",
      line: `${a.sure ? "Waiting" : "Probably waiting"} for your OK to run ${toolWord(a.tool)}`,
    };
    case "question": return { badge: "Needs you", title: "Asked you a question", line: `${who} asked you a question` };
    case "plan": return { badge: "Needs you", title: "Waiting for plan approval", line: `${who} wrote a plan and waits for your approval` };
    case "stuck": return { badge: "Stuck", title: "Stuck on a failing step", line: `${toolWord(a.tool).replace(/^./, (c) => c.toUpperCase())} failed 3 times in a row` };
    case "done": return { badge: "Your turn", title: "Finished, your turn", line: `${who} finished and is waiting for your next message` };
    default: return { badge: "", title: "", line: "" };
  }
}

const NOTIFY_KEY = "rundown-notify";
const notifyPref = () => { try { return localStorage.getItem(NOTIFY_KEY) === "1"; } catch { return false; } };

/** Desktop notifications, opt-in per browser. */
export function useNotifyPref() {
  const [on, setOn] = useState(() => notifyPref() && typeof Notification !== "undefined" && Notification.permission === "granted");
  const toggle = useCallback(async () => {
    if (typeof Notification === "undefined") return;
    let next = !on;
    if (next && Notification.permission !== "granted") next = (await Notification.requestPermission()) === "granted";
    try { localStorage.setItem(NOTIFY_KEY, next ? "1" : "0"); } catch { /* storage blocked: lasts until reload */ }
    setOn(next);
  }, [on]);
  return { on, toggle, supported: typeof Notification !== "undefined" };
}

/**
 * Mounted once. Puts the count of threads that need you in the tab title, and notifies when a thread starts waiting
 * (or finishes its turn) while this tab isn't in front.
 */
export function useAttentionAlerts(onOpen: (sessionId: string) => void) {
  const { state } = useLive();
  const seen = useRef(new Map<string, string>());
  const openRef = useRef(onOpen); openRef.current = onOpen;

  const waiting = Object.values(state.attention).filter(needsYou);
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\) /, "");
    document.title = waiting.length ? `(${waiting.length}) ${base}` : base;
  }, [waiting.length]);

  useEffect(() => {
    const titles = new Map(state.sessions.map((s) => [s.id, s.title || "A thread"]));
    for (const a of Object.values(state.attention)) {
      const key = `${a.state}|${a.since}`;
      if (seen.current.get(a.sessionId) === key) continue;
      seen.current.set(a.sessionId, key);
      // Only fresh states (not old ones found on page load), not guesses, and not while you're looking at Rundown.
      if (Date.now() - Date.parse(a.since) > 60_000 || !(needsYou(a) || yourTurn(a)) || (!a.sure && a.state !== "stuck")) continue;
      if (!notifyPref() || typeof Notification === "undefined" || Notification.permission !== "granted" || document.visibilityState === "visible") continue;
      const t = attentionText(a);
      const n = new Notification(`${titles.get(a.sessionId)}: ${t.title}`, { body: a.detail ? `${t.line}\n${a.detail}` : t.line, tag: `rundown-${a.sessionId}` });
      n.onclick = () => { window.focus(); openRef.current(a.sessionId); n.close(); };
    }
  }, [state.attention, state.sessions]);
}
