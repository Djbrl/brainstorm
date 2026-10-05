// Owned by the lead. Where you are in the app, and the links for it.
//
// Three levels, one at a time:
//   /                                   the project: the map at rest, live agents as dots, what changed since you last looked
//   /thread/<id>                        one thread on the map, its steps in the sidebar's Track tab, at the end (a running one
//                                       follows live); its replay from the footer
//   /thread/<id>/step/<stepId>          one step, in a side panel (its diff, its output, Ask)
//   …/file/<path>                       a file open in the side panel (its path from the project root), on the project or a thread's map
// A thread can be seen two ways, the lens: /thread/<id> (the map) and /thread/<id>/places. Links from when Track was a
// view of its own (/thread/<id>/track) open the map.
// Opening or closing a thread, a step or a lens adds a browser history entry, so Back and Esc go up one level. Moving
// through a replay doesn't. A file opened from disk (a shared replay) keeps the same paths after a `#`.
//
// The state lives in a small external store; every action changes it in one step. Reading it:
//   useNavActions()           every setter (startReplay, openStep, back…). Never changes, so it never re-renders you.
//   useNavState()             where you are (thread, step, file, lens, hidden agents, reads) without the replay cursor:
//                             its `replay` has no `index`/`playing`. Moving through a replay doesn't re-render you.
//   useReplayCursor(sel?)     the cursor { index, playing }, or a slice of it (e.g. c => c.index === 0).
//   useNavSelector(sel, eq?)  any slice of the raw state.
//   useNav()                  all of it in the old shape: renders again on every change, the cursor included.
// Migrating a component: split `const { replay, startReplay } = useNav()` into useNavState() + useNavActions(), and
// read `index`/`playing` with useReplayCursor only where they're drawn (ideally a small child component).
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { ReplayDetail } from "./thread";
import { listeners, shallowEqual, useStoreSelector } from "./store";

/** How a thread is shown: where it happened in the code, or the places it went outside the code. */
export type Lens = "map" | "places";
export type ReplaySpeed = 1 | 2 | 4;
/**
 * How much of an open thread is out: its steps as a list (what opening a thread shows), or the replay with its player
 * (from the footer). "footprint", the files it touched all lit at once with no tracer, is no longer opened by the UI.
 */
export type ThreadMode = "footprint" | "steps" | "play";
/** Open a thread at its end: the index is clamped to its last moment once it loads (a running one then follows live). */
export const END = Number.MAX_SAFE_INTEGER;
/**
 * An open thread. `index` is the current beat (see lib/thread.ts) in `detail` mode.
 * `atStep` is a step id to land on once the thread is built (links, switching detail); the replay layer resolves and clears it.
 */
export type ThreadReplay = { sessionId: string; index: number; playing: boolean; speed: ReplaySpeed; detail: ReplayDetail; mode: ThreadMode; atStep?: string; live?: boolean };
/** The open thread without its cursor (see useNavState). */
export type OpenThread = Omit<ThreadReplay, "index" | "playing">;
/** The replay cursor: the beat it's on and whether it plays. */
export type ReplayCursor = { index: number; playing: boolean };

/**
 * Map display prefs read by the canvas layers (live agents, thread replay) on every frame.
 * Kept in sync with the `showReads` nav state; mutate only through setShowReads.
 */
export const mapPrefs: { showReads: boolean } = { showReads: true };

/** The step id at the replay cursor, published by the replay layer while rendering. */
export const replayCursor: { stepId: string | null } = { stepId: null };

