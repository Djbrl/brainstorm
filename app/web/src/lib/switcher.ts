// Getting from one thread to another in one move: the threads in the tab bar (which, in which order),
// the threads you opened lately (remembered per project, per browser), and the threads at work in your other projects
// (GET /api/elsewhere, asked every few seconds while the page is in view).
import { useEffect, useMemo } from "react";
import type { Attention, ElsewhereThread, Session } from "@contract";
import { isRecording, useLiveSelector, shallowEqual } from "./live";
import { needsYou, yourTurn } from "./attention";
import { END, type NavActions } from "./nav";
import { track } from "./usage";
import { ApiError, get, post } from "./api";
import { createAtom } from "./store";

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

const json = { parse: (v: string) => JSON.parse(v) as Recent, serialize: (v: Recent) => JSON.stringify(v) };
const recent = createAtom<Recent>({}, { key: RECENT_KEY, ...json }); // storage blocked: kept for this visit only

// Threads you closed in the bar stay out of it, even while they work, until you open them again or they need you.
const CLOSED_KEY = "rundown-closed-threads";
const closed = createAtom<Recent>({}, { key: CLOSED_KEY, ...json });

export function rememberThread(root: string, id: string) {
  const now = Date.now();
  if (closed.get()[root]?.some((x) => x.id === id)) closed.set((c) => ({ ...c, [root]: c[root].filter((x) => x.id !== id) }));
  recent.set((r) => ({ ...r, [root]: [{ id, at: now }, ...(r[root] ?? []).filter((x) => x.id !== id && now - x.at < RECENT_MS)].slice(0, 20) }));
}
/** Close a thread's tab: out of the bar, a running one too, until you open it again or it needs you. */
export function forgetThread(root: string, id: string) {
  const now = Date.now();
  closed.set((c) => ({ ...c, [root]: [{ id, at: now }, ...(c[root] ?? []).filter((x) => x.id !== id && now - x.at < RECENT_MS)].slice(0, 40) }));
  recent.set((r) => ({ ...r, [root]: (r[root] ?? []).filter((x) => x.id !== id) }));
}

// ---- the tab bar ----

export type BarThread = { session: Session; attention?: Attention };
/** The most tabs the bar shows (1 to 9 on the keyboard). */
const MAX_TABS = 9;

/**
 * The threads worth a tab: the open one, those at work or waiting on you, and those you opened in the last hours, but
 * not those you closed (unless they need you). In the order they started, like a browser's tabs, so a thread keeps its place (and its number key) while others come and go.
 */
export function useBarThreads(openId: string | null): BarThread[] {
  const { sessions, attention, root } = useLiveSelector((s) => ({ sessions: s.sessions, attention: s.attention, root: s.setup?.root ?? "" }), shallowEqual);
  const mine = recent.use()[root], shut = closed.use()[root];
  return useMemo(() => {
    const now = Date.now();
    const lately = new Map((mine ?? []).filter((x) => now - x.at < RECENT_MS).map((x) => [x.id, x.at]));
    const gone = new Set((shut ?? []).filter((x) => now - x.at < RECENT_MS).map((x) => x.id));
    const rank = (s: Session) => {
      const a = attention[s.id];
      if (s.id === openId) return 0;
      if (needsYou(a)) return 1;
      if (s.status === "running") return 2;
      if (yourTurn(a)) return 3;
      return 4;
    };
    const picked = sessions
      .filter((s) => s.id === openId || needsYou(attention[s.id])
        || (!gone.has(s.id) && (s.status === "running" || yourTurn(attention[s.id]) || lately.has(s.id))))
      .sort((a, b) => rank(a) - rank(b) || (lately.get(b.id) ?? 0) - (lately.get(a.id) ?? 0) || b.lastEventAt.localeCompare(a.lastEventAt))
      .slice(0, MAX_TABS);
    return picked
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
      .map((session) => ({ session, attention: attention[session.id] }));
  }, [sessions, attention, mine, shut, openId]);
}

// ---- threads at work in other projects ----

const POLL_MS = 8_000;
const elsewhere = createAtom<ElsewhereThread[]>([]);
let pollers = 0, timer: ReturnType<typeof setTimeout> | undefined, asked = false;

async function poll() {
  timer = undefined;
  if (!pollers) return;
  if (document.visibilityState === "visible" || !asked) { // once even in a background tab, then only while it's in view
    asked = true;
    try {
      const next = await get<ElsewhereThread[]>("/api/elsewhere");
      if (JSON.stringify(next) !== JSON.stringify(elsewhere.get())) elsewhere.set(next);
    } catch { /* the server is out of reach: keep what we had */ }
  }
  if (pollers && !timer) timer = setTimeout(poll, POLL_MS);
}
const onVisible = () => { if (document.visibilityState === "visible" && pollers) { if (timer) clearTimeout(timer); poll(); } };

/** Threads at work in the person's other projects (empty in a replay or a shared file). */
export function useElsewhere(): ElsewhereThread[] {
  useEffect(() => {
    if (isRecording()) return;
    if (pollers++ === 0) { poll(); document.addEventListener("visibilitychange", onVisible); }
    return () => {
      if (--pollers === 0) { if (timer) clearTimeout(timer); timer = undefined; document.removeEventListener("visibilitychange", onVisible); }
    };
  }, []);
  return elsewhere.use();
}

/** Switch the server to another project, then open one of its threads there. */
export async function jumpElsewhere(t: ElsewhereThread, nav: Pick<NavActions, "startReplay" | "stopReplay" | "selectFile">, reload: () => void) {
  await post("/api/workspace", { root: t.root });
  nav.stopReplay(); nav.selectFile(null);
  reload();
  // The other project's thread list comes with the reload; a thread that works is followed live, one that waits opens at its end.
  openThread(nav, { id: t.sessionId, status: t.state === "working" ? "running" : "idle" });
  elsewhere.set((l) => l.filter((x) => x.root !== t.root));
  if (timer) clearTimeout(timer);
  poll();
}

/**
 * Open another project (an island on the map), keeping the thread you had open: it shows there too, as a visitor, since
 * it touched that project's files.
 */
export async function enterProject(root: string, nav: Pick<NavActions, "startReplay" | "stopReplay" | "selectFile">, reload: () => void, threadId?: string, landOn?: string) {
  const open = (anyway: boolean) => post("/api/workspace", { root, ...(threadId ? { guest: threadId } : {}), ...(anyway ? { anyway } : {}) });
  try { await open(false); }
  catch (e) {
    // A big folder that isn't a git project: the server asks first (WorkspaceService.checkSize); so do we.
    if (!(e instanceof ApiError) || e.status !== 409) throw e;
    if (e.code !== "large" || !confirm(e.said ?? "This folder is big. Open it anyway?")) return;
    await open(true);
  }
  nav.stopReplay(); nav.selectFile(null);
  reload();
  // On its last step in that project (the camera and the Track land there), else at its end.
  if (threadId) nav.startReplay(threadId, landOn ?? END, {});
}
