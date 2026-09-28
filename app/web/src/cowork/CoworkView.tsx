// Owner: cowork. Agent work outside the code: where the agents went (map) and what they changed (list).
import { Fragment, useMemo, useState } from "react";
import type { CoworkArea, CoworkEvent, CoworkSummary } from "@contract";
import { useLive } from "../lib/live";
import { useNav } from "../lib/nav";
import { clockTime } from "../follow/format";
import { AREAS, AREA_HINT, AREA_NAME, VERB_NAME, changeGroups, placeTitle, plural, useCowork, verbTotals, type ChangeGroup } from "./data";
import { AREA_COLOR, WorldMap } from "./WorldMap";
import "./cowork.css";

const placeId = (e: CoworkEvent) => `${e.area}|${e.page}`;

function dayLabel(iso: string) {
  const d = new Date(iso), today = new Date();
  const days = Math.round((new Date(today.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86400000);
  return days === 0 ? "Today" : days === 1 ? "Yesterday" : d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
}

function Headline({ data }: { data: CoworkSummary }) {
  const n = (a: CoworkArea) => data.sites.filter((s) => s.area === a && s.name !== "Web search").length;
  const pages = data.pages.filter((p) => p.area === "web" && !p.id.includes("|search:")).length;
  const changes = data.events.filter((e) => e.change && !e.failed && e.change.confidence !== "maybe").length;
  const parts = [
    n("web") && `opened ${plural(pages, "page")} on ${plural(n("web"), "website")}`,
    n("local") && `tested ${plural(n("local"), "app")} running on this computer`,
    n("services") && `used ${plural(n("services"), "service")}`,
    n("apps") && `drove ${plural(n("apps"), "desktop app")}`,
  ].filter(Boolean) as string[];
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0] ?? "haven't worked outside the code yet";
  return (
    <p className="cw-sub">
      Your agents {list}. They changed <strong>{plural(changes, "thing")}</strong> outside this computer.
    </p>
  );
}

function ChangeRow({ g, sessions, onHover, onPick }: { g: ChangeGroup; sessions: Map<string, string>; onHover: (id: string | null) => void; onPick: (e: CoworkEvent) => void }) {
  const { openStep } = useNav();
  const e = g.last;
  const c = e.change!;
  return (
    <li className={`cw-change v-${c.verb} c-${c.confidence}`} onMouseEnter={() => onHover(placeId(e))} onMouseLeave={() => onHover(null)}>
      <button className="cw-change-main" onClick={() => onPick(e)} title="Show this place on the map">
        <span className="cw-verb">{VERB_NAME[c.verb]}{g.count > 1 && <span className="cw-times"> ×{g.count}</span>}</span>
        <span className="cw-what">{e.what}</span>
        <span className="cw-where"><i style={{ background: AREA_COLOR[e.area] }} />{e.site}{placeTitle(e) !== e.site && <> · {placeTitle(e)}</>}</span>
        <span className="cw-meta">
          {clockTime(g.first.ts)}{g.count > 1 && `–${clockTime(e.ts)}`}
          <span className="sep">·</span>{sessions.get(e.sessionId) ?? "Untitled session"}
          {c.confidence !== "sure" && <span className={`cw-conf ${c.confidence}`} title={c.confidence === "likely" ? "A click on a button like Send or Submit, or Enter after typing" : "A click or typing we couldn't read: it may not have changed anything"}>{c.confidence}</span>}
        </span>
      </button>
      <button className="cw-open" onClick={() => openStep(e.sessionId, e.stepId)} title="Open this step in Follow">Open step</button>
    </li>
  );
}

function ChangesPanel({ data, sessions, onHover, onPick }: { data: CoworkSummary; sessions: Map<string, string>; onHover: (id: string | null) => void; onPick: (e: CoworkEvent) => void }) {
  const [maybe, setMaybe] = useState(false);
  const groups = useMemo(() => changeGroups(data.events, maybe), [data, maybe]);
  const totals = useMemo(() => verbTotals(data.events), [data]);
  const maybes = useMemo(() => data.events.filter((e) => e.change?.confidence === "maybe" && !e.failed).length, [data]);
  return (
    <>
      <div className="cw-side-head">
        <h2>Changes</h2>
        <p className="cw-side-sub">Things your agents did that reach outside this computer: deploys, pushes, sent forms, edited docs.</p>
        {totals.length > 0 && (
          <div className="cw-totals">{totals.map(([v, n]) => <span key={v} className={`cw-total v-${v}`}>{VERB_NAME[v]} <b>{n}</b></span>)}</div>
        )}
        {maybes > 0 && (
          <label className="cw-toggle">
            <input type="checkbox" checked={maybe} onChange={(e) => setMaybe(e.target.checked)} />
            Show {plural(maybes, "possible change")} (clicks and typing on websites)
          </label>
        )}
      </div>
      {groups.length === 0
        ? <p className="cw-empty">No changes outside this computer yet.</p>
        : <ul className="cw-changes">{groups.map((g, i) => {
            const day = dayLabel(g.last.ts);
            return (
              <Fragment key={g.key}>
                {(i === 0 || dayLabel(groups[i - 1].last.ts) !== day) && <li className="cw-day">{day}</li>}
                <ChangeRow g={g} sessions={sessions} onHover={onHover} onPick={onPick} />
              </Fragment>
            );
          })}</ul>}
    </>
  );
}

function PlacePanel({ data, id, sessions, onBack }: { data: CoworkSummary; id: string; sessions: Map<string, string>; onBack: () => void }) {
  const { openStep } = useNav();
  const site = data.sites.find((s) => s.id === id);
  const page = data.pages.find((p) => p.id === id);
  const events = useMemo(() => data.events.filter((e) => (site ? `${e.area}|${e.site}` === id : placeId(e) === id)).reverse(), [data, id, site]);
  const first = events[events.length - 1];
  const title = site ? site.name : first ? placeTitle(first) : id.split("|")[1];
  const stats = site ?? page;
  const url = page?.url ?? (site && site.pages === 1 ? data.pages.find((p) => p.site === site.id)?.url : undefined);
  return (
    <>
      <div className="cw-side-head">
        <button className="cw-back" onClick={onBack}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M10 3.5L5.5 8l4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          All changes
        </button>
        <h2 className="cw-place-title">{title}</h2>
        {url && <a className="cw-url" href={url} target="_blank" rel="noreferrer noopener">{url.replace(/^https?:\/\//, "")}</a>}
        {stats && (
          <p className="cw-side-sub">
            {plural(stats.events, "step")}{stats.changes > 0 && <> · <b className="hot">{plural(stats.changes, "change")}</b></>}
            {stats.failed > 0 && <> · <b className="risk">{stats.failed} failed</b></>}
            {page && <> · {plural(page.sessions.length, "session")}</>}
            {site && site.pages > 1 && <> · {plural(site.pages, "page")}</>}
          </p>
        )}
      </div>
      <ul className="cw-events">
        {events.slice(0, 300).map((e) => (
          <li key={e.id} className={`cw-event${e.change ? ` has-change c-${e.change.confidence}` : ""}${e.failed ? " failed" : ""}`}>
            <span className="cw-ev-time">{clockTime(e.ts)}</span>
            <span className="cw-ev-main">
              <span className="cw-ev-what">{e.what}</span>
              <span className="cw-ev-meta">
                {site && site.pages > 1 && <>{placeTitle(e)} · </>}
                {sessions.get(e.sessionId) ?? "Untitled session"}
                {e.change && <span className={`cw-conf ${e.change.confidence}`}>{VERB_NAME[e.change.verb].toLowerCase()}{e.change.confidence !== "sure" ? `, ${e.change.confidence}` : ""}</span>}
                {e.failed && <span className="cw-conf failed">failed</span>}
              </span>
            </span>
            <button className="cw-open" onClick={() => openStep(e.sessionId, e.stepId)} title="Open this step in Follow">Open</button>
          </li>
        ))}
      </ul>
    </>
  );
}

export function CoworkView() {
  const { data, error } = useCowork();
  const { state } = useLive();
  const [areas, setAreas] = useState<ReadonlySet<CoworkArea>>(new Set(AREAS));
  const [selected, setSelected] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const sessions = useMemo(() => new Map(state.sessions.map((s) => [s.id, s.title || "Untitled session"])), [state.sessions]);

  if (!data) {
    return <div className="cw-root cw-loading"><p className="cw-empty">{error ? "Couldn't load the cowork data. Is the server running?" : "Reading your agents' sessions…"}</p></div>;
  }

  const toggleArea = (a: CoworkArea) => setAreas((cur) => {
    const next = new Set(cur);
    if (next.has(a) && next.size > 1) next.delete(a); else next.add(a);
    return next;
  });
  const pick = (e: CoworkEvent) => { setAreas((cur) => (cur.has(e.area) ? cur : new Set([...cur, e.area]))); setSelected(placeId(e)); };

  return (
    <div className="cw-root">
      <section className="cw-stage">
        <header className="cw-head">
          <h1 className="cw-h1">Cowork</h1>
          <Headline data={data} />
          <div className="cw-areas" role="group" aria-label="Kinds of work shown on the map">
            {AREAS.map((a) => (
              <button key={a} className={`cw-area${areas.has(a) ? " on" : ""}`} aria-pressed={areas.has(a)} title={AREA_HINT[a]}
                disabled={data.areas[a] === 0} onClick={() => toggleArea(a)}>
                <i style={{ background: AREA_COLOR[a] }} />{AREA_NAME[a]} <span>{data.areas[a].toLocaleString()}</span>
              </button>
            ))}
            <span className="cw-code" title="Reads, edits and shell commands that stay in the code: see the Map">+ {data.codeSteps.toLocaleString()} steps in the code</span>
          </div>
        </header>
        <WorldMap data={data} areas={areas} selected={selected} highlight={highlight} onSelect={setSelected} />
        <div className="cw-legend">
          <span><i className="lg-size" />Bigger: more steps there</span>
          <span><i className="lg-hot" />Something changed there</span>
          <span><i className="lg-fail" />A step failed</span>
        </div>
      </section>
      <aside className="cw-side">
        {selected
          ? <PlacePanel data={data} id={selected} sessions={sessions} onBack={() => setSelected(null)} />
          : <ChangesPanel data={data} sessions={sessions} onHover={setHighlight} onPick={pick} />}
      </aside>
    </div>
  );
}