type Nav = {
  focusFile: string | null; setFocusFile: (p: string | null) => void;
  /** Select a file on the map. */
  openFile: (path: string) => void;
  /** The file open in the side panel, as a path from the project root (it's in the link), or null. See map/FilePanel. */
  file: string | null;
  /** Open a file in the panel (a path from the project root), or close it with null. */
  selectFile: (rel: string | null) => void;

  /** The open thread, or null on the project overview. */
  replay: ThreadReplay | null;
  /** Open a thread: its footprint unless `mode` says otherwise, landing on a beat index or on the beat holding a step id. `live` follows its newest step; `lens` switches the view too. */
  startReplay: (sessionId: string, at?: number | string, opts?: { live?: boolean; mode?: ThreadMode; lens?: Lens }) => void;
  /** Show more or less of the open thread (footprint → steps → play). */
  setThreadMode: (mode: ThreadMode) => void;
  /** Keep a live replay on the newest beat (called as the thread grows). */
  followLive: (index: number) => void;
  /** Go back to following a running thread live, or stop following. */
  setReplayLive: (live: boolean) => void;
  lens: Lens; setLens: (l: Lens) => void;
  /** Move the replay cursor. The caller clamps to the thread length. */
  setReplayIndex: (i: number | ((prev: number) => number)) => void;
  setReplayPlaying: (playing: boolean) => void;
  setReplaySpeed: (speed: ReplaySpeed) => void;
  /** Switch between the light replay (summaries) and every step, staying on the same step. */
  setReplayDetail: (detail: ReplayDetail, atStep?: string) => void;
  /** Clear `atStep` after landing on it, at `index`. */
  landReplay: (index: number) => void;
  /** Close the thread: back to the project. */
  stopReplay: () => void;

  /** The step open in the side panel, or null. */
  step: string | null;
  /** Open a step of a thread in the side panel (opening the thread first if needed). */
  openStep: (sessionId: string, stepId: string) => void;
  /** Show another step of the open thread in the panel as the cursor moves (scrolling, scrubbing): no new history entry. */
  showStep: (stepId: string) => void;
  closeStep: () => void;
  /** Up one level: step → file → player → thread → project. */
  back: () => void;

  /** Agents hidden from the map (agent ids: sessionId for main threads, agentId for subagents). */
  hiddenAgents: ReadonlySet<string>;
  toggleAgent: (id: string) => void;
  setHiddenAgents: (ids: Iterable<string>) => void;

  /** Map: draw reads (lines of sight, read flashes) or only writes. Remembered per browser. */
  showReads: boolean;
  setShowReads: (v: boolean) => void;
};

/** Every setter of Nav. */
export type NavActions = Pick<Nav, "setFocusFile" | "openFile" | "selectFile" | "startReplay" | "setThreadMode" | "followLive" | "setReplayLive"
  | "setLens" | "setReplayIndex" | "setReplayPlaying" | "setReplaySpeed" | "setReplayDetail" | "landReplay" | "stopReplay" | "openStep"
  | "showStep" | "closeStep" | "back" | "toggleAgent" | "setHiddenAgents" | "setShowReads">;

/** The store's state: the open thread and its cursor are kept apart, so moving the cursor leaves `thread` as it was. */
export type NavData = {
  focusFile: string | null;
  file: string | null;
  step: string | null;
  lens: Lens;
  thread: OpenThread | null;
  cursor: ReplayCursor;
  hiddenAgents: ReadonlySet<string>;
  showReads: boolean;
};
/** Where you are, without the replay cursor. */
export type NavState = Omit<NavData, "thread" | "cursor"> & { replay: OpenThread | null };

type NavStore = {
  get: () => NavData;
  subscribe: (l: () => void) => () => void;
  actions: NavActions;
  /** Set by actions, read by the URL effect: the move came from the URL / shouldn't add a history entry. */
  flags: { fromUrl: boolean; replaceNext: boolean };
};
const Ctx = createContext<NavStore | null>(null);

const HIDDEN_KEY = "brainstorm-hidden-agents";
const READS_KEY = "brainstorm-map-show-reads";
function loadShowReads(): boolean {
  try { return localStorage.getItem(READS_KEY) !== "0"; } catch { return true; }
}
function loadHidden(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]") as string[]); } catch { return new Set(); }
}

// ---- links ----

type Place = { thread: string | null; step: string | null; lens: Lens; file?: string | null };
const hashMode = typeof location !== "undefined" && location.protocol === "file:"; // a shared .html opened from disk

