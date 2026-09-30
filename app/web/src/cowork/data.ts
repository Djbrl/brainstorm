// Owner: cowork. Loads GET /api/cowork?sessionId= for one thread and shapes it for the view: change groups, verb names, area names.
import { useEffect, useState } from "react";
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
export const AREA_HINT: Record<CoworkArea, string> = {
  web: "Websites the agents opened, read or searched",
  local: "Apps running on this computer, like your dev servers",
  services: "Connected accounts and command-line tools: GitHub, Vercel, docs…",
  apps: "Desktop and simulator apps driven by computer use",
};
export const AREAS: CoworkArea[] = ["web", "local", "services", "apps"];

export const VERB_NAME: Record<CoworkVerb, string> = {
  sent: "Sent", submitted: "Submitted", published: "Published", deployed: "Deployed", pushed: "Pushed",
  created: "Created", updated: "Edited", deleted: "Deleted", typed: "Typed", clicked: "Clicked",
};

/** A run of the same change on the same place by the same session, e.g. 7 edits to one doc in a row. */
export type ChangeGroup = { key: string; first: CoworkEvent; last: CoworkEvent; count: number; events: CoworkEvent[] };

const RUN_GAP_MS = 15 * 60 * 1000;

export function changeGroups(events: CoworkEvent[], includeMaybe: boolean): ChangeGroup[] {
  const changes = events.filter((e) => e.change && !e.failed && (includeMaybe || e.change.confidence !== "maybe"));
  const groups: ChangeGroup[] = [];
  for (const e of changes) {
    const g = groups[groups.length - 1];
    if (g && g.last.sessionId === e.sessionId && g.last.page === e.page && g.last.change!.verb === e.change!.verb && Date.parse(e.ts) - Date.parse(g.last.ts) < RUN_GAP_MS) {
      g.last = e; g.count++; g.events.push(e);
    } else groups.push({ key: e.id, first: e, last: e, count: 1, events: [e] });
  }
  return groups.reverse(); // newest first
}

export function verbTotals(events: CoworkEvent[]): [CoworkVerb, number][] {
  const m = new Map<CoworkVerb, number>();
  for (const e of events) if (e.change && !e.failed && e.change.confidence !== "maybe") m.set(e.change.verb, (m.get(e.change.verb) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

export const placeTitle = (e: { title?: string; page: string; site: string }) =>
  e.title && e.title !== e.site ? e.title : e.page.replace(/^[^:]+:/, "").replace(e.site, "") || e.site;

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
