// Loads GET /api/cowork?sessionId= for one thread and shapes it for the view: change groups, verb names, area names.
import { useEffect, useState, useSyncExternalStore } from "react";
import type { CoworkArea, CoworkEvent, CoworkSummary, CoworkVerb } from "@contract";
import { isReplay, replayCowork } from "../lib/live";

/** The places of one thread (its subagents included). Refreshes while the thread is running. */
export function useCowork(sessionId: string | null, running: boolean, loaded = true) {
  const [data, setData] = useState<CoworkSummary | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    setData(null);
    if (!sessionId || !loaded) return;
    if (isReplay()) {                                   // hosted demo: the recording carries each thread's places
      setData(replayCowork(sessionId) ?? { areas: { web: 0, local: 0, services: 0, apps: 0 }, codeSteps: 0, sites: [], pages: [], events: [] });
      return;
    }
    let stop = false;
    const load = () => fetch(`/api/cowork?sessionId=${encodeURIComponent(sessionId)}`).then((r) => r.json()).then((d: CoworkSummary) => { if (!stop) { setData(d); setError(false); } }).catch(() => !stop && setError(true));
    load();
    const t = running ? setInterval(load, 8000) : undefined;
    return () => { stop = true; if (t) clearInterval(t); };
  }, [sessionId, running, loaded]);
  return { data, error };
}

export const AREA_NAME: Record<CoworkArea, string> = { web: "Web", local: "Your apps", services: "Services", apps: "Apps" };
export const AREAS: CoworkArea[] = ["web", "local", "services", "apps"];

export const VERB_NAME: Record<CoworkVerb, string> = {
  sent: "Sent", submitted: "Submitted", published: "Published", deployed: "Deployed", pushed: "Pushed",
  created: "Created", updated: "Edited", deleted: "Deleted", typed: "Typed", clicked: "Clicked",
};

/** The open thread's places, shared by the places map (canvas) and the list in the sidebar. */
/** `selected` is a place (or site) id on the map; `stepId` the step its panel shows. */
/** `row`: the list's row you went to (PlaceSteps), so several stretches in one moment of the thread can each be the one
 *  you're on: its index, the moment (the app's cursor), its newest event (null: a Your computer row) and its step (in
 *  the thread's step order, cowork/rows.ts). */
export type PlacesRow = { i: number; beat: number; event: string | null; step: number };
type PlacesState = { data: CoworkSummary | null; selected: string | null; stepId: string | null; highlight: string | null; row?: PlacesRow | null };
let places: PlacesState = { data: null, selected: null, stepId: null, highlight: null, row: null };
const subs = new Set<() => void>();
export const placesStore = {
  get: () => places,
  set(p: Partial<PlacesState>) { places = { ...places, ...p }; subs.forEach((f) => f()); },
  subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; },
};
export const usePlaces = () => useSyncExternalStore(placesStore.subscribe, placesStore.get);

/** The events at a place id: a page (`area|page`) or, for the map's site bubbles, a whole site (`area|site`). */
export const eventsAt = (data: CoworkSummary, id: string) => data.events.filter((e) => `${e.area}|${e.page}` === id || `${e.area}|${e.site}` === id);
/** The place (page) a step went to: its last one if it went to several. */
export function placeOfStep(data: CoworkSummary, stepId: string): string | null {
  const e = data.events.findLast((x) => x.stepId === stepId);
  return e ? `${e.area}|${e.page}` : null;
}
/** Select a place and show its newest step (or a given one) in the panel. */
export function selectPlace(id: string | null, stepId?: string) {
  const d = places.data;
  if (!id || !d) { placesStore.set({ selected: null, stepId: null }); return; }
  const at = eventsAt(d, id);
  placesStore.set({ selected: id, stepId: stepId ?? at[at.length - 1]?.stepId ?? null });
}

/** A stretch of steps in one place, in order (consecutive steps on the same page fold into one row). */
export type PlaceRun = { key: string; place: string; first: CoworkEvent; last: CoworkEvent; count: number; verbs: Map<CoworkVerb, number>; failed: number; stepIds: Set<string>; events: CoworkEvent[] };
export function placeRuns(events: CoworkEvent[]): PlaceRun[] {
  const runs: PlaceRun[] = [];
  for (const e of events) {
    const place = `${e.area}|${e.page}`;
    let r = runs[runs.length - 1];
    if (!r || r.place !== place) runs.push(r = { key: e.id, place, first: e, last: e, count: 0, verbs: new Map(), failed: 0, stepIds: new Set(), events: [] });
    r.last = e; r.count++; r.stepIds.add(e.stepId); r.events.push(e);
    if (e.failed) r.failed++;
    if (e.change && !e.failed && e.change.confidence !== "maybe") r.verbs.set(e.change.verb, (r.verbs.get(e.change.verb) ?? 0) + 1);
  }
  return runs;
}

export const placeTitle = (e: { title?: string; page: string; site: string }) =>
  e.title && e.title !== e.site ? e.title : e.page.replace(/^[^:]+:/, "").replace(e.site, "") || e.site;

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** "Your computer": where a thread is while it works in the code, between its trips out (and where it starts). The places
 *  map and its list (PlacesMap, PlaceSteps) put it beside the other places. */
export const HOME = "home";
export const HOME_NAME = "Your computer";

/** What a stretch in a place was, in one line: its most telling event's words (a change first, a click, typing, a send;
 *  then a search, then a fetch or a read, then a visit), as the step panel says it ('Searched "…"', 'Clicked "Envoyer"'). */
const TELLING: Record<CoworkEvent["action"], number> = { write: 6, click: 5, input: 4, search: 3, read: 2, visit: 1 };
export function runWords(r: PlaceRun): string {
  let best = r.events[0];
  for (const e of r.events) if (TELLING[e.action] > TELLING[best.action] || (e.change && !best.change)) best = e;
  const where = placeTitle(best);
  if (!best.what) return where;
  // Words that don't say which page ("Fetched with curl", "Opened the page"): the page beside them.
  return GENERIC.test(best.what) && where && where !== best.site ? `${best.what} · ${where}` : best.what;
}
const GENERIC = /^(Fetched with curl|Sent a request|Opened the page|Looked at the page|Clicked on the page|Read the page( text| structure)?|Ran a script on the page|Couldn't open the page)$/;