/** The query a hosted demo needs on every link (?replay=…), kept as is. */
function keptQuery(): string {
  const replay = new URLSearchParams(location.search).get("replay");
  return replay ? `?${new URLSearchParams({ replay })}` : "";
}

/** A file's link keeps its slashes: /file/app/web/src/App.tsx. */
const filePart = (f: string) => `/file/${f.split("/").map(encodeURIComponent).join("/")}`;

export function pathFor(p: Place): string {
  // A file is on the map: it shows in the link on the Map lens, when no step covers it.
  const file = p.file && !p.step && (!p.thread || p.lens === "map") ? filePart(p.file) : "";
  if (!p.thread) return file || "/";
  let path = `/thread/${encodeURIComponent(p.thread)}${p.lens === "map" ? "" : `/${p.lens}`}`;
  if (p.step) path += `/step/${encodeURIComponent(p.step)}`;
  return path + file;
}

function readPlace(): Place {
  const raw = hashMode ? location.hash.replace(/^#/, "") || "/" : location.pathname;
  const m = /^(?:\/thread\/([^/]+)(?:\/(map|track|places))?(?:\/step\/([^/]+))?)?(?:\/file\/(.+?))?\/?$/.exec(raw);
  if (m && (m[1] || m[4])) {
    const file = m[4] ? m[4].split("/").map(decodeURIComponent).join("/") : null;
    return { thread: m[1] ? decodeURIComponent(m[1]) : null, lens: m[2] === "places" ? "places" : "map", step: m[3] ? decodeURIComponent(m[3]) : null, file };
  }
  // Links from before the paths: ?view=map&lens=places&thread=<id>&step=<id> (and ?view=cowork for Places).
  const q = new URLSearchParams(location.search), thread = q.get("thread");
  const lens: Lens = q.get("lens") === "places" || q.get("view") === "cowork" ? "places" : "map";
  return { thread, step: thread ? q.get("step") : null, lens: thread ? lens : "map" };
}

const hrefFor = (p: Place) => (hashMode ? `${location.pathname}${keptQuery()}#${pathFor(p)}` : `${pathFor(p)}${keptQuery()}`);
const hereHref = () => (hashMode ? `${location.pathname}${location.search}${location.hash || "#/"}` : `${location.pathname}${location.search}`);

/** The open thread with its cursor, as Nav's `replay`. */
const joinReplay = (t: OpenThread | null, c: ReplayCursor): ThreadReplay | null => (t ? { ...t, index: c.index, playing: c.playing } : null);

function createNavStore(): NavStore {
  const first = readPlace();
  let data: NavData = {
    focusFile: null,
    file: first.file ?? null,
    step: first.step,
    lens: first.lens,
    thread: first.thread ? { sessionId: first.thread, speed: 1, detail: "light", mode: "steps", atStep: first.step ?? undefined } : null,
    cursor: { index: first.thread ? END : 0, playing: false },
    hiddenAgents: loadHidden(),
    showReads: (mapPrefs.showReads = loadShowReads()),
  };
  const { subscribe, emit } = listeners();
  // The first render matches the URL already (an old ?view= link is rewritten in place).
  const flags = { fromUrl: true, replaceNext: false };

  /** Change several fields in one step (one render for everyone reading them). */
  const set = (patch: Partial<NavData>) => {
    let changed = false;
    for (const k in patch) if (!Object.is(patch[k as keyof NavData], data[k as keyof NavData])) { changed = true; break; }
    if (!changed) return;
    data = { ...data, ...patch };
    emit();
  };
  /** The old `setReplay(r => …)`: the thread and cursor keep their identity when their fields didn't change. */
  const replayPatch = (fn: (r: ThreadReplay | null) => ThreadReplay | null): Partial<NavData> => {
    const r = joinReplay(data.thread, data.cursor), n = fn(r);
    if (n === r) return {};
    if (!n) return { thread: null };
    const { index, playing, ...rest } = n;
    return {
      thread: shallowEqual<OpenThread | null>(rest, data.thread) ? data.thread : rest,
      cursor: index === data.cursor.index && playing === data.cursor.playing ? data.cursor : { index, playing },
    };
  };
  const setReplay = (fn: (r: ThreadReplay | null) => ThreadReplay | null) => set(replayPatch(fn));

  const setShowReads = (v: boolean) => {
    mapPrefs.showReads = v;
    set({ showReads: v });
    try { localStorage.setItem(READS_KEY, v ? "1" : "0"); } catch { /* storage blocked: resets on reload */ }
  };
  const setHidden = (h: ReadonlySet<string>) => {
    set({ hiddenAgents: h });
    try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...h])); } catch { /* storage blocked: hidden agents reset on reload */ }
  };

  const startReplay: NavActions["startReplay"] = (sid, at = 0, opts) => set({
    ...replayPatch((r) => ({
      sessionId: sid, playing: false, speed: r?.speed ?? 1, detail: r?.detail ?? "light", mode: opts?.mode ?? "steps",
      index: typeof at === "number" ? Math.max(0, at) : 0, atStep: typeof at === "string" ? at : undefined, live: !!opts?.live,
    })),
    step: null,
    ...(opts?.lens && { lens: opts.lens }),
  });
  // Back on the project, the lens is the map again (a thread opened from the map, like the Welcome replay, stays there).
  const stopReplay = () => { replayCursor.stepId = null; set({ thread: null, step: null, lens: "map" }); };
  const setThreadMode = (mode: ThreadMode) => setReplay((r) => (r ? { ...r, mode, playing: mode === "play" ? r.playing : false } : r));

  const actions: NavActions = {
    setFocusFile: (p) => set({ focusFile: p }),
    openFile: (p) => set({ focusFile: p, lens: "map" }),
    selectFile: (rel) => set({ file: rel }),
    startReplay,
    stopReplay,
    setThreadMode,
    setLens: (l) => set({ lens: l, step: null }),
    // Moving the cursor by hand stops following live; followLive is the only setter that keeps it.
    setReplayIndex: (i) => setReplay((r) => (r ? { ...r, live: false, index: Math.max(0, typeof i === "function" ? i(r.index) : i) } : r)),
    followLive: (i) => setReplay((r) => (r && r.live && r.index !== i ? { ...r, index: Math.max(0, i), atStep: undefined } : r)),
    setReplayLive: (live) => setReplay((r) => (r ? { ...r, live, playing: false, mode: r.mode === "footprint" ? "steps" : r.mode } : r)),
    setReplayPlaying: (playing) => setReplay((r) => (r ? { ...r, playing, live: playing ? false : r.live, mode: playing ? "play" : r.mode } : r)),
    setReplaySpeed: (speed) => setReplay((r) => (r ? { ...r, speed } : r)),
    setReplayDetail: (detail, atStep) => setReplay((r) => (r ? { ...r, detail, playing: false, atStep: atStep ?? replayCursor.stepId ?? undefined } : r)),
    landReplay: (index) => setReplay((r) => (r ? { ...r, index: Math.max(0, index), atStep: undefined } : r)),
    openStep: (sid, stepId) => set({
      ...replayPatch((r) => (r && r.sessionId === sid
        ? { ...r, atStep: stepId, playing: false, live: false, mode: r.mode === "footprint" ? "steps" : r.mode }
        : { sessionId: sid, index: 0, playing: false, speed: r?.speed ?? 1, detail: r?.detail ?? "light", mode: "steps", atStep: stepId })),
      step: stepId,
    }),
    showStep: (stepId) => { flags.replaceNext = true; set({ step: stepId }); },
    closeStep: () => set({ step: null }),
    back: () => {
      const { step, file, lens, thread } = data;
      if (step) { set({ step: null }); return; }
      if (file && lens === "map") { set({ file: null }); return; }
      if (thread?.mode === "play") { setThreadMode("steps"); return; }
      if (thread) stopReplay();
    },
    toggleAgent: (id) => { const n = new Set(data.hiddenAgents); if (n.has(id)) n.delete(id); else n.add(id); setHidden(n); },
    setHiddenAgents: (ids) => setHidden(new Set(ids)),
    setShowReads,
  };

  // Back and Forward: go where the URL says.
  if (typeof window !== "undefined") {
    addEventListener(hashMode ? "hashchange" : "popstate", () => {
      const p = readPlace();
      flags.fromUrl = true;
      set({
        lens: p.lens, step: p.step, file: p.file ?? null,
        ...replayPatch((r) => {
          if (!p.thread) { replayCursor.stepId = null; return null; }
          if (r && r.sessionId === p.thread) return p.step ? { ...r, atStep: p.step, playing: false, mode: r.mode === "footprint" ? "steps" : r.mode } : r;
          return { sessionId: p.thread, index: END, playing: false, speed: r?.speed ?? 1, detail: r?.detail ?? "light", mode: "steps", atStep: p.step ?? undefined };
        }),
      });
    });
  }

  return { get: () => data, subscribe, actions, flags };
}

