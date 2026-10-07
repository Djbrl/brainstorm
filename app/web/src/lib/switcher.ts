// Owner: switcher. Getting from one thread to another in one move: the threads in the tab bar (which, in which order),
// the threads you opened lately (remembered per project, per browser), and the threads at work in your other projects
// (GET /api/elsewhere, asked every few seconds while the page is in view).
import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { Attention, ElsewhereThread, Session } from "@contract";
import { isReplay, useLiveSelector, shallowEqual } from "./live";
import { needsYou, yourTurn } from "./attention";
import { END, type NavActions } from "./nav";
import { track } from "./usage";

// ---- opening a thread (the same move as a click in the Threads list) ----

/** Open a thread at its end; a running one keeps following its newest step. */
export function openThread(nav: Pick<NavActions, "startReplay">, s: Pick<Session, "id" | "status">) {
  const running = s.status === "running";
  nav.startReplay(s.id, running ? 0 : END, { live: running });
  track("th");
}

// ---- threads you opened lately ----

const RECENT_KEY = "rundown-recent-threads";
/** A thread you opened stays in the bar this long after you last opened it. */
const RECENT_MS = 12 * 60 * 60_000;
type Recent = Record<string, { id: string; at: number }[]>; // by project root

let recent: Recent = (() => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "{}") as Recent; } catch { return {}; } })();
const subs = new Set<() => void>();
const save = () => {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(recent)); } catch { /* kept for this visit only */ }
  subs.forEach((f) => f());
};

export function rememberThread(root: string, id: string) {
  const now = Date.now();
  const list = (recent[root] ?? []).filter((x) => x.id !== id && now - x.at < RECENT_MS);
  recent = { ...recent, [root]: [{ id, at: now }, ...list].slice(0, 20) };
  save();
}
export function forgetThread(root: string, id: string) {
  if (!recent[root]?.some((x) => x.id === id)) return;
  recent = { ...recent, [root]: recent[root].filter((x) => x.id !== id) };
  save();
}
const useRecent = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => recent);

// ---- the tab bar ----

export type BarThread = { session: Session; attention?: Attention; pinned: boolean };
/** The most tabs the bar shows (1 to 9 on the keyboard). */
const MAX_TABS = 9;

/**
 * The threads worth a tab: the open one, those at work or waiting on you, and those you opened in the last hours. In the
 * order they started, like a browser's tabs, so a thread keeps its place (and its number key) while others come and go.
 */
export function useBarThreads(openId: string | null): BarThread[] {
  const { sessions, attention, root } = useLiveSelector((s) => ({ sessions: s.sessions, attention: s.attention, root: s.setup?.root ?? "" }), shallowEqual);
  const mine = useRecent()[root];
  return useMemo(() => {
    const now = Date.now();
    const lately = new Map((mine ?? []).filter((x) => now - x.at < RECENT_MS).map((x) => [x.id, x.at]));
    const rank = (s: Session) => {
      const a = attention[s.id];
      if (s.id === openId) return 0;
      if (needsYou(a)) return 1;
      if (s.status === "running") return 2;
      if (yourTurn(a)) return 3;
      return 4;
    };
    const picked = sessions
      .filter((s) => s.id === openId || s.status === "running" || needsYou(attention[s.id]) || yourTurn(attention[s.id]) || lately.has(s.id))
      .sort((a, b) => rank(a) - rank(b) || (lately.get(b.id) ?? 0) - (lately.get(a.id) ?? 0) || b.lastEventAt.localeCompare(a.lastEventAt))
      .slice(0, MAX_TABS);
    return picked
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
      .map((session) => ({ session, attention: attention[session.id], pinned: session.status === "running" || needsYou(attention[session.id]) }));
  }, [sessions, attention, mine, openId]);
}

// ---- threads at work in other projects ----

const POLL_MS = 8_000;
let elsewhere: ElsewhereThread[] = [];
let pollers = 0, timer: ReturnType<typeof setTimeout> | undefined, asked = false;
const esubs = new Set<() => void>();

async function poll() {
  timer = undefined;
  if (!pollers) return;
  if (document.visibilityState === "visible" || !asked) { // once even in a background tab, then only while it's in view
    asked = true;
    try {
      const r = await fetch("/api/elsewhere");
      if (r.ok) {
        const next = (await r.json()) as ElsewhereThread[];
        if (JSON.stringify(next) !== JSON.stringify(elsewhere)) { elsewhere = next; esubs.forEach((f) => f()); }
      }
    } catch { /* the server is out of reach: keep what we had */ }
  }
  if (pollers && !timer) timer = setTimeout(poll, POLL_MS);
}
const onVisible = () => { if (document.visibilityState === "visible" && pollers) { if (timer) clearTimeout(timer); poll(); } };

/** Threads at work in the person's other projects (empty in a replay or a shared file). */
export function useElsewhere(): ElsewhereThread[] {
  useEffect(() => {
    if (isReplay()) return;
    if (pollers++ === 0) { poll(); document.addEventListener("visibilitychange", onVisible); }
    return () => {
      if (--pollers === 0) { if (timer) clearTimeout(timer); timer = undefined; document.removeEventListener("visibilitychange", onVisible); }
    };
  }, []);
  return useSyncExternalStore((f) => { esubs.add(f); return () => { esubs.delete(f); }; }, () => elsewhere);
}

/** Switch the server to another project, then open one of its threads there. */
export async function jumpElsewhere(t: ElsewhereThread, nav: Pick<NavActions, "startReplay" | "stopReplay" | "selectFile">, reload: () => void) {
  const r = await fetch("/api/workspace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ root: t.root }) });
  if (!r.ok) throw new Error(`switch failed: ${r.status}`);
  nav.stopReplay(); nav.selectFile(null);
  reload();
  // The other project's thread list comes with the reload; a thread that works is followed live, one that waits opens at its end.
  openThread(nav, { id: t.sessionId, status: t.state === "working" ? "running" : "idle" });
  elsewhere = elsewhere.filter((x) => x.root !== t.root); esubs.forEach((f) => f());
  if (timer) clearTimeout(timer);
  poll();
}

/**
 * Open another project (an island on the map), keeping the thread you had open: it shows there too, as a visitor, since
 * it touched that project's files.
 */
export async function enterProject(root: string, nav: Pick<NavActions, "startReplay" | "stopReplay" | "selectFile">, reload: () => void, threadId?: string) {
  const r = await fetch("/api/workspace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ root, ...(threadId ? { guest: threadId } : {}) }) });
  if (!r.ok) throw new Error(`switch failed: ${r.status}`);
  nav.stopReplay(); nav.selectFile(null);
  reload();
  if (threadId) nav.startReplay(threadId, END, {});
}
