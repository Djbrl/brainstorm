// Owner: cowork. Loads GET /api/cowork?sessionId= for one thread and shapes it for the view: change groups, verb names, area names.
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
type PlacesState = { data: CoworkSummary | null; selected: string | null; stepId: string | null; highlight: string | null };
let places: PlacesState = { data: null, selected: null, stepId: null, highlight: null };
const subs = new Set<() => void>();
export const placesStore = {
  get: () => places,
  set(p: Partial<PlacesState>) { places = { ...places, ...p }; subs.forEach((f) => f()); },
  subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; },
};
export const usePlaces = () => useSyncExternalStore(placesStore.subscribe, placesStore.get);

/** The events at a place id: a page (`area|page`) or, for the map's site bubbles, a whole site (`area|site`). */
export const eventsAt = (data: CoworkSummary, id: string) => data.events.filter((e) => `${e.area}|${e.page}` === id || `${e.area}|${e.site}` === id);
/** Select a place and show its newest step (or a given one) in the panel. */
export function selectPlace(id: string | null, stepId?: string) {
  const d = places.data;
  if (!id || !d) { placesStore.set({ selected: null, stepId: null }); return; }
  const at = eventsAt(d, id);
  placesStore.set({ selected: id, stepId: stepId ?? at[at.length - 1]?.stepId ?? null });
}

/** A stretch of steps in one place, in order (consecutive steps on the same page fold into one row). */
export type PlaceRun = { key: string; place: string; first: CoworkEvent; last: CoworkEvent; count: number; verbs: Map<CoworkVerb, number>; failed: number; stepIds: Set<string> };
export function placeRuns(events: CoworkEvent[]): PlaceRun[] {
  const runs: PlaceRun[] = [];
  for (const e of events) {
    const place = `${e.area}|${e.page}`;
    let r = runs[runs.length - 1];
    if (!r || r.place !== place) runs.push(r = { key: e.id, place, first: e, last: e, count: 0, verbs: new Map(), failed: 0, stepIds: new Set() });
    r.last = e; r.count++; r.stepIds.add(e.stepId);
    if (e.failed) r.failed++;
    if (e.change && !e.failed && e.change.confidence !== "maybe") r.verbs.set(e.change.verb, (r.verbs.get(e.change.verb) ?? 0) + 1);
  }
  return runs;
}

export const placeTitle = (e: { title?: string; page: string; site: string }) =>
  e.title && e.title !== e.site ? e.title : e.page.replace(/^[^:]+:/, "").replace(e.site, "") || e.site;

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