// One store per page: the URL is one too (and Back/Forward listen for the page's whole life).
let pageStore: NavStore | null = null;

export function NavProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => (pageStore ??= createNavStore()));
  // The URL follows the place (thread, lens, step): a new history entry per move, except when the move came from the URL.
  const place = useStoreSelector(store, (d) => ({ thread: d.thread?.sessionId ?? null, step: d.step, lens: d.lens, file: d.file }), shallowEqual);
  const { thread, step, lens, file } = place;
  useEffect(() => {
    const href = hrefFor({ thread, step: thread ? step : null, lens: thread ? lens : "map", file });
    if (href !== hereHref()) {
      if (store.flags.fromUrl || store.flags.replaceNext) history.replaceState(null, "", href);
      else history.pushState(null, "", href);
    }
    store.flags.fromUrl = false;
    store.flags.replaceNext = false;
  }, [store, thread, step, lens, file]);
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

function useStore(): NavStore {
  const store = useContext(Ctx);
  if (!store) throw new Error("nav used outside NavProvider");
  return store;
}

/** Every nav setter. The same object for the page's life: reading it never re-renders a component. */
export function useNavActions(): NavActions {
  return useStore().actions;
}

/** A slice of the nav state: renders again only when it changes (by `eq`, Object.is by default). */
export function useNavSelector<T>(select: (d: NavData) => T, eq?: (a: T, b: T) => boolean): T {
  return useStoreSelector(useStore(), select, eq);
}

const placeOf = (d: NavData): NavState => ({ focusFile: d.focusFile, file: d.file, step: d.step, lens: d.lens, replay: d.thread, hiddenAgents: d.hiddenAgents, showReads: d.showReads });
/** Where you are, without the replay cursor: moving through a replay doesn't re-render you. */
export function useNavState(): NavState {
  return useStoreSelector(useStore(), placeOf, shallowEqual);
}

const wholeCursor = (c: ReplayCursor) => c;
/** The replay cursor ({ index, playing }), or a slice of it. */
export function useReplayCursor(): ReplayCursor;
export function useReplayCursor<T>(select: (c: ReplayCursor) => T, eq?: (a: T, b: T) => boolean): T;
export function useReplayCursor<T>(select: (c: ReplayCursor) => T = wholeCursor as (c: ReplayCursor) => T, eq?: (a: T, b: T) => boolean): T {
  return useStoreSelector(useStore(), (d) => select(d.cursor), eq);
}

/** Everything, in one object: renders again on every change, the replay cursor included. Prefer the narrower hooks above. */
export function useNav(): Nav {
  const store = useStore();
  const d = useSyncExternalStore(store.subscribe, store.get, store.get);
  const replay = useMemo(() => joinReplay(d.thread, d.cursor), [d.thread, d.cursor]);
  return useMemo(() => ({
    ...store.actions,
    focusFile: d.focusFile, file: d.file, step: d.step, lens: d.lens, hiddenAgents: d.hiddenAgents, showReads: d.showReads, replay,
  }), [store, d, replay]);
}
